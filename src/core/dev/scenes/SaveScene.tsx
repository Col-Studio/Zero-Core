/**
 * `?scene=save` — the save/load round-trip proof, made visible.
 *
 * Numbers in a console prove nothing to the eye, so this scene shows the property directly:
 *
 *   1. the live shoal drifts (solid)
 *   2. **Snapshot** freezes a copy of every position as translucent ghosts, and saves
 *   3. the shoal keeps drifting away from its ghosts
 *   4. **Restore** loads the save — every solid body lands back inside its ghost, exactly
 *
 * If save/load were lossy you would see it instantly: bodies landing beside their ghosts, or a
 * different number of them. The overlay reports the state hash before and after, and the e2e spec
 * asserts the two are equal — the same property, checked twice, once by eye and once by CI.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import { DynamicDrawUsage, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import type { CoreRuntime } from '../../runtime';

export function SaveScene({ runtime }: { runtime: CoreRuntime }): ReactNode {
  const liveRef = useRef<InstancedMesh>(null);
  const ghostRef = useRef<InstancedMesh>(null);
  const capacity = runtime.world.capacity;
  const [ghosts, setGhosts] = useState<Float32Array | null>(null);

  const scratch = useMemo(
    () => ({
      matrix: new Matrix4(),
      position: new Vector3(),
      quaternion: new Quaternion(),
      scale: new Vector3(1, 1, 1),
    }),
    [],
  );

  const snapshot = useCallback(() => {
    const { position } = runtime.sim;
    const world = runtime.world;
    const out = new Float32Array(world.slotCount * 3);
    let count = 0;
    for (let index = 0; index < world.slotCount; index++) {
      if (!world.isSlotAlive(index)) continue;
      out[count * 3] = position.store.field.x[index]!;
      out[count * 3 + 1] = position.store.field.y[index]!;
      out[count * 3 + 2] = position.store.field.z[index]!;
      count++;
    }
    setGhosts(out.slice(0, count * 3));
    void runtime.saves.save('scene-save', true);
  }, [runtime]);

  const restore = useCallback(() => {
    void runtime.saves.load('scene-save');
  }, [runtime]);

  // The scene exposes its two actions to the overlay and to Playwright through the window, so the
  // e2e spec drives exactly what a human would click, rather than a private test-only path.
  useEffect(() => {
    const api = { snapshot, restore };
    (window as unknown as Record<string, unknown>).__SAVE_SCENE__ = api;
    return () => {
      delete (window as unknown as Record<string, unknown>).__SAVE_SCENE__;
    };
  }, [snapshot, restore]);

  useEffect(() => {
    const mesh = liveRef.current;
    if (mesh !== null) mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  }, []);

  useFrame(() => {
    const live = liveRef.current;
    const world = runtime.world;
    if (live !== null) {
      const { position } = runtime.sim;
      let visible = 0;
      for (let index = 0; index < world.slotCount; index++) {
        if (!world.isSlotAlive(index)) continue;
        scratch.position.set(
          position.store.field.x[index]!,
          position.store.field.y[index]!,
          position.store.field.z[index]!,
        );
        scratch.scale.setScalar(1);
        scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.scale);
        live.setMatrixAt(visible++, scratch.matrix);
      }
      live.count = visible;
      live.instanceMatrix.needsUpdate = true;
    }

    const ghost = ghostRef.current;
    if (ghost !== null && ghosts !== null) {
      const count = ghosts.length / 3;
      for (let i = 0; i < count; i++) {
        scratch.position.set(ghosts[i * 3]!, ghosts[i * 3 + 1]!, ghosts[i * 3 + 2]!);
        scratch.scale.setScalar(1.35);
        scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.scale);
        ghost.setMatrixAt(i, scratch.matrix);
      }
      ghost.count = count;
      ghost.instanceMatrix.needsUpdate = true;
    } else if (ghost !== null) {
      ghost.count = 0;
    }
  });

  return (
    <group>
      <instancedMesh ref={liveRef} args={[undefined, undefined, capacity]} frustumCulled={false}>
        <icosahedronGeometry args={[0.9, 0]} />
        <meshStandardMaterial color="#8fd39a" roughness={0.5} />
      </instancedMesh>

      <instancedMesh ref={ghostRef} args={[undefined, undefined, capacity]} frustumCulled={false}>
        <icosahedronGeometry args={[0.9, 0]} />
        <meshStandardMaterial color="#6fb2ff" transparent opacity={0.22} depthWrite={false} />
      </instancedMesh>
    </group>
  );
}

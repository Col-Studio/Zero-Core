/**
 * `?scene=core` — the 10 000-entity stress test.
 *
 * One `InstancedMesh`, one draw call, 10 000 matrices rewritten per frame straight from the SoA
 * position arrays. There is no per-entity React component and no per-entity `Object3D`, because
 * either would put 10 000 JS objects between the simulation and the GPU and the frame budget
 * would be gone before the simulation ran at all.
 *
 * What this scene proves, and what the e2e test asserts: 10 000 entities simulate at 20 Hz while
 * the renderer holds 60 fps, and the reported tick keeps climbing while it does.
 */

import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import { Color, DynamicDrawUsage, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import type { CoreRuntime } from '../../runtime';
import { REF } from '../../sim/reference.data';

const SPECIES_COLORS = ['#e2b06a', '#8fd39a', '#8bb8ff', '#e08a8a'];

export function StressScene({ runtime }: { runtime: CoreRuntime }): ReactNode {
  const meshRef = useRef<InstancedMesh>(null);
  const capacity = runtime.world.capacity;

  // Scratch objects, allocated once. Allocating a Matrix4 per entity per frame would hand the GC
  // 600 000 objects a second, and the resulting collections are exactly the stalls the loop's
  // catch-up cap exists to survive — no need to manufacture them here.
  const scratch = useMemo(
    () => ({
      matrix: new Matrix4(),
      position: new Vector3(),
      quaternion: new Quaternion(),
      scale: new Vector3(1, 1, 1),
      color: new Color(),
    }),
    [],
  );

  useEffect(() => {
    const mesh = meshRef.current;
    if (mesh === null) return;
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    const { vitals } = runtime.sim;
    const color = new Color();
    for (let index = 0; index < capacity; index++) {
      const species = vitals.store.field.species[index] ?? 0;
      color.set(SPECIES_COLORS[species % SPECIES_COLORS.length]!);
      mesh.setColorAt(index, color);
    }
    if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true;
  }, [runtime, capacity, scratch]);

  useFrame(() => {
    const mesh = meshRef.current;
    if (mesh === null) return;
    const { position, vitals } = runtime.sim;
    const px = position.store.field.x;
    const py = position.store.field.y;
    const pz = position.store.field.z;
    const health = vitals.store.field.health;
    const world = runtime.world;
    const slots = world.slotCount;

    let visible = 0;
    for (let index = 0; index < slots; index++) {
      if (!world.isSlotAlive(index)) continue;
      scratch.position.set(px[index]!, py[index]!, pz[index]!);
      const size = 0.5 + 0.4 * Math.max(0, health[index]! / REF.health);
      scratch.scale.setScalar(size);
      scratch.matrix.compose(scratch.position, scratch.quaternion, scratch.scale);
      mesh.setMatrixAt(visible++, scratch.matrix);
    }
    mesh.count = visible;
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh ref={meshRef} args={[undefined, undefined, capacity]} frustumCulled={false}>
        <icosahedronGeometry args={[0.6, 0]} />
        <meshStandardMaterial vertexColors roughness={0.55} metalness={0.05} />
      </instancedMesh>
      {/* Ring marker at the cohesion radius, so drift is visible without reading numbers. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
        <ringGeometry args={[REF.fieldRadius * 0.68, REF.fieldRadius * 0.72, 96]} />
        <meshBasicMaterial color="#2f4a68" transparent opacity={0.5} />
      </mesh>
    </group>
  );
}

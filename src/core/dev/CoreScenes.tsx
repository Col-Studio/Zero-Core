/**
 * Scene router for `core`'s three debug scenes, plus the one place the simulation is pumped.
 *
 * ## One rAF, not two
 *
 * `mountCore` starts its own `requestAnimationFrame` driver so the engine runs headless — with no
 * React, no canvas, in a test. When a scene *is* on screen, that driver is stopped and the loop is
 * pumped from `useFrame` instead. Two independent rAF callbacks would both be correct and would
 * still be wrong: the simulation would advance in one and be drawn in the other, so a frame could
 * show state from between two steps and `alpha` would mean nothing.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { markReady } from '@contracts/index';
import { Stats } from '@react-three/drei';
import type { MountContext } from '@contracts/services';
import type { CoreRuntime } from '../runtime';
import { useCoreRuntime } from './useRuntime';
import { StressScene } from './scenes/StressScene';
import { LoopScene } from './scenes/LoopScene';
import { SaveScene } from './scenes/SaveScene';

/** Camera framing per scene. Fixed values, because a moving camera makes screenshots useless. */
const CAMERAS: Record<string, { position: [number, number, number]; target: [number, number, number] }> = {
  core: { position: [0, 96, 168], target: [0, 0, 0] },
  loop: { position: [0, 10, 46], target: [0, 3, 0] },
  save: { position: [0, 70, 130], target: [0, 0, 0] },
  default: { position: [0, 60, 150], target: [0, 0, 0] },
};

function CameraRig({ scene }: { scene: string }): null {
  const camera = useThree((state) => state.camera);
  useEffect(() => {
    const rig = CAMERAS[scene] ?? CAMERAS.default!;
    camera.position.set(...rig.position);
    camera.lookAt(...rig.target);
    camera.updateProjectionMatrix();
  }, [camera, scene]);
  return null;
}

function LoopPump({ runtime }: { runtime: CoreRuntime }): null {
  const clock = useRef(0);
  const signalled = useRef(false);

  useEffect(() => {
    runtime.driver.stop();
    return () => runtime.driver.start();
  }, [runtime]);

  useFrame((_state, delta) => {
    // Accumulate r3f's own delta rather than reading a clock: the loop must receive time through
    // exactly one door, and `delta` is already the frame time r3f measured.
    clock.current += delta * 1000;
    runtime.loop.frame(clock.current);
    runtime.perf.frame();
    // Ready once a real frame has been pumped. `mountCore` fast-forwards to the requested
    // `?tick=` synchronously during mount, so by this first frame the tick is already reached —
    // exactly what the screenshot harness is waiting for. Idempotent.
    if (!signalled.current) {
      signalled.current = true;
      markReady();
    }
  });

  return null;
}

export function CoreScenes({ ctx }: { ctx: MountContext }): ReactNode {
  const runtime = useCoreRuntime();
  if (runtime === null) return null;

  const scene = ctx.debugScene ?? 'default';

  return (
    <>
      <CameraRig scene={scene} />
      <LoopPump runtime={runtime} />
      {scene === 'loop' ? (
        <LoopScene runtime={runtime} />
      ) : scene === 'save' ? (
        <SaveScene runtime={runtime} />
      ) : (
        <StressScene runtime={runtime} />
      )}
      {/* drei's fps panel. Off under ?freeze=1: it is a DOM element that changes every frame, and
          full-page screenshots must be byte-identical. */}
      {!ctx.frozen && <Stats />}
    </>
  );
}

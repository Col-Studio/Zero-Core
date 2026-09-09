/**
 * `?scene=loop` — the timestep visualiser.
 *
 * Three markers race along the same track, and the point of the scene is that they disagree:
 *
 *   • **stepped** (amber) jumps 1/20 s at a time — raw simulation state, what every system sees
 *   • **interpolated** (blue) uses the loop's `alpha` to slide between the last two steps — what
 *     a renderer should draw, and the reason `alpha` is part of the loop's public API
 *   • **frame** (grey, small) advances with wall-clock frames, ignoring the simulation entirely —
 *     the wrong answer, kept on screen so the difference is visible rather than theoretical
 *
 * At 1× the blue marker glides and the amber one visibly stutters at 20 Hz. Press `4×` and both
 * speed up without the physics changing, which is the property the ecology team needs to watch a
 * forty-minute cascade in two. The stall button blocks the main thread for two seconds: the loop
 * runs its five catch-up steps, drops the rest, and keeps its frame time — no death spiral.
 */

import { useRef, type ReactNode } from 'react';
import { useFrame } from '@react-three/fiber';
import type { Group, Mesh } from 'three';
import type { CoreRuntime } from '../../runtime';
import { LOOP } from '../../core.data';

const TRACK = 34;
/** Simulated seconds for one lap. */
const LAP_SECONDS = 4;

const lapPosition = (turns: number): number => {
  const phase = turns - Math.floor(turns);
  // Triangle wave: out and back, so the markers stay on screen and stay comparable.
  return (phase < 0.5 ? phase * 2 : 2 - phase * 2) * TRACK - TRACK / 2;
};

export function LoopScene({ runtime }: { runtime: CoreRuntime }): ReactNode {
  const stepped = useRef<Mesh>(null);
  const interpolated = useRef<Mesh>(null);
  const frameOnly = useRef<Mesh>(null);
  const bars = useRef<Group>(null);
  const frameClock = useRef(0);

  useFrame((_state, delta) => {
    const tick = runtime.loop.tick();
    const alpha = runtime.loop.alpha();
    const perLap = LAP_SECONDS * LOOP.tickRate;

    if (stepped.current !== null) stepped.current.position.x = lapPosition(tick / perLap);
    if (interpolated.current !== null) {
      interpolated.current.position.x = lapPosition((tick + alpha) / perLap);
    }
    if (frameOnly.current !== null) {
      frameClock.current += delta * runtime.loop.speed() * (runtime.loop.paused() ? 0 : 1);
      frameOnly.current.position.x = lapPosition(frameClock.current / LAP_SECONDS);
    }

    // Frame-time bars: tallest bar = the worst frame in the window, so a stall is unmissable.
    const group = bars.current;
    if (group !== null) {
      const stats = runtime.loop.stats();
      const scale = Math.max(1, stats.lastFrameMs) / 16.6;
      const first = group.children[0];
      if (first !== undefined) {
        first.scale.y = Math.min(8, scale);
        first.position.y = (Math.min(8, scale) * 1.5) / 2;
      }
    }
  });

  return (
    <group position={[0, 0, 0]}>
      {/* The track */}
      <mesh position={[0, 1.2, 0]}>
        <boxGeometry args={[TRACK + 2, 0.06, 0.6]} />
        <meshStandardMaterial color="#26333f" />
      </mesh>

      <mesh ref={stepped} position={[0, 2.4, 0]} castShadow>
        <boxGeometry args={[1.6, 1.6, 1.6]} />
        <meshStandardMaterial color="#e2b06a" emissive="#3a2a10" />
      </mesh>

      <mesh ref={interpolated} position={[0, 4.6, 0]} castShadow>
        <sphereGeometry args={[0.9, 24, 16]} />
        <meshStandardMaterial color="#6fb2ff" emissive="#10243a" />
      </mesh>

      <mesh ref={frameOnly} position={[0, 0.6, 0]}>
        <sphereGeometry args={[0.45, 16, 12]} />
        <meshStandardMaterial color="#6b7683" />
      </mesh>

      {/* Frame-time bar, scaled against the 16.6 ms budget. */}
      <group ref={bars} position={[TRACK / 2 + 4, 0, 0]}>
        <mesh position={[0, 0.75, 0]}>
          <boxGeometry args={[1.2, 1.5, 1.2]} />
          <meshStandardMaterial color="#7fd18b" />
        </mesh>
      </group>

      {/* Tick ruler: one post per simulated second along the track. */}
      {Array.from({ length: 9 }, (_, index) => (
        <mesh key={index} position={[-TRACK / 2 + (index * TRACK) / 8, 0.4, -1.6]}>
          <boxGeometry args={[0.12, 0.8, 0.12]} />
          <meshStandardMaterial color="#3d4c5c" />
        </mesh>
      ))}
    </group>
  );
}

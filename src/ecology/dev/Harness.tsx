/**
 * Standalone harness: mounts ONLY `ecology`, against Null services for everything else, so it
 * can run and be screenshotted without the rest of the game (CLAUDE.md § Determinism & the
 * screenshot loop). Supports `?seed=&scene=ecology&tick=&freeze=1` like every other debug scene.
 *
 * NOTE FOR THE INTEGRATION LEAD: `App.tsx` and `main.tsx` are frozen and their `MODULES` array
 * only wires real per-module scenes in after merge, so this component isn't reachable through
 * the default dev-server route yet. Until it's wired in, render it directly, e.g. temporarily
 * swap `src/main.tsx`'s render target locally (never commit that) or add a tiny throwaway entry
 * — see INTEGRATION_NOTES.md "ecology dev harness routing" for the open question either way.
 */

import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import {
  createEventBus,
  createRng,
  createServiceRegistry,
  markReady,
  parseSessionParams,
  TICKS_PER_SECOND,
  type MountContext,
  type Tick,
} from '@contracts/index';
import { mountEcology } from '../index';
import { EcologyDashboard } from './Dashboard';

function TickDriver({ frozen, tickRef, onAdvance }: { frozen: boolean; tickRef: { current: Tick }; onAdvance: () => void }): null {
  const accumulator = useRef(0);
  useFrame((_, delta) => {
    if (frozen) return;
    accumulator.current += delta;
    const step = 1 / TICKS_PER_SECOND;
    let advanced = false;
    while (accumulator.current >= step) {
      accumulator.current -= step;
      tickRef.current = (tickRef.current + 1) as Tick;
      advanced = true;
    }
    if (advanced) onAdvance();
  });
  return null;
}

export default function EcologyHarness(): ReactElement {
  const params = useMemo(() => parseSessionParams(window.location.search), []);
  const tickRef = useRef<Tick>(params.tick as Tick);
  const [, forceRerender] = useMemoTick();

  const ctx = useMemo<MountContext>(() => {
    const rng = createRng(params.seed);
    const bus = createEventBus();
    bus.setTick(tickRef.current);
    const services = createServiceRegistry({ getTick: () => tickRef.current });
    return {
      seed: params.seed,
      rng,
      bus,
      services,
      getTick: () => tickRef.current,
      debugScene: params.scene,
      frozen: params.freeze,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const dispose = mountEcology(ctx);
    markReady();
    return dispose;
  }, [ctx]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0b0e13' }}>
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: 'high-performance', alpha: false }}
        camera={{ fov: 60, near: 0.1, far: 500, position: [0, 8, 22] }}
      >
        <hemisphereLight args={[0xbdd7ff, 0x4a5a3a, 0.7]} />
        <directionalLight position={[40, 60, 20]} intensity={1.4} />
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[80, 80]} />
          <meshStandardMaterial color={0x394a33} />
        </mesh>
        <TickDriver
          frozen={params.freeze}
          tickRef={tickRef}
          onAdvance={() => {
            ctx.bus.setTick(tickRef.current);
            forceRerender();
          }}
        />
      </Canvas>
      <EcologyDashboard seed={params.seed} />
    </div>
  );
}

/** Tiny local re-render trigger — the dashboard reads live query state every render. */
function useMemoTick(): [number, () => void] {
  const [count, setCount] = useState(0);
  const bump = (): void => setCount((c) => c + 1);
  return [count, bump];
}

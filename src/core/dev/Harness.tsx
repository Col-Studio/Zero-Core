/**
 * Standalone dev harness (Block A § standalone harness).
 *
 * Mounts ONLY `core`, against Null services, in its own `<Canvas>` — the one place a module is
 * allowed to create one. The shell renders the same scenes through `App.tsx`; this exists so the
 * engine can be run, screenshotted, and debugged with the shell out of the picture entirely,
 * which is how you tell "core is broken" apart from "the shell is broken".
 *
 * Use it from a scratch entry point:
 *
 *   import { CoreHarness } from '@core/dev/Harness';
 *   createRoot(document.getElementById('root')!).render(<CoreHarness />);
 */

import { useMemo, type ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import { ACESFilmicToneMapping, SRGBColorSpace } from 'three';
import {
  createEventBus,
  createRng,
  createServiceRegistry,
  parseSessionParams,
  type MountContext,
} from '@contracts/index';
import { mountCore } from '../index';
import { getCoreRuntime } from '../runtime';
import { CoreScenes } from './CoreScenes';
import { DevOverlay } from './DevOverlay';

export function CoreHarness(): ReactNode {
  const ctx = useMemo<MountContext>(() => {
    const params = parseSessionParams();
    const bus = createEventBus();
    const services = createServiceRegistry({ getTick: () => getCoreRuntime()?.getTick() ?? 0 });
    const context: MountContext = {
      seed: params.seed,
      rng: createRng(params.seed),
      bus,
      services,
      // Before the runtime exists this reports the requested tick, which is what tells
      // `mountCore` how far to fast-forward; afterwards it is the live simulation tick.
      getTick: () => getCoreRuntime()?.getTick() ?? params.tick,
      debugScene: params.scene,
      frozen: params.freeze,
    };
    mountCore(context);
    // Readiness is signalled by LoopPump's first frame (see CoreScenes) — after the scene has
    // actually rendered, not merely after mount.
    return context;
  }, []);

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0b0e13' }}>
      <Canvas
        shadows
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
        camera={{ fov: 70, near: 0.1, far: 2000, position: [0, 60, 150] }}
        onCreated={({ gl }) => {
          gl.toneMapping = ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
          gl.outputColorSpace = SRGBColorSpace;
        }}
      >
        <hemisphereLight args={[0xbdd7ff, 0x4a5a3a, 0.6]} />
        <directionalLight position={[80, 120, 40]} intensity={1.6} castShadow />
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[400, 400]} />
          <meshStandardMaterial color={0x5a6b4a} />
        </mesh>
        <CoreScenes ctx={ctx} />
      </Canvas>
      <DevOverlay ctx={ctx} />
    </div>
  );
}

/**
 * FROZEN — integration lead only. See CLAUDE.md § Frozen files.
 *
 * The application shell — the only integration surface in the repo.
 *
 * Responsibilities, and nothing else:
 *   1. parse ?seed / ?scene / ?tick / ?freeze
 *   2. build the session singletons (rng, bus, registry)
 *   3. own the single <Canvas>
 *   4. call each module's mountX(ctx), each inside its own error boundary
 *
 * The error boundaries are deliberate: with seven independently developed modules, one throwing
 * component must not black-screen a demo. A failed module degrades to a visible badge while the
 * other six keep running.
 *
 * ## Adding a module at merge time
 *
 * Each branch adds exactly one <ModuleSlot> below plus one registry.register() call, in merge
 * order (core → world → ecology → creatures → society → player → presentation). Conflicts here
 * are expected and trivial — a handful of lines, resolved by hand.
 */

import { Component, useMemo, useRef, type ErrorInfo, type ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import { ACESFilmicToneMapping, SRGBColorSpace } from 'three';
import {
  createEventBus,
  createRng,
  createServiceRegistry,
  markReady,
  parseSessionParams,
  type MountContext,
  type MountFn,
  type Tick,
} from '@contracts/index';

// -------------------------------------------------------------------------------------------
// Error boundary — one per module
// -------------------------------------------------------------------------------------------

interface SlotProps {
  name: string;
  children: ReactNode;
}

interface SlotState {
  error: Error | null;
}

class ModuleSlot extends Component<SlotProps, SlotState> {
  override state: SlotState = { error: null };

  static getDerivedStateFromError(error: Error): SlotState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[shell] module '${this.props.name}' crashed:`, error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error !== null) return null; // the badge is rendered by the DOM overlay
    return this.props.children;
  }
}

// -------------------------------------------------------------------------------------------
// Session
// -------------------------------------------------------------------------------------------

/**
 * Every module's mount function, in merge order. Each branch adds its own entry.
 * Empty until modules land — the shell must run standalone, which is what proves the contracts
 * are self-sufficient.
 */
const MODULES: readonly { name: string; mount: MountFn }[] = [
  // { name: 'core',         mount: mountCore },
  // { name: 'world',        mount: mountWorld },
  // { name: 'ecology',      mount: mountEcology },
  // { name: 'creatures',    mount: mountCreatures },
  // { name: 'society',      mount: mountSociety },
  // { name: 'player',       mount: mountPlayer },
  // { name: 'presentation', mount: mountPresentation },
];

function useSession(): { ctx: MountContext; setTick: (t: Tick) => void } {
  return useMemo(() => {
    const params = parseSessionParams();
    const tickRef = { current: params.tick as Tick };
    const getTick = (): Tick => tickRef.current;

    const rng = createRng(params.seed);
    const bus = createEventBus();
    bus.setTick(tickRef.current);

    // Registry defaults every service to its Null, so the shell runs with zero modules present.
    const services = createServiceRegistry({ getTick });

    const ctx: MountContext = {
      seed: params.seed,
      rng,
      bus,
      services,
      getTick,
      debugScene: params.scene,
      frozen: params.freeze,
    };

    return {
      ctx,
      setTick: (t: Tick) => {
        tickRef.current = t;
        bus.setTick(t);
      },
    };
  }, []);
}

// -------------------------------------------------------------------------------------------
// Scene
// -------------------------------------------------------------------------------------------

function Scene({ ctx }: { ctx: MountContext }): ReactNode {
  // Modules mount imperatively; the shell only provides the scene graph and lighting rig that
  // presentation later replaces.
  const mounted = useRef(false);
  if (!mounted.current) {
    mounted.current = true;
    for (const { name, mount } of MODULES) {
      try {
        mount(ctx);
      } catch (error) {
        console.error(`[shell] mount '${name}' threw:`, error);
      }
    }
    markReady();
  }

  return (
    <>
      {/* Placeholder rig — `presentation` owns the real sky, fog, and light. */}
      <hemisphereLight args={[0xbdd7ff, 0x4a5a3a, 0.6]} />
      <directionalLight position={[80, 120, 40]} intensity={1.6} castShadow />
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[400, 400]} />
        <meshStandardMaterial color={0x5a6b4a} />
      </mesh>
    </>
  );
}

export default function App(): ReactNode {
  const { ctx } = useSession();

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#0b0e13' }}>
      <Canvas
        shadows
        dpr={[1, 2]}
        // WebGL2 only. Never WebGPURenderer — see CLAUDE.md § Stack.
        gl={{
          antialias: true,
          powerPreference: 'high-performance',
          alpha: false,
          stencil: true, // portals / masked effects
        }}
        camera={{ fov: 70, near: 0.1, far: 2000, position: [0, 12, 40] }}
        onCreated={({ gl }) => {
          gl.toneMapping = ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
          gl.outputColorSpace = SRGBColorSpace;
        }}
      >
        <ModuleSlot name="scene">
          <Scene ctx={ctx} />
        </ModuleSlot>
      </Canvas>

      {/* Minimal boot readout. `core` replaces this with the real debug overlay. */}
      <div
        style={{
          position: 'absolute',
          top: 10,
          left: 12,
          font: '12px ui-monospace, monospace',
          color: '#8fa3bf',
          pointerEvents: 'none',
          lineHeight: 1.5,
        }}
      >
        WORLD ZERO · seed {ctx.seed}
        {ctx.debugScene !== null ? ` · scene ${ctx.debugScene}` : ''}
        {ctx.frozen ? ' · frozen' : ''}
        <br />
        {MODULES.length === 0 ? 'no modules mounted — all services Null' : `${MODULES.length} module(s)`}
      </div>
    </div>
  );
}

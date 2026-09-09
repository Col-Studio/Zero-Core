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
 *   5. route ?scene= to the requested module's debug scene
 *
 * The error boundaries are deliberate: with seven independently developed modules, one throwing
 * component must not black-screen a demo. A failed module degrades to a visible badge while the
 * other six keep running.
 *
 * ## Adding a module at merge time
 *
 * Each branch adds exactly one MODULES entry, one <ModuleSlot> in the scene, and one
 * registry.register() call, in merge order (core → world → ecology → creatures → society →
 * player → presentation). Conflicts here are expected and trivial — a handful of lines, resolved
 * by hand.
 *
 * ## Why `core` is wired differently from the other six
 *
 * `mountCore` starts the simulation, and the shell's `getTick()` has to report the tick the
 * simulation is actually on — every other module reads time through it. So the shell asks the
 * core runtime for the tick, and seeds it with `?tick=` before the runtime exists, which is how
 * `mountCore` learns how far to fast-forward. `core` also renders the dev overlay and its own
 * debug scenes; the other six will render theirs the same way, in their own slot.
 */

import { Component, useMemo, useRef, type ErrorInfo, type ReactNode } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
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
import { mountCore, getCoreRuntime } from '@core/index';
import { CoreScenes } from '@core/dev/CoreScenes';
import { DevOverlay } from '@core/dev/DevOverlay';

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
 */
const MODULES: readonly { name: string; mount: MountFn }[] = [
  { name: 'core', mount: mountCore },
  // { name: 'world',        mount: mountWorld },
  // { name: 'ecology',      mount: mountEcology },
  // { name: 'creatures',    mount: mountCreatures },
  // { name: 'society',      mount: mountSociety },
  // { name: 'player',       mount: mountPlayer },
  // { name: 'presentation', mount: mountPresentation },
];

function useSession(): MountContext {
  return useMemo(() => {
    const params = parseSessionParams();

    // Before `core` mounts this reports the requested tick (so `mountCore` knows how far to
    // fast-forward); after that the core loop owns the clock and everyone reads it here.
    const getTick = (): Tick => getCoreRuntime()?.getTick() ?? (params.tick as Tick);

    const rng = createRng(params.seed);
    const bus = createEventBus();
    bus.setTick(params.tick as Tick);

    // Registry defaults every service to its Null, so the shell runs with zero modules present.
    const services = createServiceRegistry({ getTick });

    return {
      seed: params.seed,
      rng,
      bus,
      services,
      getTick,
      debugScene: params.scene,
      frozen: params.freeze,
    };
  }, []);
}

// -------------------------------------------------------------------------------------------
// Scene
// -------------------------------------------------------------------------------------------

function Scene({ ctx }: { ctx: MountContext }): ReactNode {
  // Modules mount imperatively, once, before the first frame is drawn.
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
  }

  // Readiness after the first *rendered* frame, not during mount: the screenshot harness wants a
  // scene that is mounted, fast-forwarded to its tick, and actually drawn. CoreScenes' LoopPump
  // signals too; the flag is idempotent, and this covers scenes without a loop pump.
  const signalled = useRef(false);
  useFrame(() => {
    if (!signalled.current) {
      signalled.current = true;
      markReady();
    }
  });

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
  const ctx = useSession();

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
        <ModuleSlot name="core">
          <CoreScenes ctx={ctx} />
        </ModuleSlot>
      </Canvas>

      {/* `core`'s dev overlay: ticks, speed, perf, events, and which services are still Null. */}
      <DevOverlay ctx={ctx} />
    </div>
  );
}

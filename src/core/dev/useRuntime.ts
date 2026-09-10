/**
 * React bindings for the runtime.
 *
 * The simulation is not React state and must never become React state: 10 000 entities cannot go
 * through `useState` at 20 Hz. Instead the overlay samples the runtime on a slow timer (4 Hz) and
 * the 3D scenes read the typed arrays directly inside `useFrame`, which touches no React state at
 * all. React is the chrome; it is never in the hot path.
 */

import { useEffect, useRef, useState } from 'react';
import { getCoreRuntime, type CoreRuntime } from '../runtime';
import { SCENES } from '../core.data';

/** The live runtime, or null if `mountCore` has not run (or crashed inside its boundary). */
export function useCoreRuntime(): CoreRuntime | null {
  const [runtime, setRuntime] = useState<CoreRuntime | null>(() => getCoreRuntime());
  useEffect(() => {
    if (runtime !== null) return;
    // The shell mounts modules inside the Canvas's own render pass, which can land after this
    // component's first paint and after a single next-tick retry. Poll until the singleton
    // exists, then stop — a mounted runtime never flips back to null except on dispose.
    const handle = window.setInterval(() => {
      if (getCoreRuntime() !== null) setRuntime(getCoreRuntime());
    }, 50);
    return () => window.clearInterval(handle);
  }, [runtime]);
  return runtime;
}

/** Re-render at `SCENES.overlayHz`, no faster. Pass `null` to stop live updates entirely —
 *  `?freeze=1` captures must be byte-identical. Returns a monotonically increasing counter. */
export function useSampler(hz: number | null = SCENES.overlayHz): number {
  const [sample, setSample] = useState(0);
  useEffect(() => {
    if (hz === null) return;
    const handle = window.setInterval(() => setSample((n) => n + 1), Math.round(1000 / hz));
    return () => window.clearInterval(handle);
  }, [hz]);
  return sample;
}

/** A ref that always holds the latest value without causing renders. */
export function useLatest<T>(value: T): { current: T } {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/**
 * Keyboard controls the whole team gets for free: space pauses, `.` single-steps, `1/2/3` set
 * speed, `s` saves, `l` loads. Ignored while typing in a field, because someone will eventually
 * put a text input in this overlay.
 */
export function useLoopHotkeys(runtime: CoreRuntime | null): void {
  useEffect(() => {
    if (runtime === null) return;
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      if (target !== null && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      switch (event.key) {
        case ' ':
          event.preventDefault();
          runtime.loop.togglePause();
          break;
        case '.':
          runtime.loop.stepOnce();
          break;
        case '1':
          runtime.loop.setSpeed(1);
          break;
        case '2':
          runtime.loop.setSpeed(4);
          break;
        case '3':
          runtime.loop.setSpeed(16);
          break;
        case 's':
          void runtime.saves.save('manual');
          break;
        case 'l':
          void runtime.saves.load('manual');
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [runtime]);
}

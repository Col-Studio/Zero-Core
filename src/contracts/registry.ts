/**
 * FROZEN — integration lead only. See CLAUDE.md § Frozen files.
 *
 * ServiceRegistry — the dependency-injection container, and the single place where Null services
 * become real ones.
 *
 * ## Why lazy accessors
 *
 * Modules resolve services through a FUNCTION CALL at use time (`ctx.services.world()`), never
 * by caching the object at mount time. That indirection is what lets the integration lead swap
 * one service at a time after the merge:
 *
 *   registry.register('world', createWorldService(ctx));   // commit, verify
 *   registry.register('ecology', createEcologyService(ctx)); // commit, verify
 *
 * If modules cached `ctx.services.world()` at mount, they'd hold a Null forever and the swap
 * would silently do nothing — a bug that looks like "the real module doesn't work".
 *
 * In development the registry warns the first time a module reads a service that is still Null,
 * which turns exactly that class of mistake into a visible message.
 */

import type { Tick } from './ids';
import type {
  ICreatureQuery,
  IEcologyQuery,
  IPlayerQuery,
  IPresentation,
  ISocietyQuery,
  IWorldQuery,
  ServiceRegistryLike,
} from './services';
import { createNullServices } from './nulls';

export type ServiceName =
  | 'world'
  | 'ecology'
  | 'creatures'
  | 'player'
  | 'society'
  | 'presentation';

export interface ServiceMap {
  world: IWorldQuery;
  ecology: IEcologyQuery;
  creatures: ICreatureQuery;
  player: IPlayerQuery;
  society: ISocietyQuery;
  presentation: IPresentation;
}

export interface ServiceRegistry extends ServiceRegistryLike {
  /** Install a real implementation, replacing the Null. */
  register<N extends ServiceName>(name: N, impl: ServiceMap[N]): void;
  /** Revert one service to its Null. Useful for bisecting an integration regression. */
  unregister(name: ServiceName): void;
  /** True when a real implementation is installed. */
  isReal(name: ServiceName): boolean;
  /** Which services are real vs Null — the debug overlay renders this. */
  status(): Readonly<Record<ServiceName, 'real' | 'null'>>;
  /** Restore every service to its Null. Test teardown. */
  reset(): void;
}

export interface ServiceRegistryOptions {
  /** Tick source so the Null services animate. Defaults to a frozen tick 0. */
  getTick?: () => Tick;
  /** Warn once per service when something reads a Null. Default: true outside production. */
  warnOnNullAccess?: boolean;
}

export function createServiceRegistry(options: ServiceRegistryOptions = {}): ServiceRegistry {
  const getTick = options.getTick ?? (() => 0);
  const warn = options.warnOnNullAccess ?? true;

  const nulls = createNullServices(getTick);
  const real: Partial<ServiceMap> = {};
  const warned = new Set<ServiceName>();

  const nullFor = <N extends ServiceName>(name: N): ServiceMap[N] =>
    nulls[name]() as ServiceMap[N];

  const resolve = <N extends ServiceName>(name: N): ServiceMap[N] => {
    const impl = real[name];
    if (impl !== undefined) return impl as ServiceMap[N];
    if (warn && !warned.has(name)) {
      warned.add(name);
      console.info(
        `[registry] reading Null '${name}' — expected while developing standalone, ` +
          `a bug after that service has been merged.`,
      );
    }
    return nullFor(name);
  };

  return {
    world: () => resolve('world'),
    ecology: () => resolve('ecology'),
    creatures: () => resolve('creatures'),
    player: () => resolve('player'),
    society: () => resolve('society'),
    presentation: () => resolve('presentation'),

    register(name, impl) {
      if (real[name] !== undefined) {
        console.warn(`[registry] '${name}' re-registered — the previous implementation is gone.`);
      }
      real[name] = impl;
      warned.delete(name);
    },

    unregister(name) {
      delete real[name];
    },

    isReal(name) {
      return real[name] !== undefined;
    },

    status() {
      const names: ServiceName[] = [
        'world',
        'ecology',
        'creatures',
        'player',
        'society',
        'presentation',
      ];
      const out = {} as Record<ServiceName, 'real' | 'null'>;
      for (const name of names) out[name] = real[name] !== undefined ? 'real' : 'null';
      return out;
    },

    reset() {
      for (const key of Object.keys(real)) delete real[key as ServiceName];
      warned.clear();
    },
  };
}

/**
 * FROZEN — integration lead only. See CLAUDE.md § Frozen files.
 *
 * Null player, society, and presentation.
 *
 * The Null player ORBITS rather than standing still: `world` tests chunk streaming with it and
 * `creatures` tests perception with it, and a stationary player would exercise neither.
 *
 * The Null presentation is a silent sink that records calls. Modules can therefore request VFX
 * and SFX freely from day one, and Member 7 can later read `drained()` in a debug scene to see
 * exactly what the rest of the game is asking for.
 */

import type {
  EconomyState,
  IPlayerQuery,
  IPresentation,
  ISocietyQuery,
  MissionInfo,
  PlayerStance,
  VillageInfo,
} from '../services';
import {
  dist2XZ,
  factionId as toFactionId,
  missionId as toMissionId,
  regionId as toRegionId,
  vec3,
  villageId as toVillageId,
  type CombatStyle,
  type FactionId,
  type ResourceId,
  type Tick,
  type Vec3,
} from '../ids';
import { nullHeightAt } from './world';

// -------------------------------------------------------------------------------------------
// Player
// -------------------------------------------------------------------------------------------

export function createNullPlayerQuery(getTick: () => Tick = () => 0): IPlayerQuery {
  const ORBIT_RADIUS = 120;
  const ORBIT_TICKS = 4800; // one lap ≈ 4 simulated minutes

  const posAt = (tick: Tick): Vec3 => {
    const a = (tick / ORBIT_TICKS) * Math.PI * 2;
    const x = Math.cos(a) * ORBIT_RADIUS;
    const z = Math.sin(a) * ORBIT_RADIUS;
    return vec3(x, nullHeightAt(x, z) + 1.7, z); // +1.7 m eye height
  };

  return {
    getPosition: () => posAt(getTick()),

    getVelocity() {
      const a = (getTick() / ORBIT_TICKS) * Math.PI * 2;
      const speed = (Math.PI * 2 * ORBIT_RADIUS) / (ORBIT_TICKS / 20); // m/s
      return vec3(-Math.sin(a) * speed, 0, Math.cos(a) * speed);
    },

    getStance: (): PlayerStance => 'walk',
    getHealth: () => ({ current: 100, max: 100 }),
    getStamina: () => ({ current: 100, max: 100 }),
    getStyle: (): CombatStyle => 'blade',
    isInCombat: () => false,

    getRegionId() {
      const p = posAt(getTick());
      return toRegionId(`r_${Math.round(p.x / 200)}_${Math.round(p.z / 200)}`);
    },

    applyDamage() {
      /* the Null player is immortal — bosses can hit it safely during development */
    },

    getInventoryCount: () => 0,
  };
}

// -------------------------------------------------------------------------------------------
// Society
// -------------------------------------------------------------------------------------------

const NULL_FACTIONS: readonly { id: FactionId; name: string }[] = [
  { id: toFactionId('verdant_order'), name: 'Verdant Order' },
  { id: toFactionId('iron_guild'), name: 'Iron Guild' },
  { id: toFactionId('hunters_lodge'), name: "Hunters' Lodge" },
  { id: toFactionId('wanderers'), name: 'Wanderers' },
];

export function createNullSocietyQuery(): ISocietyQuery {
  const villages: VillageInfo[] = [
    { name: 'Millbrook', pos: vec3(80, 0, 40), region: 'r_0_0', faction: 0, pop: 60 },
    { name: 'Ashfell', pos: vec3(-160, 0, 120), region: 'r_-1_1', faction: 1, pop: 45 },
    { name: 'Thornreach', pos: vec3(220, 0, -180), region: 'r_1_-1', faction: 2, pop: 30 },
  ].map((v, i) => ({
    id: toVillageId(`v_${i}`),
    name: v.name,
    pos: vec3(v.pos.x, nullHeightAt(v.pos.x, v.pos.z), v.pos.z),
    regionId: toRegionId(v.region),
    population: v.pop,
    factionId: NULL_FACTIONS[v.faction]!.id,
    state: 'stable' as const,
  }));

  const economies = new Map<string, EconomyState>(
    villages.map((v) => [
      v.id,
      {
        villageId: v.id,
        stocks: { food: 0.7, timber: 0.6, ore: 0.4, hides: 0.5, coin: 0.5 },
        flows: { food: 0.02, timber: 0.01, ore: -0.01, hides: 0.0, coin: 0.03 },
        industry: 'farming' as const,
        reason: 'Stable — no ecological pressure detected.',
      },
    ]),
  );

  // One offered mission so mission UI, acceptance flow, and HUD have something to render.
  const missions: MissionInfo[] = [
    {
      id: toMissionId('m_null_0'),
      title: 'Wolves at the Sheepfold',
      summary: 'Wolves have been taking livestock from Millbrook. Cull six of them.',
      villageId: villages[0]!.id,
      factionId: NULL_FACTIONS[2]!.id,
      rank: 1,
      state: 'offered',
      objectives: [{ text: 'Cull wolves', done: false, progress: 0, target: 6 }],
      expiresIn: null,
    },
  ];

  return {
    getVillage: (id) => villages.find((v) => v.id === id) ?? null,
    getAllVillages: () => villages,

    getVillagesNear(pos, radius) {
      const r2 = radius * radius;
      return villages.filter((v) => dist2XZ(v.pos, pos) <= r2);
    },

    getEconomy: (id) => economies.get(id) ?? null,
    getActiveMissions: () => missions.filter((m) => m.state === 'active'),

    getOfferedMissions(villageId) {
      return missions.filter(
        (m) => m.state === 'offered' && (villageId === undefined || m.villageId === villageId),
      );
    },

    getMission: (id) => missions.find((m) => m.id === id) ?? null,

    getFactionRelation(a, b) {
      if (a === b) return 1;
      // Verdant Order and Iron Guild are structurally opposed; everyone else is neutral.
      const pair = [String(a), String(b)].sort().join('|');
      if (pair.includes('verdant_order') && pair.includes('iron_guild')) return -0.7;
      return 0;
    },

    getFactionList: () => NULL_FACTIONS.map((f) => ({ id: f.id, name: f.name, standing: 0 })),

    // Empty chronicle: consumers must render gracefully with no history, and this proves it.
    getChronicle: () => [],

    acceptMission(id) {
      const m = missions.find((x) => x.id === id);
      if (m === undefined || m.state !== 'offered') return false;
      m.state = 'active';
      return true;
    },
  };
}

// -------------------------------------------------------------------------------------------
// Presentation
// -------------------------------------------------------------------------------------------

export interface RecordedCall {
  kind: 'vfx' | 'sfx' | 'weather' | 'toast' | 'shake' | 'hitstop';
  name: string;
  pos?: Vec3;
  value?: number;
}

export interface NullPresentation extends IPresentation {
  /** Return everything recorded since the last drain, and clear the buffer. */
  drained(): readonly RecordedCall[];
}

export function createNullPresentation(): NullPresentation {
  // Bounded so a module spamming requests in a long dev session can't leak memory.
  const MAX = 512;
  let calls: RecordedCall[] = [];

  const push = (call: RecordedCall): void => {
    calls.push(call);
    if (calls.length > MAX) calls = calls.slice(-MAX);
  };

  return {
    requestVfx(kind, pos, opts) {
      push({ kind: 'vfx', name: kind, pos, value: opts?.intensity });
    },
    requestSfx(kind, pos, opts) {
      push({ kind: 'sfx', name: kind, pos, value: opts?.volume });
    },
    setWeatherVisual(kind, intensity) {
      push({ kind: 'weather', name: kind, value: intensity });
    },
    showToast(text, tone) {
      push({ kind: 'toast', name: `${tone ?? 'info'}: ${text}` });
    },
    shakeCamera(magnitude, durationTicks) {
      push({ kind: 'shake', name: 'shake', value: magnitude * durationTicks });
    },
    requestHitstop(durationTicks) {
      push({ kind: 'hitstop', name: 'hitstop', value: durationTicks });
    },
    drained() {
      const out = calls;
      calls = [];
      return out;
    },
  };
}

/** Resource-id helper for Null consumers that need a plausible id. */
export const nullResourceId = (raw: string): ResourceId => raw as ResourceId;

/**
 * `?scene=ecology` dashboard — built for tuning 60+ rules, per the card ("you cannot tune 60
 * rules without it"). Reads exclusively through `IEcologyQuery` (plus the raw region roster for
 * the picker, which is structural, not simulation output) so it exercises the same surface every
 * other module will use.
 */

import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import type { RegionId, SpeciesId, TrophicTier } from '@contracts/index';
import { getMountedEcologyService, getMountedEcologyState } from '../index';
import { SPECIES } from '../species.data';
import { simulateEcology } from '../sim';
import { SCENARIOS } from './scenario';

const TIER_COLORS: Record<TrophicTier, string> = {
  apex: '#e0555f',
  predator: '#e0a555',
  herbivore: '#7cb86a',
  producer: '#4a9b6e',
};

const SEVERITY_COLORS: Record<string, string> = {
  minor: '#7c8a9c',
  notable: '#e0a555',
  major: '#e0705f',
  catastrophic: '#c73e4a',
};

function Panel({ title, children }: { title: string; children: ReactElement | ReactElement[] | null }): ReactElement {
  return (
    <div style={{ background: 'rgba(12,16,22,0.88)', border: '1px solid #263244', borderRadius: 8, padding: 10, marginBottom: 8 }}>
      <div style={{ font: '11px ui-monospace, monospace', color: '#8fa3bf', marginBottom: 6, letterSpacing: 0.5 }}>{title.toUpperCase()}</div>
      {children}
    </div>
  );
}

export function EcologyDashboard({ seed }: { seed: number }): ReactElement {
  const [, setTickBump] = useState(0);
  const state = getMountedEcologyState();
  const service = getMountedEcologyService();
  const regions = useMemo(() => state?.regions ?? [], [state]);
  const [regionId, setRegionId] = useState<RegionId | null>(null);
  const history = useRef<Map<string, number[]>>(new Map());
  const [headlessLog, setHeadlessLog] = useState<string[]>([]);

  useEffect(() => {
    if (regionId === null && regions.length > 0) setRegionId(regions[0]!.id);
  }, [regions, regionId]);

  useEffect(() => {
    const id = window.setInterval(() => setTickBump((n) => n + 1), 250);
    return () => window.clearInterval(id);
  }, []);

  if (service === null || state === null || regionId === null) {
    return (
      <div style={{ position: 'absolute', top: 10, right: 10, color: '#8fa3bf', font: '12px ui-monospace, monospace' }}>
        ecology: waiting for mount…
      </div>
    );
  }

  const populations = service.getAllPopulations(regionId);
  const vegetation = service.getVegetation(regionId);
  const cascades = service.getRecentCascades(20);

  for (const p of populations) {
    const key = `${p.speciesId}`;
    const arr = history.current.get(key) ?? [];
    arr.push(p.normalized);
    if (arr.length > 120) arr.shift();
    history.current.set(key, arr);
  }

  function runScenario(name: keyof typeof SCENARIOS): void {
    const result = simulateEcology(seed, 30_000, SCENARIOS[name]);
    const lines = result.cascades.slice(0, 12).map((c) => `t${c.tick} [${c.regionId}] ${c.narrative}`);
    setHeadlessLog([`— ${name} (${result.cascades.length} cascades over 30k ticks) —`, ...lines]);
  }

  return (
    <div
      style={{
        position: 'absolute',
        top: 10,
        right: 10,
        width: 380,
        maxHeight: 'calc(100vh - 20px)',
        overflowY: 'auto',
        font: '11px ui-monospace, monospace',
        color: '#d7e0ec',
      }}
    >
      <Panel title="region">
        <select
          value={regionId}
          onChange={(e) => setRegionId(e.target.value as RegionId)}
          style={{ width: '100%', background: '#111722', color: '#d7e0ec', border: '1px solid #263244', padding: 4 }}
        >
          {regions.map((r) => (
            <option key={r.id} value={r.id}>
              {r.id} · {r.biome}
            </option>
          ))}
        </select>
        <div style={{ marginTop: 6 }}>
          tick {state.tick} · vegetation {(vegetation * 100).toFixed(0)}% · weather {state.weather}
        </div>
      </Panel>

      <Panel title="trophic web">
        {(['apex', 'predator', 'herbivore', 'producer'] as TrophicTier[]).map((tier) => (
          <div key={tier} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
            <div style={{ width: 62, color: TIER_COLORS[tier] }}>{tier}</div>
            <div style={{ flex: 1, display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              {populations
                .filter((p) => SPECIES.find((s) => s.id === p.speciesId)?.tier === tier)
                .map((p) => (
                  <div
                    key={p.speciesId}
                    title={`${p.speciesId}: ${(p.normalized * 100).toFixed(0)}% (${p.stock.toFixed(1)})`}
                    style={{
                      width: 10 + Math.round(p.normalized * 14),
                      height: 10 + Math.round(p.normalized * 14),
                      borderRadius: '50%',
                      background: TIER_COLORS[tier],
                      opacity: 0.35 + p.normalized * 0.65,
                    }}
                  />
                ))}
            </div>
          </div>
        ))}
      </Panel>

      <Panel title="population history (normalized)">
        <PopulationGraph history={history.current} regionId={regionId} />
      </Panel>

      <Panel title="rule-firing log">
        <div>
          {cascades.length === 0 && <div style={{ color: '#5a6b80' }}>no cascades yet</div>}
          {cascades.map((c, i) => (
            <div key={`${c.ruleId}-${c.tick}-${i}`} style={{ marginBottom: 6, borderLeft: `2px solid ${SEVERITY_COLORS.notable}`, paddingLeft: 6 }}>
              <div style={{ color: '#d7e0ec' }}>
                t{c.tick} · {c.regionId} · <span style={{ color: '#8fa3bf' }}>{c.ruleId}</span>
              </div>
              <div>{c.narrative}</div>
              {c.chain.length > 1 && <div style={{ color: '#5a6b80' }}>chain: {c.chain.join(' → ')}</div>}
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="scripted-scenario runner (headless)">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {(Object.keys(SCENARIOS) as (keyof typeof SCENARIOS)[]).map((name) => (
            <button
              key={name}
              onClick={() => runScenario(name)}
              style={{ background: '#182233', color: '#d7e0ec', border: '1px solid #263244', padding: '4px 6px', cursor: 'pointer', textAlign: 'left' }}
            >
              run: {name}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 6, maxHeight: 140, overflowY: 'auto' }}>
          {headlessLog.map((line, i) => (
            <div key={i} style={{ color: i === 0 ? '#8fa3bf' : '#d7e0ec' }}>
              {line}
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="interactive kill (mutates the live sim)">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {populations
            .filter((p) => p.stock > 0.5)
            .slice(0, 12)
            .map((p) => (
              <button
                key={p.speciesId}
                onClick={() => service.applyKill(p.speciesId as SpeciesId, regionId, 'player')}
                style={{ background: '#2a1620', color: '#e0a5ac', border: '1px solid #3a1f2a', padding: '3px 6px', cursor: 'pointer' }}
              >
                kill {p.speciesId}
              </button>
            ))}
        </div>
      </Panel>
    </div>
  );
}

function PopulationGraph({ history, regionId }: { history: Map<string, number[]>; regionId: RegionId }): ReactElement {
  const width = 356;
  const height = 90;
  const speciesWithHistory = SPECIES.filter((s) => (history.get(s.id)?.length ?? 0) > 1).slice(0, 8);

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <rect x={0} y={0} width={width} height={height} fill="#0a0e14" />
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <line key={f} x1={0} x2={width} y1={height - f * height} y2={height - f * height} stroke="#1c2634" strokeWidth={1} />
      ))}
      {speciesWithHistory.map((species) => {
        const series = history.get(species.id) ?? [];
        const step = width / Math.max(1, series.length - 1);
        const points = series.map((v, i) => `${(i * step).toFixed(1)},${(height - v * height).toFixed(1)}`).join(' ');
        return (
          <polyline
            key={`${species.id}-${regionId}`}
            points={points}
            fill="none"
            stroke={TIER_COLORS[species.tier]}
            strokeWidth={1.4}
            opacity={0.85}
          />
        );
      })}
    </svg>
  );
}

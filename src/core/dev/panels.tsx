/**
 * Presentational pieces of the dev overlay. No runtime access, no state — everything arrives as
 * props so these can be rendered in isolation and so `DevOverlay.tsx` stays readable.
 *
 * Style note: fixed-width monospace, one colour for "fine" and one for "look at this". Six other
 * members will read this panel every day for three weeks; it is a tool, not a UI showcase.
 */

import type { ReactNode } from 'react';

export const UI = {
  bg: 'rgba(9,12,18,0.82)',
  border: '1px solid rgba(120,150,190,0.22)',
  text: '#c6d4e6',
  dim: '#7e91ab',
  good: '#7fd18b',
  warn: '#ffcf6b',
  bad: '#ff8b7a',
  accent: '#6fb2ff',
  font: '11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace',
} as const;

export function Panel({
  title,
  right,
  children,
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
}): ReactNode {
  return (
    <div
      style={{
        background: UI.bg,
        border: UI.border,
        borderRadius: 6,
        padding: '6px 8px',
        marginBottom: 6,
        minWidth: 250,
        backdropFilter: 'blur(6px)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          color: UI.dim,
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          fontSize: 9,
          marginBottom: 4,
        }}
      >
        <span>{title}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

export function Row({
  label,
  value,
  tone = 'text',
}: {
  label: string;
  value: ReactNode;
  tone?: keyof typeof UI;
}): ReactNode {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ color: UI.dim }}>{label}</span>
      <span style={{ color: UI[tone] as string, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

export function Button({
  label,
  onClick,
  active = false,
  title,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  title?: string;
}): ReactNode {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        font: UI.font,
        color: active ? '#04121f' : UI.text,
        background: active ? UI.accent : 'rgba(120,150,190,0.14)',
        border: UI.border,
        borderRadius: 4,
        padding: '2px 7px',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

/** Which services are real and which are still Nulls — the merge-progress bar. */
export function ServiceTable({
  status,
}: {
  status: Readonly<Record<string, 'real' | 'null'>> | null;
}): ReactNode {
  if (status === null) {
    return <div style={{ color: UI.dim }}>registry does not expose status()</div>;
  }
  const names = Object.keys(status).sort();
  const real = names.filter((name) => status[name] === 'real').length;
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 10 }}>
        {names.map((name) => (
          <div key={name} style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: UI.dim }}>{name}</span>
            <span style={{ color: status[name] === 'real' ? UI.good : UI.warn }}>
              {status[name] === 'real' ? 'real' : 'null'}
            </span>
          </div>
        ))}
      </div>
      <div style={{ color: UI.dim, marginTop: 3 }}>
        {real}/{names.length} modules merged
      </div>
    </>
  );
}

export function EventTail({
  entries,
}: {
  entries: readonly { tick: number; type: string; text: string }[];
}): ReactNode {
  if (entries.length === 0) return <div style={{ color: UI.dim }}>no events yet</div>;
  return (
    <div style={{ display: 'flex', flexDirection: 'column-reverse' }}>
      {entries.map((entry, index) => (
        <div
          key={`${entry.tick}-${index}`}
          style={{ display: 'flex', gap: 8, whiteSpace: 'nowrap' }}
        >
          <span style={{ color: UI.dim, fontVariantNumeric: 'tabular-nums' }}>
            {String(entry.tick).padStart(6, ' ')}
          </span>
          <span style={{ color: UI.accent }}>{entry.type}</span>
          <span
            style={{ color: UI.text, overflow: 'hidden', textOverflow: 'ellipsis' }}
            title={entry.text}
          >
            {entry.text}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Per-system frame cost. The answer to "who regressed after the merge?". */
export function PerfTable({
  rows,
}: {
  rows: readonly { label: string; meanMs: number; p95Ms: number; overBudget: boolean }[];
}): ReactNode {
  if (rows.length === 0) return <div style={{ color: UI.dim }}>collecting…</div>;
  return (
    <>
      {rows.map((row) => (
        <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
          <span style={{ color: row.overBudget ? UI.bad : UI.dim, whiteSpace: 'nowrap' }}>
            {row.label}
          </span>
          <span style={{ color: row.overBudget ? UI.bad : UI.text, fontVariantNumeric: 'tabular-nums' }}>
            {row.meanMs.toFixed(2)} / {row.p95Ms.toFixed(2)} ms
          </span>
        </div>
      ))}
    </>
  );
}

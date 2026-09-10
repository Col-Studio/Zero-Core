/**
 * The dev overlay — the thing the team lives in.
 *
 * Card 1 asks for a tick counter, an event-log tail, speed buttons, the seed, and a
 * service-registry inspector showing which services are real and which are still Nulls. That
 * last panel is the one that matters most during the three weeks before the merge: it is the
 * only place where "how much of the game actually exists yet" is visible at a glance.
 *
 * Rendered as DOM outside the <Canvas>, so it costs no GPU time and survives a crashed scene:
 * if `world` throws inside its error boundary, this panel is still there, still showing ticks,
 * still saying which module went dark.
 */

import { useCallback, useState, type ReactNode } from 'react';
import type { MountContext } from '@contracts/services';
import type { ServiceRegistry } from '@contracts/registry';
import { LOOP, PERF } from '../core.data';
import { Button, EventTail, Panel, PerfTable, Row, ServiceTable, UI } from './panels';
import { useCoreRuntime, useLoopHotkeys, useSampler } from './useRuntime';

const registryStatus = (
  services: MountContext['services'],
): Readonly<Record<string, 'real' | 'null'>> | null => {
  const maybe = services as Partial<ServiceRegistry>;
  return typeof maybe.status === 'function' ? maybe.status() : null;
};

export function DevOverlay({ ctx }: { ctx: MountContext }): ReactNode {
  const runtime = useCoreRuntime();
  // Same rule as <Stats/> in CoreScenes: frozen captures are compared byte-for-byte, so the
  // overlay must render once and never re-render with fresh fps/frame numbers.
  useSampler(ctx.frozen ? null : undefined);
  useLoopHotkeys(runtime);
  const [saveNote, setSaveNote] = useState('idle');
  const [collapsed, setCollapsed] = useState(false);

  const onSave = useCallback(() => {
    if (runtime === null) return;
    void runtime.saves.save('manual', true).then((save) => {
      setSaveNote(`saved @${save.tick} · ${save.hash.slice(0, 8)}`);
    });
  }, [runtime]);

  const onLoad = useCallback(() => {
    if (runtime === null) return;
    void runtime.saves.load('manual').then((result) => {
      setSaveNote(result.ok ? `loaded @${result.save.tick}` : `load failed: ${result.problem.kind}`);
    });
  }, [runtime]);

  const onVerify = useCallback(() => {
    if (runtime === null) return;
    setSaveNote('verifying…');
    void runtime.saves.verifyRoundTrip().then((result) => {
      setSaveNote(
        result.ok
          ? `round-trip OK · ${result.before.slice(0, 8)} · ${(result.bytes / 1024).toFixed(1)} kB`
          : `MISMATCH ${result.before.slice(0, 8)} → ${result.after.slice(0, 8)}`,
      );
    });
  }, [runtime]);

  // One text node, deliberately. `tests/e2e/shell.spec.ts` asserts on this readout with
  // `getByText(/WORLD ZERO/)`, which matches the SMALLEST element containing the phrase — split
  // it across spans and the shell's own smoke test starts failing for a formatting reason.
  const header = (
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', color: UI.text }}>
      <span style={{ letterSpacing: '0.06em' }}>
        WORLD ZERO · seed {ctx.seed}
        {ctx.debugScene !== null ? ` · scene ${ctx.debugScene}` : ''}
        {ctx.frozen ? ' · frozen' : ''}
      </span>
      <Button label={collapsed ? '▸' : '▾'} onClick={() => setCollapsed((v) => !v)} />
    </div>
  );

  if (runtime === null) {
    return (
      <Shell>
        {header}
        <Panel title="core">
          <span style={{ color: UI.bad }}>runtime not mounted — check the console</span>
        </Panel>
      </Shell>
    );
  }

  const loop = runtime.loop;
  const stats = loop.stats();
  const report = runtime.perf.report();
  const sim = runtime.sim.stats();
  const save = runtime.saves.status();
  const tick = loop.tick();

  return (
    <Shell>
      {header}
      {!collapsed && (
        <>
          <Panel
            title="loop"
            right={
              <span style={{ color: stats.catchUpFrames > 0 ? UI.warn : UI.dim }}>
                {stats.catchUpFrames > 0 ? `${stats.catchUpFrames} catch-up` : '20 Hz'}
              </span>
            }
          >
            <Row label="tick" value={tick.toLocaleString()} />
            <Row label="sim time" value={`${(tick / LOOP.tickRate).toFixed(1)} s`} />
            <Row
              label="fps"
              value={stats.fps.toFixed(0)}
              tone={stats.fps < 50 && stats.frames > 60 ? 'warn' : 'good'}
            />
            <Row label="frame" value={`${stats.avgFrameMs.toFixed(2)} ms`} />
            <Row
              label="dropped"
              value={`${(stats.droppedMs / 1000).toFixed(2)} s`}
              tone={stats.droppedMs > 0 ? 'warn' : 'text'}
            />
            <div style={{ display: 'flex', gap: 4, marginTop: 5, flexWrap: 'wrap' }}>
              <Button
                label={loop.paused() ? '▶ resume' : '❚❚ pause'}
                onClick={() => loop.togglePause()}
                title="space"
              />
              <Button label="step" onClick={() => loop.stepOnce()} title="." />
              {LOOP.speeds.map((speed) => (
                <Button
                  key={speed}
                  label={`${speed}×`}
                  active={loop.speed() === speed}
                  onClick={() => loop.setSpeed(speed)}
                />
              ))}
            </div>
          </Panel>

          <Panel title="ecs" right={<span style={{ color: UI.dim }}>{runtime.world.count} live</span>}>
            <Row label="entities" value={sim.alive.toLocaleString()} />
            <Row label="born / died" value={`${sim.born} / ${sim.died}`} />
            <Row label="attacks" value={sim.attacks} />
            <Row label="components" value={runtime.world.componentNames().join(', ')} />
          </Panel>

          <Panel
            title="perf"
            right={
              <span style={{ color: report.regressions.length > 0 ? UI.bad : UI.dim }}>
                budget {PERF.frameBudgetMs} ms
              </span>
            }
          >
            <Row
              label="frame p95"
              value={`${report.frameP95Ms.toFixed(2)} ms`}
              tone={report.frameP95Ms > PERF.frameBudgetMs ? 'warn' : 'good'}
            />
            <PerfTable rows={report.labels} />
          </Panel>

          <Panel title="services" right={<span style={{ color: UI.dim }}>real vs null</span>}>
            <ServiceTable status={registryStatus(ctx.services)} />
          </Panel>

          <Panel title="save" right={<span style={{ color: UI.dim }}>{save.storeKind}</span>}>
            <Row label="autosave in" value={`${save.nextAutosaveIn} ticks`} />
            <Row label="saves / loads" value={`${save.saves} / ${save.loads}`} />
            <Row label="recorded input" value={runtime.recorder.count()} />
            <div style={{ display: 'flex', gap: 4, marginTop: 5 }}>
              <Button label="save" onClick={onSave} title="s" />
              <Button label="load" onClick={onLoad} title="l" />
              <Button label="verify round-trip" onClick={onVerify} />
            </div>
            <div
              style={{
                marginTop: 4,
                color: saveNote.includes('MISMATCH') || saveNote.includes('failed') ? UI.bad : UI.good,
              }}
            >
              {saveNote}
            </div>
          </Panel>

          <Panel title="events" right={<span style={{ color: UI.dim }}>last 8</span>}>
            <EventTail entries={runtime.eventTail(8)} />
          </Panel>

          <div style={{ color: UI.dim, fontSize: 10 }}>
            space pause · . step · 1/2/3 speed · s save · l load
          </div>
        </>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }): ReactNode {
  return (
    <div
      style={{
        position: 'absolute',
        top: 10,
        left: 12,
        font: UI.font,
        color: UI.text,
        width: 280,
        maxHeight: 'calc(100vh - 24px)',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      {children}
    </div>
  );
}

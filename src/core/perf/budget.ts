/**
 * The perf budget harness — "who regressed after the merge?", answered with numbers.
 *
 * Seven modules share one 16.6 ms frame. When frame time doubles the day after a merge, the
 * argument that follows is unwinnable without per-module attribution, so this measures each
 * labelled span separately, keeps a rolling window, and reports mean / p95 / max against the
 * budget in `core.data.ts`.
 *
 * It implements `SystemProfiler`, so every system registered with the scheduler is measured for
 * free — a module gets its own line in the report without writing any instrumentation.
 *
 * Wall-clock lives in `./now.ts` and nowhere else: measurement must never be readable by
 * simulation code, or someone will eventually branch on it and break determinism.
 */

import { PERF } from '../core.data';
import { now } from './now';

export interface PerfSample {
  label: string;
  samples: number;
  meanMs: number;
  p95Ms: number;
  maxMs: number;
  /** Total time attributed to this label since the last reset. */
  totalMs: number;
  budgetMs: number | null;
  overBudget: boolean;
}

export interface PerfReport {
  frames: number;
  frameMeanMs: number;
  frameP95Ms: number;
  fps: number;
  labels: PerfSample[];
  /** Labels whose mean exceeds their budget. Empty is the goal. */
  regressions: string[];
}

export interface PerfBudget {
  begin(label: string): void;
  end(label: string): void;
  /** Measure a function. Returns whatever it returns. */
  measure<T>(label: string, body: () => T): T;
  /** Call once per rendered frame. */
  frame(): void;
  report(): PerfReport;
  reset(): void;
  /** Rolling mean for one label, for the overlay's live readout. */
  meanOf(label: string): number;
  enabled(): boolean;
  setEnabled(enabled: boolean): void;
}

interface Window {
  values: number[];
  head: number;
  filled: boolean;
  total: number;
  max: number;
  count: number;
}

const makeWindow = (size: number): Window => ({
  values: new Array<number>(size).fill(0),
  head: 0,
  filled: false,
  total: 0,
  max: 0,
  count: 0,
});

const push = (window: Window, value: number): void => {
  window.values[window.head] = value;
  window.head = (window.head + 1) % window.values.length;
  if (window.head === 0) window.filled = true;
  window.total += value;
  window.count++;
  if (value > window.max) window.max = value;
};

const live = (window: Window): number[] =>
  window.filled ? window.values : window.values.slice(0, window.head);

const mean = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;

const percentile = (values: number[], p: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index]!;
};

export function createPerfBudget(windowSize: number = PERF.window): PerfBudget {
  const windows = new Map<string, Window>();
  const open = new Map<string, number>();
  const frameWindow = makeWindow(windowSize);
  let lastFrameStart: number | null = null;
  let frames = 0;
  let enabled = true;

  const windowFor = (label: string): Window => {
    let window = windows.get(label);
    if (window === undefined) {
      window = makeWindow(windowSize);
      windows.set(label, window);
    }
    return window;
  };

  return {
    begin(label) {
      if (!enabled) return;
      open.set(label, now());
    },

    end(label) {
      if (!enabled) return;
      const started = open.get(label);
      if (started === undefined) return;
      open.delete(label);
      push(windowFor(label), now() - started);
    },

    measure(label, body) {
      if (!enabled) return body();
      const started = now();
      try {
        return body();
      } finally {
        push(windowFor(label), now() - started);
      }
    },

    frame() {
      if (!enabled) return;
      const stamp = now();
      if (lastFrameStart !== null) push(frameWindow, stamp - lastFrameStart);
      lastFrameStart = stamp;
      frames++;
    },

    report() {
      const labels: PerfSample[] = [];
      const regressions: string[] = [];
      for (const [label, window] of [...windows.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
        const values = live(window);
        const budget = PERF.budgets[label] ?? null;
        const meanMs = mean(values);
        const over = budget !== null && meanMs > budget;
        if (over) regressions.push(label);
        labels.push({
          label,
          samples: window.count,
          meanMs,
          p95Ms: percentile(values, 95),
          maxMs: window.max,
          totalMs: window.total,
          budgetMs: budget,
          overBudget: over,
        });
      }
      const frameValues = live(frameWindow);
      const frameMean = mean(frameValues);
      return {
        frames,
        frameMeanMs: frameMean,
        frameP95Ms: percentile(frameValues, 95),
        fps: frameMean > 0 ? 1000 / frameMean : 0,
        labels,
        regressions,
      };
    },

    meanOf(label) {
      const window = windows.get(label);
      return window === undefined ? 0 : mean(live(window));
    },

    reset() {
      windows.clear();
      open.clear();
      frameWindow.values.fill(0);
      frameWindow.head = 0;
      frameWindow.filled = false;
      frameWindow.total = 0;
      frameWindow.max = 0;
      frameWindow.count = 0;
      lastFrameStart = null;
      frames = 0;
    },

    enabled: () => enabled,
    setEnabled(next) {
      enabled = next;
      if (!next) open.clear();
    },
  };
}

/** One-line-per-module text report. The merge-day artifact. */
export function formatReport(report: PerfReport): string {
  const head =
    `frame ${report.frameMeanMs.toFixed(2)} ms mean / ${report.frameP95Ms.toFixed(2)} ms p95 ` +
    `(${report.fps.toFixed(0)} fps, ${report.frames} frames, budget ${PERF.frameBudgetMs} ms)`;
  const rows = report.labels.map((sample) => {
    const budget = sample.budgetMs === null ? '   —  ' : `${sample.budgetMs.toFixed(2)}ms`;
    const flag = sample.overBudget ? ' ← OVER' : '';
    return (
      `  ${sample.label.padEnd(22)} mean ${sample.meanMs.toFixed(3)}ms  ` +
      `p95 ${sample.p95Ms.toFixed(3)}ms  max ${sample.maxMs.toFixed(3)}ms  budget ${budget}${flag}`
    );
  });
  return [head, ...rows].join('\n');
}

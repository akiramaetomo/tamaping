// Per-phase frame timing for the `perf` debug profile. Pure and DOM-free so
// the windowed statistics can be tested without a browser.

export const PERF_PHASES = [
  'interval',
  'tick',
  'preStep',
  'worldStep',
  'postStep',
  'snapshot',
  'build',
  'pixiRender',
  'audio',
] as const;

export type PerfPhase = (typeof PERF_PHASES)[number];

export type PhaseStats = {
  avg: number;
  p95: number;
  max: number;
};

export type PerfSummary = {
  windowMs: number;
  frames: number;
  fps: number;
  framesOver20Ms: number;
  framesOver33Ms: number;
  stepsAvg: number;
  stepsMax: number;
  phases: Record<PerfPhase, PhaseStats>;
};

export const DEFAULT_PERF_WINDOW_MS = 2000;

type FrameSample = Record<PerfPhase, number>;

export class FrameProfiler {
  private current = emptyFrame();
  private frames: FrameSample[] = [];
  private steps: number[] = [];
  private windowStartedAt = -1;
  private latest: PerfSummary | null = null;
  private summaryVersionValue = 0;

  constructor(private readonly windowMs = DEFAULT_PERF_WINDOW_MS) {}

  get summary() {
    return this.latest;
  }

  // Increments whenever a new window summary is published.
  get summaryVersion() {
    return this.summaryVersionValue;
  }

  // Phases that run more than once per frame (fixed steps) accumulate.
  record(phase: PerfPhase, ms: number) {
    this.current[phase] += ms;
  }

  endFrame(now: number, steps: number) {
    if (this.windowStartedAt < 0) {
      this.windowStartedAt = now;
    }

    this.frames.push(this.current);
    this.steps.push(steps);
    this.current = emptyFrame();

    const elapsed = now - this.windowStartedAt;
    if (elapsed < this.windowMs) {
      return;
    }

    this.latest = summarizeFrames(this.frames, this.steps, elapsed);
    this.summaryVersionValue += 1;
    this.frames = [];
    this.steps = [];
    this.windowStartedAt = now;
  }

  reset() {
    this.current = emptyFrame();
    this.frames = [];
    this.steps = [];
    this.windowStartedAt = -1;
    this.latest = null;
  }
}

export function summarizeFrames(
  frames: FrameSample[],
  steps: number[],
  elapsedMs: number,
): PerfSummary {
  const phases = {} as Record<PerfPhase, PhaseStats>;
  for (const phase of PERF_PHASES) {
    phases[phase] = phaseStats(frames.map((frame) => frame[phase]));
  }

  const intervals = frames.map((frame) => frame.interval);
  return {
    windowMs: elapsedMs,
    frames: frames.length,
    fps: elapsedMs > 0 ? (frames.length * 1000) / elapsedMs : 0,
    framesOver20Ms: intervals.filter((value) => value > 20).length,
    framesOver33Ms: intervals.filter((value) => value > 33.4).length,
    stepsAvg: steps.length > 0 ? steps.reduce((sum, value) => sum + value, 0) / steps.length : 0,
    stepsMax: steps.length > 0 ? Math.max(...steps) : 0,
    phases,
  };
}

export function phaseStats(values: number[]): PhaseStats {
  if (values.length === 0) {
    return { avg: 0, p95: 0, max: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const p95Index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
  return {
    avg: values.reduce((sum, value) => sum + value, 0) / values.length,
    p95: sorted[p95Index],
    max: sorted[sorted.length - 1],
  };
}

// Times `run` into `phase` only when a profiler is active.
export function measurePhase<T>(
  profiler: FrameProfiler | null,
  phase: PerfPhase,
  run: () => T,
): T {
  if (!profiler) {
    return run();
  }

  const startedAt = performance.now();
  const result = run();
  profiler.record(phase, performance.now() - startedAt);
  return result;
}

function emptyFrame(): FrameSample {
  return {
    interval: 0,
    tick: 0,
    preStep: 0,
    worldStep: 0,
    postStep: 0,
    snapshot: 0,
    build: 0,
    pixiRender: 0,
    audio: 0,
  };
}

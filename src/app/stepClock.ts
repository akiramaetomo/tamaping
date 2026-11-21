// Decides how many fixed physics steps a rendered frame runs. Pure and
// DOM-free. Spec: `Proposed Overload Step Policy`.
//
// `legacy` catches up on all real time (the frame time is cut at 50 ms, so at
// most 3 steps). When one step is expensive, catching up makes the next frame
// later still, and every frame ends up running 3 steps.
//
// `adaptive` keeps the same steps while they are cheap. When the measured step
// cost would push the physics past its per-frame budget, it runs fewer steps
// and drops the time it could not simulate: the scene moves a little slower
// instead of stuttering. Each step is the same physics either way.

export type StepPolicy = 'adaptive' | 'legacy';

export const FIXED_STEP_SECONDS = 1 / 60;
export const MAX_FRAME_SECONDS = 0.05;
// Physics time per rendered frame before the adaptive policy runs fewer steps.
export const PHYSICS_BUDGET_MS = 10;
const STEP_COST_SMOOTHING = 0.2;
const SIM_SPEED_SMOOTHING = 0.05;

// `?step=legacy` keeps the catch-up rule of 0.2.9 for comparison.
export function stepPolicyFromParams(params: URLSearchParams): StepPolicy {
  return params.get('step')?.trim().toLowerCase() === 'legacy' ? 'legacy' : 'adaptive';
}

export class FixedStepClock {
  private accumulator = 0;
  private stepCostMs = 0;
  // Simulated time over real time, smoothed: 1 when nothing is dropped.
  private simSpeedValue = 1;

  constructor(readonly policy: StepPolicy) {}

  get simSpeed() {
    return this.simSpeedValue;
  }

  get averageStepCostMs() {
    return this.stepCostMs;
  }

  // Most steps the next frame may run.
  get maxSteps() {
    if (this.policy === 'legacy' || this.stepCostMs <= 0) {
      return Number.POSITIVE_INFINITY;
    }
    return Math.max(1, Math.floor(PHYSICS_BUDGET_MS / this.stepCostMs));
  }

  // Adds a frame's real time and returns the number of steps to run now.
  advance(deltaSeconds: number): number {
    const delta = Math.min(Math.max(deltaSeconds, 0), MAX_FRAME_SECONDS);
    this.accumulator += delta;
    // A tiny epsilon keeps 3 x (1/60) = 0.05 from losing a step to rounding.
    const due = Math.floor(this.accumulator / FIXED_STEP_SECONDS + 1e-9);
    const steps = Math.min(due, this.maxSteps);
    this.accumulator = Math.max(this.accumulator - steps * FIXED_STEP_SECONDS, 0);
    if (this.accumulator >= FIXED_STEP_SECONDS) {
      // Only reached under `adaptive`: drop the whole steps that did not fit,
      // keep the fraction so light frames stay evenly paced.
      this.accumulator %= FIXED_STEP_SECONDS;
    }
    if (delta > 0) {
      const ratio = (steps * FIXED_STEP_SECONDS) / delta;
      this.simSpeedValue += (Math.min(ratio, 1.5) - this.simSpeedValue) * SIM_SPEED_SMOOTHING;
    }
    return steps;
  }

  // Feeds the measured cost of one physics step (all of `physics.step`).
  recordStepCost(ms: number) {
    this.stepCostMs = this.stepCostMs <= 0
      ? ms
      : this.stepCostMs + (ms - this.stepCostMs) * STEP_COST_SMOOTHING;
  }

  reset() {
    this.accumulator = 0;
    this.simSpeedValue = 1;
  }
}

// Audio tuning controls shown in Settings Utility. These values are
// session-only system tuning: they reset to the defaults below on reload and
// are not part of presets.

export type TriggerShape = 'tight' | 'even' | 'random';

export type TriggerTestMode = 'tight-0' | 'even-16' | 'random-step';

// Impacts are produced by the fixed 1/60 s physics step, so one step is the
// natural packet period regardless of the display refresh rate.
export const PHYSICS_STEP_MS = 1000 / 60;

export type StealFadeMs = 0 | 1 | 2 | 4;

export const DEFAULT_STEAL_FADE_MS: StealFadeMs = 1;

export type AttackCurve = 'exponential' | 'linear';

export type AttackTestMode = 'exp-1' | 'linear-1' | 'linear-2' | 'linear-4';

export const DEFAULT_ATTACK_TEST_MODE: AttackTestMode = 'linear-1';

export type AttackShape = {
  curve: AttackCurve;
  ms: number;
};

export type TriggerTiming = {
  shape: TriggerShape;
  spreadMs: number;
};

// Random over one physics step is the shared default for every preset; the
// former preset-level Trigger Spread (0 or 16 ms) no longer has any effect.
export const DEFAULT_TRIGGER_TEST_MODE: TriggerTestMode = 'random-step';

export const TRIGGER_TEST_OPTIONS: Array<[TriggerTestMode, string]> = [
  ['tight-0', 'Tight 0ms'],
  ['even-16', 'Even 16ms'],
  ['random-step', 'Random 16.67ms'],
];

export const ATTACK_TEST_OPTIONS: Array<[AttackTestMode, string]> = [
  ['exp-1', 'Exp 1ms'],
  ['linear-1', 'Linear 1ms'],
  ['linear-2', 'Linear 2ms'],
  ['linear-4', 'Linear 4ms'],
];

export function resolveAttackShape(mode: AttackTestMode): AttackShape {
  switch (mode) {
    case 'linear-1':
      return { curve: 'linear', ms: 1 };
    case 'linear-2':
      return { curve: 'linear', ms: 2 };
    case 'linear-4':
      return { curve: 'linear', ms: 4 };
    case 'exp-1':
    default:
      return { curve: 'exponential', ms: 1 };
  }
}

export const STEAL_FADE_OPTIONS: Array<[StealFadeMs, string]> = [
  [0, '0ms'],
  [1, '1ms'],
  [2, '2ms'],
  [4, '4ms'],
];

// Scheduling lookahead added to `currentTime` before voice starts and steal
// fades are scheduled, so events are not placed in already rendered audio.
export type LookaheadMs = 0 | 10 | 20 | 30 | 50;

// 20 ms removed the crackle on PC Chrome, iPad, and Galaxy S24 in hands-on
// listening; 0 ms keeps the old late-scheduling behavior for comparison.
export const DEFAULT_LOOKAHEAD_MS: LookaheadMs = 20;

export const LOOKAHEAD_OPTIONS: Array<[LookaheadMs, string]> = [
  [0, '0ms'],
  [10, '10ms'],
  [20, '20ms'],
  [30, '30ms'],
  [50, '50ms'],
];

export function resolveTriggerTiming(mode: TriggerTestMode): TriggerTiming {
  switch (mode) {
    case 'tight-0':
      return { shape: 'tight', spreadMs: 0 };
    case 'even-16':
      return { shape: 'even', spreadMs: 16 };
    case 'random-step':
    default:
      return { shape: 'random', spreadMs: PHYSICS_STEP_MS };
  }
}

/**
 * Returns one start offset in seconds per unique impact index, in the order
 * the indices first appear. `even` keeps the original rotated evenly spaced
 * grid; `random` draws an independent uniform offset in `[0, spread)`.
 */
export function computeStartOffsets(
  impactIndices: number[],
  timing: TriggerTiming,
  frameSequence: number,
  random: () => number = Math.random,
) {
  const offsets = new Map<number, number>();
  const unique: number[] = [];
  for (const index of impactIndices) {
    if (!offsets.has(index)) {
      offsets.set(index, 0);
      unique.push(index);
    }
  }

  const spreadSeconds = timing.spreadMs / 1000;
  if (timing.shape === 'tight' || spreadSeconds <= 0 || unique.length <= 1) {
    return offsets;
  }

  if (timing.shape === 'random') {
    for (const index of unique) {
      offsets.set(index, random() * spreadSeconds);
    }
    return offsets;
  }

  const count = unique.length;
  const slotStep = spreadSeconds / (count - 1);
  for (let index = 0; index < count; index += 1) {
    const slot = (index + frameSequence) % count;
    offsets.set(unique[index], slot * slotStep);
  }
  return offsets;
}

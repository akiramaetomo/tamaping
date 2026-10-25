// Audio research comparison controls shown in Settings Utility. These values
// are session-only and are not part of presets.

export type TriggerShape = 'tight' | 'even' | 'random';

export type TriggerTestMode =
  | 'preset'
  | 'tight-0'
  | 'even-16'
  | 'random-16'
  | 'random-step'
  | 'random-8';

// Impacts are produced by the fixed 1/60 s physics step, so one step is the
// natural packet period regardless of the display refresh rate.
export const PHYSICS_STEP_MS = 1000 / 60;

export type StealFadeMs = 0 | 1 | 2 | 4;

export type AttackCurve = 'exponential' | 'linear';

export type AttackTestMode = 'exp-1' | 'linear-1' | 'linear-2' | 'linear-4';

export type AttackShape = {
  curve: AttackCurve;
  ms: number;
};

export type TriggerTiming = {
  shape: TriggerShape;
  spreadMs: number;
};

export const TRIGGER_TEST_OPTIONS: Array<[TriggerTestMode, string]> = [
  ['preset', 'Preset'],
  ['tight-0', 'Tight 0ms'],
  ['even-16', 'Even 16ms'],
  ['random-16', 'Random 16ms'],
  ['random-step', 'Random 16.67ms'],
  ['random-8', 'Random 8ms'],
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

export function resolveTriggerTiming(mode: TriggerTestMode, presetSpreadMs: number): TriggerTiming {
  switch (mode) {
    case 'tight-0':
      return { shape: 'tight', spreadMs: 0 };
    case 'even-16':
      return { shape: 'even', spreadMs: 16 };
    case 'random-16':
      return { shape: 'random', spreadMs: 16 };
    case 'random-step':
      return { shape: 'random', spreadMs: PHYSICS_STEP_MS };
    case 'random-8':
      return { shape: 'random', spreadMs: 8 };
    case 'preset':
    default:
      return presetSpreadMs > 0
        ? { shape: 'even', spreadMs: presetSpreadMs }
        : { shape: 'tight', spreadMs: 0 };
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

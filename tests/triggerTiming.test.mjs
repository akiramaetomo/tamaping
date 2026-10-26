import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ATTACK_TEST_OPTIONS,
  DEFAULT_ATTACK_TEST_MODE,
  DEFAULT_LOOKAHEAD_MS,
  DEFAULT_STEAL_FADE_MS,
  DEFAULT_TRIGGER_TEST_MODE,
  LOOKAHEAD_OPTIONS,
  STEAL_FADE_OPTIONS,
  TRIGGER_TEST_OPTIONS,
  computeStartOffsets,
  resolveAttackShape,
  resolveTriggerTiming,
} from '../.test-build/audio/triggerTiming.js';

test('trigger test modes resolve to shape and window', () => {
  assert.deepEqual(TRIGGER_TEST_OPTIONS.map(([mode]) => mode), ['tight-0', 'even-16', 'random-step']);
  assert.equal(DEFAULT_TRIGGER_TEST_MODE, 'random-step');
  assert.deepEqual(resolveTriggerTiming('tight-0'), { shape: 'tight', spreadMs: 0 });
  assert.deepEqual(resolveTriggerTiming('even-16'), { shape: 'even', spreadMs: 16 });
  assert.deepEqual(resolveTriggerTiming('random-step'), { shape: 'random', spreadMs: 1000 / 60 });
});

test('utility audio tuning defaults to 1ms steal fade and linear 1ms attack', () => {
  assert.equal(DEFAULT_STEAL_FADE_MS, 1);
  assert.equal(DEFAULT_ATTACK_TEST_MODE, 'linear-1');
  assert.ok(STEAL_FADE_OPTIONS.some(([value]) => value === DEFAULT_STEAL_FADE_MS));
  assert.ok(ATTACK_TEST_OPTIONS.some(([value]) => value === DEFAULT_ATTACK_TEST_MODE));
});

test('tight timing starts every impact at zero', () => {
  const offsets = computeStartOffsets([3, 1, 4], { shape: 'tight', spreadMs: 16 }, 5);
  assert.deepEqual([...offsets.values()], [0, 0, 0]);
});

test('even timing keeps the rotated evenly spaced grid', () => {
  const timing = { shape: 'even', spreadMs: 16 };
  const frame0 = computeStartOffsets([10, 11, 12], timing, 0);
  assert.deepEqual([...frame0.entries()], [[10, 0], [11, 0.008], [12, 0.016]]);

  const frame1 = computeStartOffsets([10, 11, 12], timing, 1);
  assert.deepEqual([...frame1.entries()], [[10, 0.008], [11, 0.016], [12, 0]]);
});

test('shared impact indices (ball-particle) get one offset', () => {
  const offsets = computeStartOffsets([7, 7, 8], { shape: 'even', spreadMs: 16 }, 0);
  assert.equal(offsets.size, 2);
  assert.deepEqual([...offsets.entries()], [[7, 0], [8, 0.016]]);
});

test('random timing draws independent offsets inside the window', () => {
  const draws = [0, 0.5, 0.999];
  let next = 0;
  const offsets = computeStartOffsets(
    [1, 2, 3],
    { shape: 'random', spreadMs: 8 },
    0,
    () => draws[next++],
  );
  const values = [...offsets.values()];
  assert.equal(values[0], 0);
  assert.equal(values[1], 0.004);
  assert.ok(values[2] < 0.008 && values[2] > 0.0079);

  for (let run = 0; run < 200; run += 1) {
    for (const value of computeStartOffsets([1, 2, 3, 4], { shape: 'random', spreadMs: 16 }, run).values()) {
      assert.ok(value >= 0 && value < 0.016);
    }
  }
});

test('a single impact always starts immediately', () => {
  for (const shape of ['tight', 'even', 'random']) {
    const offsets = computeStartOffsets([9], { shape, spreadMs: 16 }, 3, () => 0.7);
    assert.deepEqual([...offsets.entries()], [[9, 0]]);
  }
});

test('attack test modes resolve to curve and length', () => {
  assert.deepEqual(resolveAttackShape('exp-1'), { curve: 'exponential', ms: 1 });
  assert.deepEqual(resolveAttackShape('linear-1'), { curve: 'linear', ms: 1 });
  assert.deepEqual(resolveAttackShape('linear-2'), { curve: 'linear', ms: 2 });
  assert.deepEqual(resolveAttackShape('linear-4'), { curve: 'linear', ms: 4 });
});

test('lookahead defaults to 20ms and keeps 0ms for comparison', () => {
  assert.deepEqual(LOOKAHEAD_OPTIONS.map(([value]) => value), [0, 10, 20, 30, 50]);
  assert.equal(DEFAULT_LOOKAHEAD_MS, 20);
  assert.ok(LOOKAHEAD_OPTIONS.some(([value]) => value === DEFAULT_LOOKAHEAD_MS));
});

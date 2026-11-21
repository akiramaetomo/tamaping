import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FIXED_STEP_SECONDS,
  FixedStepClock,
  stepPolicyFromParams,
} from '../.test-build/app/stepClock.js';

const frames = (clock, delta, count, costMs) => {
  const steps = [];
  for (let index = 0; index < count; index += 1) {
    const n = clock.advance(delta);
    for (let step = 0; step < n; step += 1) {
      clock.recordStepCost(costMs);
    }
    steps.push(n);
  }
  return steps;
};

test('?step=legacy keeps the catch-up rule; anything else is adaptive', () => {
  assert.equal(stepPolicyFromParams(new URLSearchParams('?step=legacy')), 'legacy');
  assert.equal(stepPolicyFromParams(new URLSearchParams('?step=LEGACY')), 'legacy');
  assert.equal(stepPolicyFromParams(new URLSearchParams('')), 'adaptive');
  assert.equal(stepPolicyFromParams(new URLSearchParams('?step=x')), 'adaptive');
});

test('legacy runs 3 steps in a 50 ms frame however expensive they are', () => {
  const clock = new FixedStepClock('legacy');
  assert.deepEqual(frames(clock, 0.05, 5, 30), [3, 3, 3, 3, 3]);
  assert.equal(clock.simSpeed > 0.99, true);
});

test('adaptive matches legacy while steps are cheap', () => {
  const legacy = new FixedStepClock('legacy');
  const adaptive = new FixedStepClock('adaptive');
  const deltas = [1 / 60, 1 / 60, 0.03, 1 / 60, 0.05, 1 / 120, 1 / 120, 1 / 60];
  for (const delta of deltas) {
    const a = legacy.advance(delta);
    const b = adaptive.advance(delta);
    for (let step = 0; step < b; step += 1) {
      adaptive.recordStepCost(2);
    }
    assert.equal(b, a, `delta ${delta}`);
  }
});

test('adaptive runs one step per frame when two would pass the budget', () => {
  const clock = new FixedStepClock('adaptive');
  const steps = frames(clock, 0.05, 40, 14);
  assert.equal(steps[0], 3, 'the first frame has no cost estimate yet');
  assert.ok(steps.slice(1).every((n) => n === 1), `${steps}`);
  // Two thirds of the time is dropped instead of piling up.
  assert.ok(clock.simSpeed < 0.5, `sim speed ${clock.simSpeed}`);
});

test('adaptive at 60 Hz with a 14 ms step still runs every frame, at full speed', () => {
  const clock = new FixedStepClock('adaptive');
  const steps = frames(clock, FIXED_STEP_SECONDS, 120, 14);
  assert.ok(steps.every((n) => n === 1), `${steps}`);
  assert.ok(clock.simSpeed > 0.98, `sim speed ${clock.simSpeed}`);
});

test('adaptive at 120 Hz steps every other frame', () => {
  const clock = new FixedStepClock('adaptive');
  const steps = frames(clock, 1 / 120, 8, 3);
  assert.deepEqual(steps, [0, 1, 0, 1, 0, 1, 0, 1]);
});

test('the step budget allows more steps when steps are cheap', () => {
  const clock = new FixedStepClock('adaptive');
  clock.recordStepCost(3);
  assert.equal(clock.maxSteps, 3);
  clock.recordStepCost(1);
  assert.ok(clock.maxSteps >= 3);
  assert.equal(new FixedStepClock('legacy').maxSteps, Number.POSITIVE_INFINITY);
});

test('reset clears pending time and the speed reading', () => {
  const clock = new FixedStepClock('adaptive');
  frames(clock, 0.05, 20, 14);
  clock.reset();
  assert.equal(clock.simSpeed, 1);
  assert.equal(clock.advance(0.001), 0);
});

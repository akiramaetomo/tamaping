import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BALL_CURVE,
  DOT_CURVE,
  SpeedHold,
  TRAIL_MAX_RADII,
  TrailHistory,
  followDirection,
  headingOf,
  rayAlpha,
  rayScale,
  speedFactor,
  trailAlpha,
  trailLength,
} from '../.test-build/render/motionFx.js';

test('speed factor is 0 at rest, reaches 1 at full speed, and rejects bad input', () => {
  assert.equal(speedFactor(0), 0);
  assert.equal(speedFactor(DOT_CURVE.full), 1);
  assert.equal(speedFactor(DOT_CURVE.full * 10), 1);
  assert.equal(speedFactor(Number.NaN), 0);
  assert.equal(speedFactor(-5), 0);
  assert.equal(speedFactor(100, { knee: 0, full: 100 }), 0);
  assert.ok(speedFactor(100, BALL_CURVE) < speedFactor(100, DOT_CURVE));
});

test('the log curve spends its range on barely moving dots', () => {
  assert.ok(speedFactor(1) > 0.03, `speed 1 -> ${speedFactor(1)}`);
  assert.ok(speedFactor(30) > 0.35, `speed 30 -> ${speedFactor(30)}`);
  assert.ok(speedFactor(2) - speedFactor(1) > speedFactor(1000) - speedFactor(900));
});

test('trail never cuts off: length and opacity shrink continuously toward rest', () => {
  let previousLength = Infinity;
  let previousAlpha = Infinity;
  for (const speed of [1000, 300, 100, 30, 10, 3, 1, 0.3, 0.1, 0.01]) {
    const factor = speedFactor(speed);
    const length = trailLength(factor, 8);
    const alpha = trailAlpha(factor);
    assert.ok(length > 8, `speed ${speed}: tail reaches past the body`);
    assert.ok(alpha > 0, `speed ${speed}: tail still drawn`);
    assert.ok(length <= previousLength && alpha <= previousAlpha, `speed ${speed}: monotonic`);
    previousLength = length;
    previousAlpha = alpha;
  }
  assert.equal(trailAlpha(0), 0);
  assert.equal(trailLength(0, 8), 8, 'at rest the tail is fully under the body');
  assert.equal(trailLength(0.5, 0), 0);
  assert.equal(trailLength(1, 8), 8 * TRAIL_MAX_RADII);
});

test('slow dots carry a readable tail', () => {
  const factor = speedFactor(5);
  assert.ok(trailLength(factor, 8) >= 8 * 2, `length ${trailLength(factor, 8)}`);
  assert.ok(trailAlpha(factor) >= 0.6);
});

test('rays are always on, at least twice the radius, and grow with speed', () => {
  assert.ok(rayScale(0, 8) >= 16);
  assert.ok(rayAlpha(0) > 0);
  assert.ok(rayScale(1, 8) > rayScale(0.2, 8));
  assert.ok(rayAlpha(1) > rayAlpha(0.3));
  assert.ok(rayAlpha(5) <= 1);
});

test('heading follows fast motion quickly and slow motion slowly', () => {
  const [fastX] = followDirection(1, 0, 0, 500, 500, speedFactor(500));
  const [slowX] = followDirection(1, 0, 0, 1, 1, speedFactor(1));
  assert.ok(fastX < 0.8, `fast turns ${fastX}`);
  assert.ok(slowX > 0.99, `slow barely turns ${slowX}`);
  assert.deepEqual(followDirection(0.6, 0.8, 0, 0, 0, 0), [0.6, 0.8], 'rest keeps direction');
  const [x, y] = followDirection(1, 0, -3, 0, 3, 1);
  assert.ok(Math.abs(Math.hypot(x, y) - 1) < 1e-9);
});

test('heading is 0 for a resting dot and follows the velocity otherwise', () => {
  assert.equal(headingOf(0, 0), 0);
  assert.equal(headingOf(0, 1), Math.PI / 2);
  assert.equal(headingOf(-1, 0), Math.PI);
});

test('trail history samples by time and drops points older than its duration', () => {
  const history = new TrailHistory(100, 10);
  history.push(0, 0, 0);
  history.push(1, 0, 5);
  assert.equal(history.length, 1, 'points inside one sample interval merge');
  assert.equal(history.at(0).x, 1);

  for (let time = 10; time <= 200; time += 10) {
    history.push(time, 0, time);
  }
  assert.equal(history.at(0).x, 200);
  assert.ok(200 - history.at(history.length - 1).time <= 100);

  history.clear();
  assert.equal(history.length, 0);
});

test('speed hold bridges zero-speed frames and then decays', () => {
  const hold = new SpeedHold(0.1);
  const first = hold.update(1000, 0, 1, 0);
  assert.equal(first.speed, 1000);
  assert.equal(first.heading, Math.PI / 2);

  const gap = hold.update(0, 0, 0, 16);
  assert.ok(gap.speed > 800 && gap.speed < 1000, `held ${gap.speed}`);
  assert.equal(gap.heading, Math.PI / 2, 'heading survives a zero-speed frame');

  assert.ok(hold.update(0, 0, 0, 1000).speed < 1);
  assert.equal(hold.update(500, 1, 0, 1016).heading, 0);

  hold.reset();
  assert.equal(hold.update(0, 0, 0, 2000).speed, 0);
});

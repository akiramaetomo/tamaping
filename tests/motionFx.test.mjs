import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AFTERGLOW_FADE_SECONDS,
  AFTERGLOW_MAX_SECONDS,
  AFTERGLOW_MIN_LENGTH_RADII,
  AFTERGLOW_SECONDS,
  BALL_CURVE,
  DOT_CURVE,
  NO_MOTION_FX,
  SpeedHold,
  TRAIL_MAX_RADII,
  TrailHistory,
  afterglowBrightness,
  afterglowDecay,
  afterglowLife,
  afterglowTint,
  followDirection,
  headingOf,
  rayAlpha,
  rayScale,
  rayShapeExponent,
  scaleColor,
  shapeRotation,
  shapeTurns,
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

test('rays curve maps convex, straight and concave to superellipse exponents', () => {
  assert.equal(rayShapeExponent(1), 2);
  assert.equal(rayShapeExponent(0), 1);
  assert.equal(rayShapeExponent(-1), 0.5);
  assert.ok(Math.abs(rayShapeExponent(Math.log2(2 / 3)) - 2 / 3) < 1e-12);
  assert.equal(rayShapeExponent(3), 2);
  assert.equal(rayShapeExponent(-3), 0.5);
  assert.equal(rayShapeExponent(Number.NaN), 2);
  assert.equal(rayShapeExponent(NO_MOTION_FX.raysCurve), 2);
});

test('shape turn only rotates shapes with a front', () => {
  assert.equal(NO_MOTION_FX.shapeTurn, false);
  assert.equal(shapeTurns('fish'), true);
  assert.equal(shapeTurns('star'), true);
  assert.equal(shapeTurns('circle'), false);
  assert.equal(shapeTurns('none'), false);
  assert.equal(shapeRotation('fish', true, 1.2), 1.2);
  // The star points up, so a quarter turn puts a point along the heading.
  assert.equal(shapeRotation('star', true, 0), Math.PI / 2);
  assert.equal(shapeRotation('fish', false, 1.2), 0);
  assert.equal(shapeRotation('circle', true, 1.2), 0);
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

test('afterglow ages by time, not frame rate, and clears after a stall', () => {
  assert.equal(afterglowDecay(0), 0);
  assert.equal(afterglowDecay(-1), 0);
  assert.equal(afterglowDecay(Number.NaN), 0);
  // 30, 60 and 120 fps use up the same life in one second.
  const used = (fps) => afterglowDecay(1 / fps) * fps;
  assert.ok(Math.abs(used(30) - used(120)) < 1e-12);
  assert.ok(afterglowDecay(AFTERGLOW_MAX_SECONDS) >= 1);
  assert.equal(NO_MOTION_FX.afterglow, false);
});

test('afterglow lives longer for slow bodies, within its limits', () => {
  const radius = 8;
  // Fast: the short life.
  assert.equal(afterglowLife(1000, radius), AFTERGLOW_SECONDS);
  // Slow: long enough to reach the minimum length behind the body.
  const speed = 30;
  const life = afterglowLife(speed, radius);
  assert.ok(life > AFTERGLOW_SECONDS && life < AFTERGLOW_MAX_SECONDS);
  assert.ok(Math.abs(speed * life - AFTERGLOW_MIN_LENGTH_RADII * radius) < 1e-9);
  // The slowest speed that still reaches the minimum length gets the
  // longest life; below it, almost still bodies fall back to the short one.
  const slowest = (AFTERGLOW_MIN_LENGTH_RADII * radius) / AFTERGLOW_MAX_SECONDS;
  assert.ok(Math.abs(afterglowLife(slowest, radius) - AFTERGLOW_MAX_SECONDS) < 1e-9);
  assert.ok(afterglowLife(slowest * 0.5, radius) < AFTERGLOW_MAX_SECONDS);
  assert.ok(afterglowLife(slowest * 0.5, radius) > AFTERGLOW_SECONDS);
  assert.ok(afterglowLife(0.01, radius) - AFTERGLOW_SECONDS < 0.01);
  assert.equal(afterglowLife(0, radius), AFTERGLOW_SECONDS);
  assert.equal(afterglowLife(Number.NaN, radius), AFTERGLOW_SECONDS);
});

test('a longer-lived afterglow is dimmer, and colours scale per channel', () => {
  assert.equal(afterglowBrightness(AFTERGLOW_SECONDS), 1);
  assert.equal(afterglowBrightness(0), 1);
  const slow = afterglowBrightness(AFTERGLOW_MAX_SECONDS);
  assert.ok(slow > 0 && slow < 1);
  assert.ok(Math.abs(slow - Math.sqrt(AFTERGLOW_SECONDS / AFTERGLOW_MAX_SECONDS)) < 1e-12);
  assert.equal(scaleColor(0xff8040, 1), 0xff8040);
  assert.equal(scaleColor(0xff8040, 0.5), 0x804020);
  assert.equal(scaleColor(0xffffff, 0), 0);
  assert.equal(scaleColor(0x123456, 2), 0x123456);
});

test('afterglow tint keeps the light of a fast glow and dims slower ones', () => {
  // Fast: the stamp's light times its opacity (life share) is the colour
  // times AFTERGLOW_SECONDS / MAX, the same for every life except dimming.
  const share = (life) => life / AFTERGLOW_MAX_SECONDS;
  const light = (life) => (afterglowTint(0xff0000, life) >> 16) / 255 * share(life);
  const fast = light(AFTERGLOW_SECONDS);
  assert.ok(Math.abs(fast - AFTERGLOW_SECONDS / AFTERGLOW_MAX_SECONDS) < 0.01);
  const slow = light(AFTERGLOW_MAX_SECONDS);
  assert.ok(Math.abs(slow / fast - afterglowBrightness(AFTERGLOW_MAX_SECONDS)) < 0.02);
  assert.equal(afterglowTint(0xff0000, 0), afterglowTint(0xff0000, AFTERGLOW_SECONDS));
});

test('an afterglow stamped as already aged carries that much less life and light', () => {
  // Opacity (life share) times tint is the stored light.
  const stored = (age) =>
    ((afterglowTint(0xff0000, AFTERGLOW_SECONDS, age) >> 16) / 255) * ((AFTERGLOW_SECONDS - age) / AFTERGLOW_MAX_SECONDS);
  const fresh = stored(0);
  const aged = stored(0.1);
  assert.ok(Math.abs(aged / fresh - Math.exp(-0.1 / AFTERGLOW_FADE_SECONDS)) < 0.02);
});

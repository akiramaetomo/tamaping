import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FISH_HALF_SPAN_RADII,
  FISH_LENGTH_RADII,
  FISH_NOSE_RADII,
  FISH_TAIL_RADII,
  FishMotion,
  FishSpine,
  STRAIGHT_FISH,
  fishBeatHz,
  fishHalfWidth,
  fishParts,
  fishSwing,
  curlForTurnRate,
  followTurnRate,
  headingDelta,
} from '../.test-build/render/fishBody.js';

const tailTip = (pose) => {
  const spine = new FishSpine(FISH_TAIL_RADII, 80).compute(pose);
  return [spine.x[80], spine.y[80]];
};

test('fish is a long body around the physics disc, with two fins and an unsplit tail', () => {
  const [body, upperFin, lowerFin] = fishParts(STRAIGHT_FISH);
  assert.deepEqual(body[0], [FISH_NOSE_RADII, 0], 'nose leads along +x');
  const xs = body.map(([x]) => x);
  assert.ok(Math.abs(Math.min(...xs) + FISH_TAIL_RADII) < 1e-9, 'tail tip');
  // The user asked for a length of at least four head sizes; the widest
  // part is a little wider than the physics disc.
  const width = 2 * Math.max(...body.map(([, y]) => y));
  assert.ok(width >= 2 && width < 2.5, `body width ${width}`);
  assert.ok(FISH_LENGTH_RADII / width >= 4);
  for (const [x, y] of body) {
    // Straight fish: symmetric.
    assert.ok(body.some(([mx, my]) => Math.abs(mx - x) < 1e-9 && Math.abs(my + y) < 1e-9));
  }
  // The head covers the physics disc, so the disc never shows outside it.
  for (let index = 0; index < 32; index += 1) {
    const angle = (index / 32) * Math.PI * 2;
    const x = Math.cos(angle) * 0.98;
    assert.ok(Math.abs(Math.sin(angle) * 0.98) <= fishHalfWidth(x), `disc point at ${angle}`);
  }
  // Not split: the outline meets the axis only at the nose and the tail tip.
  assert.equal(body.filter(([, y]) => Math.abs(y) < 1e-9).length, 2);
  // Pectoral fins: behind the head, reaching out past the body on each side.
  for (const [fin, side] of [[upperFin, 1], [lowerFin, -1]]) {
    const reach = Math.max(...fin.map(([, y]) => side * y));
    assert.ok(reach > 1.5 && reach <= FISH_HALF_SPAN_RADII, `fin reach ${reach}`);
    assert.ok(Math.max(...fin.map(([x]) => x)) < 0, 'fins sit behind the disc centre');
  }
});

test('the spine bends without changing length, and the head stays rigid', () => {
  for (const [spine, pose] of [
    [new FishSpine(FISH_TAIL_RADII, 40), STRAIGHT_FISH],
    [new FishSpine(FISH_TAIL_RADII, 40), { phase: 1, swing: 1, curl: 0 }],
    [new FishSpine(FISH_TAIL_RADII, 40, 0.5), { phase: 2, swing: 1, curl: -1 }],
  ]) {
    spine.compute(pose);
    assert.equal(spine.x[0], 0);
    assert.equal(spine.y[0], 0);
    assert.equal(spine.angle[0], 0, 'head direction does not move');
    let length = 0;
    for (let index = 1; index <= 40; index += 1) {
      length += Math.hypot(spine.x[index] - spine.x[index - 1], spine.y[index] - spine.y[index - 1]);
    }
    assert.ok(Math.abs(length - FISH_TAIL_RADII) < 1e-9, `length ${length}`);
  }
});

test('the beat swings the tail; a turn curls it toward the inside', () => {
  const sway = (swing) => {
    const ys = Array.from({ length: 24 }, (_, index) => tailTip({ phase: (index / 24) * Math.PI * 2, swing, curl: 0 })[1]);
    return Math.max(...ys) - Math.min(...ys);
  };
  const full = sway(1);
  assert.ok(full > 1.2 && full < 1.6, `full beat ${full}`);
  assert.ok(sway(fishSwing(0)) < full * 0.15, 'a resting fish barely moves');

  const [, left] = tailTip({ phase: 0, swing: 0, curl: 1 });
  const [, right] = tailTip({ phase: 0, swing: 0, curl: -1 });
  assert.ok(left > 3, `positive curl bends toward +y (${left})`);
  assert.ok(Math.abs(left + right) < 1e-9, 'curl is symmetric');

  // The body thins toward the tail, so a turn bends it most there: the
  // curvature (turn per arc length) grows along the body, and the tail fin
  // bends far more than the front of the body.
  const spine = new FishSpine(FISH_TAIL_RADII, 40, 0.5).compute({ phase: 0, swing: 0, curl: 1 });
  // Turn between neighbouring segments, per arc length.
  const direction = (index) => Math.atan2(spine.y[index] - spine.y[index + 1], spine.x[index] - spine.x[index + 1]);
  const curvature = [];
  for (let index = 1; index < 40; index += 1) {
    const ds = (spine.s[index + 1] - spine.s[index - 1]) / 2;
    // Wrapped: a strong curl turns the tail past pi.
    curvature.push(Math.abs(headingDelta(direction(index - 1), direction(index))) / ds);
  }
  for (let index = 1; index < curvature.length; index += 1) {
    assert.ok(curvature[index] >= curvature[index - 1] - 1e-9, `curvature grows at ${index}`);
  }
  assert.ok(curvature.at(-1) > curvature[0] * 4, 'the tail fin bends far more than the front');
  // Denser spine points toward the tail.
  assert.ok(spine.s[40] - spine.s[39] < (spine.s[1] - spine.s[0]) / 2);
});

test('fish motion: a very slow beat at rest, faster when swimming, curl from turn rate', () => {
  // The user asked for less than a quarter of the first rest beat (0.5/s).
  assert.ok(fishBeatHz(0) < 0.5 / 4);
  assert.ok(fishBeatHz(1) > fishBeatHz(0.3));
  assert.equal(fishBeatHz(5), fishBeatHz(1));

  assert.ok(Math.abs(headingDelta(3, -3) - (2 * Math.PI - 6)) < 1e-12, 'wraps across pi');
  assert.equal(followTurnRate(2, 100, 0), 2, 'no time, no change');
  assert.equal(curlForTurnRate(100), 1);
  assert.equal(curlForTurnRate(-100), -1);

  // A heading that only moves on every other frame (the pointer-driven
  // ball) at an average 6 rad/s still reaches full curl.
  const steppy = new FishMotion();
  let steppyPose = steppy.update(0.5, 0, 1 / 60);
  for (let frame = 1; frame <= 60; frame += 1) {
    steppyPose = steppy.update(0.5, Math.floor(frame / 2) * 0.2, 1 / 60);
  }
  assert.ok(steppyPose.curl > 0.95, `uneven heading updates still curl fully (${steppyPose.curl})`);

  const motion = new FishMotion();
  let pose = motion.update(0.5, 0, 1 / 60);
  for (let frame = 1; frame <= 30; frame += 1) {
    // Turning at 6 rad/s, heading increasing.
    pose = motion.update(0.5, frame * 0.1, 1 / 60);
  }
  assert.ok(pose.curl > 0.9, `fast turn curls fully (${pose.curl})`);
  for (let frame = 0; frame < 60; frame += 1) {
    pose = motion.update(0.5, null, 1 / 60);
  }
  assert.ok(pose.curl < 0.01, 'curl relaxes when the fish does not turn');
});

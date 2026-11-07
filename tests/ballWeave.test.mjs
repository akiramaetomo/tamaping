import test from 'node:test';
import assert from 'node:assert/strict';

import RAPIER from '@dimforge/rapier2d-compat';

import {
  WEAVE_MAX_TURN_RATE,
  WEAVE_PUSH,
  WEAVE_RANGE,
  nextWallTurn,
  wallTurnVelocity,
  weavePushFromAgility,
  weaveRangeFromSight,
  weaveVelocity,
} from '../.test-build/sim/ballWeave.js';
import { normalizePresetSettings } from '../.test-build/sim/presets.js';
import { DEFAULT_SETTINGS } from '../.test-build/sim/settings.js';
import { DotpingPhysicsWorld } from '../.test-build/sim/physicsWorld.js';

await RAPIER.init();

const DT = 1 / 60;
const BALL = { x: 0, y: 0 };
const CONTACT = 24;

function turnDegrees(before, after) {
  const cross = before.x * after.y - before.y * after.x;
  const dot = before.x * after.x + before.y * after.y;
  return (Math.atan2(cross, dot) * 180) / Math.PI;
}

test('weave changes direction, never speed', () => {
  const velocity = { x: 300, y: 40 };
  const next = weaveVelocity(velocity, BALL, CONTACT, [{ x: 60, y: 20 }, { x: 70, y: -5 }], DT);
  assert.notDeepEqual(next, velocity);
  assert.ok(Math.abs(Math.hypot(next.x, next.y) - Math.hypot(velocity.x, velocity.y)) < 1e-9);
});

test('weave turns away from a particle ahead, on either side', () => {
  const velocity = { x: 200, y: 0 };
  // +y is the screen's down direction; only the sign of the turn matters.
  assert.ok(turnDegrees(velocity, weaveVelocity(velocity, BALL, CONTACT, [{ x: 60, y: 20 }], DT)) < 0);
  assert.ok(turnDegrees(velocity, weaveVelocity(velocity, BALL, CONTACT, [{ x: 60, y: -20 }], DT)) > 0);
});

test('weave goes straight through the centre of a gap', () => {
  const velocity = { x: 200, y: 0 };
  const next = weaveVelocity(velocity, BALL, CONTACT, [{ x: 40, y: 50 }, { x: 40, y: -50 }], DT);
  assert.ok(Math.abs(turnDegrees(velocity, next)) < 1e-9);
});

test('weave ignores particles behind the ball or out of range', () => {
  const velocity = { x: 200, y: 0 };
  const particles = [{ x: -40, y: 20 }, { x: CONTACT + WEAVE_RANGE + 1, y: 20 }];
  assert.deepEqual(weaveVelocity(velocity, BALL, CONTACT, particles, DT), {
    x: 200,
    y: 0,
  });
});

test('weave turns a fast ball less than a slow one, and keeps the turn-rate limit', () => {
  const near = [{ x: 40, y: 15 }];
  const turn = (speed) => Math.abs(turnDegrees(
    { x: speed, y: 0 },
    weaveVelocity({ x: speed, y: 0 }, BALL, CONTACT, near, DT),
  ));
  assert.ok(turn(1200) < turn(300));
  assert.ok(turn(20) <= (WEAVE_MAX_TURN_RATE * DT * 180) / Math.PI + 1e-9);
  assert.ok(WEAVE_PUSH > 0);
});

test('weave leaves a stopped ball alone', () => {
  const stopped = { x: 1, y: 1 };
  assert.equal(weaveVelocity(stopped, BALL, CONTACT, [{ x: 30, y: 10 }], DT), stopped);
});

function seededWorld(settings) {
  const original = Math.random;
  let state = 7;
  Math.random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const world = new DotpingPhysicsWorld(RAPIER, 360, 800, settings);
  Math.random = original;
  return world;
}

function flingAndRun(settings, steps = 240) {
  const world = seededWorld(settings);
  world.controlBall.setLinvel({ x: 180, y: -240 }, true);
  for (let index = 0; index < steps; index += 1) {
    world.step(DT);
  }
  return world.snapshot();
}

const SCENE = {
  ...DEFAULT_SETTINGS,
  particleCount: 30,
  controlBallRadius: 12,
  controlBallLinearDamping: 0,
  gravityMode: 'antigravity',
  gravityStrength: 0.5,
};

test('with weave off, the world matches a world with the weave step removed', () => {
  const run = (removeStep) => {
    const world = seededWorld({ ...SCENE, ballWeave: false });
    if (removeStep) {
      world.applyBallWeave = () => {};
    }
    world.controlBall.setLinvel({ x: 180, y: -240 }, true);
    for (let index = 0; index < 240; index += 1) {
      world.step(DT);
    }
    return world.snapshot();
  };
  assert.deepEqual(run(false), run(true));
});

test('with weave on, the released ball takes a different path at the same speed', () => {
  const run = (ballWeave) => {
    const world = seededWorld({ ...SCENE, gravityMode: 'none', particleCount: 1, ballWeave });
    world.controlBall.setTranslation({ x: 180, y: 400 }, true);
    world.controlBall.setLinvel({ x: 0, y: -200 }, true);
    world.arrangeParticlesToTargets([{ x: 190, y: 360, vx: 0, vy: 0 }]);
    // Few enough steps that the ball does not reach the particle.
    for (let index = 0; index < 4; index += 1) {
      world.step(DT);
    }
    return world.snapshot().controlBall;
  };
  const off = run(false);
  const on = run(true);
  assert.equal(off.x, 180);
  assert.ok(on.x < 180, `steers away from the particle on its right: ${on.x}`);
  assert.ok(Math.abs(on.speed - 200) < 0.01, `speed ${on.speed}`);
});

test('a pressed ball follows the pointer the same with weave on or off', () => {
  const run = (ballWeave) => {
    const world = seededWorld({ ...SCENE, ballWeave });
    world.setPointer(true, 40, 40);
    for (let index = 0; index < 60; index += 1) {
      world.step(DT);
    }
    return world.snapshot().controlBall;
  };
  assert.deepEqual(run(true), run(false));
});

test('presets without the weave field apply weave off, and keep it when stored', () => {
  assert.equal(DEFAULT_SETTINGS.ballWeave, false);
  assert.equal(normalizePresetSettings({}).ballWeave, false);
  assert.equal(normalizePresetSettings({ ballWeave: 'yes' }).ballWeave, false);
  assert.equal(normalizePresetSettings({ ballWeave: true }).ballWeave, true);
});

test('agility and sight scales double as agreed, with 50 as the accepted motion', () => {
  assert.equal(weavePushFromAgility(0), 125);
  assert.equal(weavePushFromAgility(50), WEAVE_PUSH);
  assert.equal(weavePushFromAgility(100), 8000);
  assert.equal(weaveRangeFromSight(0), 20);
  assert.equal(weaveRangeFromSight(50), WEAVE_RANGE);
  assert.equal(weaveRangeFromSight(100), 80);
});

test('presets without agility or sight apply 50, and stored values stay in range', () => {
  const missing = normalizePresetSettings({ ballWeave: true });
  assert.equal(missing.ballWeaveAgility, 50);
  assert.equal(missing.ballWeaveSight, 50);
  const stored = normalizePresetSettings({ ballWeaveAgility: 80, ballWeaveSight: 500 });
  assert.equal(stored.ballWeaveAgility, 80);
  assert.equal(stored.ballWeaveSight, 100);
  assert.equal(normalizePresetSettings({ ballWeaveAgility: 'high' }).ballWeaveAgility, 50);
});

function firstSteps(overrides) {
  const world = seededWorld({ ...SCENE, gravityMode: 'none', particleCount: 1, ballWeave: true, ...overrides });
  world.controlBall.setTranslation({ x: 180, y: 400 }, true);
  world.controlBall.setLinvel({ x: 0, y: -200 }, true);
  // With radii 12 and 4, the surface gap stays between 50 and 65 px over these
  // steps: past `Sight` 50 (40 px), inside `Sight` 100 (80 px).
  world.arrangeParticlesToTargets([{ x: 190, y: 320, vx: 0, vy: 0 }]);
  for (let index = 0; index < 4; index += 1) {
    world.step(DT);
  }
  return world.snapshot().controlBall;
}

test('a higher agility turns the ball harder in the world', () => {
  const offset = (ballWeaveAgility) => 180 - firstSteps({ ballWeaveSight: 100, ballWeaveAgility }).x;
  assert.ok(offset(100) > offset(50) && offset(50) > offset(0), 'agility 0 < 50 < 100');
  assert.ok(offset(0) > 0);
});

test('a higher sight notices a particle that a lower sight ignores', () => {
  const radii = { controlBallRadius: 12, particleRadius: 4 };
  assert.equal(firstSteps({ ...radii, ballWeaveSight: 50 }).x, 180);
  assert.ok(firstSteps({ ...radii, ballWeaveSight: 100 }).x < 180);
});

function runAtWall(overrides, velocity, position = { x: 180, y: 120 }, steps = 120) {
  const world = seededWorld({ ...SCENE, gravityMode: 'none', particleCount: 1, ballWeave: true, ...overrides });
  world.controlBall.setTranslation(position, true);
  world.controlBall.setLinvel(velocity, true);
  world.arrangeParticlesToTargets([{ x: 340, y: 780, vx: 0, vy: 0 }]);
  let closest = Infinity;
  for (let index = 0; index < steps; index += 1) {
    world.step(DT);
    closest = Math.min(closest, world.snapshot().controlBall.y);
  }
  return { ball: world.snapshot().controlBall, closest };
}

test('a ball heading straight at a wall turns back before it without losing speed', () => {
  const { ball, closest } = runAtWall({}, { x: 0, y: -200 });
  assert.ok(closest > 12 + 1, `stays clear of the wall: ${closest}`);
  assert.ok(ball.vy > 199 && Math.abs(ball.vx) < 1, `heads straight back: ${ball.vx}, ${ball.vy}`);
  assert.ok(Math.abs(ball.speed - 200) < 0.01, `speed ${ball.speed}`);
});

test('a wall turn leaves at the mirror of the approach', () => {
  const { ball } = runAtWall({}, { x: 120, y: -160 }, { x: 60, y: 120 }, 60);
  assert.ok(Math.abs(ball.vx - 120) < 1 && Math.abs(ball.vy - 160) < 1, `${ball.vx}, ${ball.vy}`);
});

// The longest run of turning one way, in full turns. A short straight stretch ends
// a run, so separate turns at separate walls do not add up.
function longestSpin(overrides, velocity, position, steps = 420) {
  const world = seededWorld({ ...SCENE, gravityMode: 'none', particleCount: 1, ballWeave: true, ...overrides });
  world.arrangeParticlesToTargets([{ x: 4, y: 796, vx: 0, vy: 0 }]);
  world.controlBall.setTranslation(position, true);
  world.controlBall.setLinvel(velocity, true);
  let previous = velocity;
  let spin = 0;
  let straight = 0;
  let longest = 0;
  for (let index = 0; index < steps; index += 1) {
    world.step(DT);
    const ball = world.snapshot().controlBall;
    const angle = Math.atan2(previous.x * ball.vy - previous.y * ball.vx, previous.x * ball.vx + previous.y * ball.vy);
    previous = { x: ball.vx, y: ball.vy };
    if (Math.abs(angle) < 1e-4) {
      straight += 1;
      spin = straight > 3 ? 0 : spin;
    } else {
      straight = 0;
      spin = Math.sign(angle) === Math.sign(spin) ? spin + angle : angle;
    }
    longest = Math.max(longest, Math.abs(spin));
  }
  return longest / (2 * Math.PI);
}

test('a ball never keeps circling at a wall, whatever the approach', () => {
  for (const ballWeaveAgility of [0, 50, 100]) {
    for (const speed of [50, 200, 600]) {
      for (const degrees of [0, 0.5, 1, 5, 30, 45, 89, 90, 90.5, 135, 180, 225, 270, 359]) {
        const radians = (degrees * Math.PI) / 180;
        const velocity = { x: Math.cos(radians) * speed, y: Math.sin(radians) * speed };
        const turns = longestSpin({ ballWeaveAgility }, velocity, { x: 180, y: 400 });
        // A U-turn is half a turn, and a second wall in a corner can add a little. At
        // Agility 0 the turning circle can be wider than the 360 px box, so turns at
        // two walls can run together. The circling bug reached 20 turns or more.
        const limit = ballWeaveAgility === 0 ? 1.1 : 0.75;
        assert.ok(turns <= limit, `Agility ${ballWeaveAgility}, ${speed} px/s, ${degrees} degrees: ${turns} turns`);
      }
    }
  }
});

test('a shallow approach leaves the wall instead of running along it', () => {
  const { ball } = runAtWall({}, { x: 200, y: -20 }, { x: 40, y: 30 }, 60);
  assert.ok(ball.vy / ball.speed >= 0.33, `leaves at an angle: ${ball.vy}`);
});

test('with Walls off, the ball bounces off the wall and loses speed', () => {
  const { ball, closest } = runAtWall({ ballWeaveWalls: false, wallRestitution: 0.5 }, { x: 0, y: -200 });
  assert.ok(closest < 12 + 1, `reaches the wall: ${closest}`);
  assert.ok(ball.speed < 150, `speed ${ball.speed}`);
});

test('a ball too fast to turn in time still hits the wall', () => {
  const { ball, closest } = runAtWall({ wallRestitution: 0.5 }, { x: 0, y: -3000 }, undefined, 30);
  assert.ok(closest < 12 + 1, `reaches the wall: ${closest}`);
  assert.ok(ball.speed < 3000, `speed ${ball.speed}`);
});

test('a contact ends a wall turn, and a turn ends when its angle is used up', () => {
  const wall = { normalX: 0, normalY: -1, sign: -1, remaining: 1 };
  const args = [{ x: 180, y: 300 }, 12, 360, 800, 1000];
  assert.equal(nextWallTurn(wall, { x: 100, y: 0 }, ...args, true), null);
  assert.deepEqual(nextWallTurn(wall, { x: 100, y: 0 }, ...args, false), wall);
  assert.equal(nextWallTurn({ ...wall, remaining: 0 }, { x: 100, y: 0 }, ...args, false), null);
});

test('the last step of a wall turn uses only the angle left', () => {
  const turn = { normalX: 0, normalY: -1, sign: -1, remaining: 0.01 };
  const next = wallTurnVelocity({ x: 100, y: 0 }, turn, 1000, DT);
  assert.equal(turn.remaining, 0);
  assert.ok(Math.abs(Math.atan2(next.y, next.x) + 0.01) < 1e-9);
});

test('a slow-moving damped ball is not mistaken for a contact during a wall turn', () => {
  const { closest } = runAtWall({ controlBallLinearDamping: 1 }, { x: 0, y: -200 });
  assert.ok(closest > 12 + 1, `stays clear of the wall: ${closest}`);
});

test('presets without Walls apply on, and keep it when stored', () => {
  assert.equal(DEFAULT_SETTINGS.ballWeaveWalls, true);
  assert.equal(normalizePresetSettings({}).ballWeaveWalls, true);
  assert.equal(normalizePresetSettings({ ballWeaveWalls: false }).ballWeaveWalls, false);
});

test('ball weight does not change how the ball turns', () => {
  const light = firstSteps({ ballWeaveSight: 100, controlBallMass: 0.1 });
  const heavy = firstSteps({ ballWeaveSight: 100, controlBallMass: 1000 });
  assert.ok(light.x < 180);
  assert.ok(Math.abs(light.x - heavy.x) < 1e-6, `${light.x} and ${heavy.x}`);
});

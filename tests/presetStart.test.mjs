import test from 'node:test';
import assert from 'node:assert/strict';

import RAPIER from '@dimforge/rapier2d-compat';

import { DEFAULT_SETTINGS } from '../.test-build/sim/settings.js';
import { DotpingPhysicsWorld } from '../.test-build/sim/physicsWorld.js';
import {
  DEFAULT_PRESET_START,
  START_SCATTER_SPEED,
  START_SPIRAL_SPEED,
  normalizePresetStart,
  randomDirectionVelocity,
  spiralSpeedFactor,
  startBallPosition,
  startFromInitialFormation,
} from '../.test-build/sim/presetStart.js';
import {
  FACTORY_PRESETS,
  PRESET_EXPORT_SCHEMA_VERSION,
  createAutosaveExport,
  createCurrentPresetExport,
  createUserPresetExport,
  parsePresetExport,
} from '../.test-build/sim/presets.js';
import { parseWorkingState } from '../.test-build/app/workingState.js';

await RAPIER.init();

const WIDTH = 360;
const HEIGHT = 800;
const START = { formation: 'spiral', ballX: 20, ballY: 30, ballSpeed: 400, particleSpeed: 60 };

function seeded(seed = 1) {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function world(overrides = {}) {
  return new DotpingPhysicsWorld(RAPIER, WIDTH, HEIGHT, {
    ...DEFAULT_SETTINGS,
    particleCount: 40,
    gravityMode: 'none',
    ...overrides,
  });
}

const speedOf = (body) => Math.hypot(body.vx, body.vy);

test('start values are clamped, and missing or broken values use the default', () => {
  assert.deepEqual(normalizePresetStart(undefined), DEFAULT_PRESET_START);
  assert.deepEqual(normalizePresetStart('spiral'), DEFAULT_PRESET_START);
  assert.deepEqual(
    normalizePresetStart({ formation: 'ring', ballX: -5, ballY: 250, ballSpeed: 5000, particleSpeed: Number.NaN }),
    { ...DEFAULT_PRESET_START, ballX: 0, ballY: 100, ballSpeed: 1000 },
  );
  assert.deepEqual(normalizePresetStart(START), START);
  assert.equal(DEFAULT_PRESET_START.particleSpeed, START_SCATTER_SPEED);
});

test('factory initial formations move to starts that keep their look', () => {
  assert.deepEqual(startFromInitialFormation('random'), DEFAULT_PRESET_START);
  assert.deepEqual(startFromInitialFormation(undefined), DEFAULT_PRESET_START);
  assert.deepEqual(startFromInitialFormation('name'), { ...DEFAULT_PRESET_START, formation: 'name', particleSpeed: 0 });
  assert.deepEqual(
    startFromInitialFormation('flash'),
    { ...DEFAULT_PRESET_START, formation: 'spiral', particleSpeed: START_SPIRAL_SPEED },
  );
  assert.ok(FACTORY_PRESETS.every((preset) => preset.start.ballSpeed === 0 && preset.start.ballY === 68));
});

test('the spiral keeps the old Flash speed pattern, with the slider as its average', () => {
  assert.equal(spiralSpeedFactor(0), 0);
  const factors = [1, 2, 3, 4, 5].map(spiralSpeedFactor);
  const mean = factors.reduce((sum, value) => sum + value, 0) / factors.length;
  assert.ok(Math.abs(mean - 1) < 1e-9, `mean ${mean}`);
  // Old Flash: 36 px/s times 0.65..0.93.
  assert.ok(Math.abs(START_SPIRAL_SPEED * spiralSpeedFactor(5) - 36 * 0.65) < 1);
  assert.ok(Math.abs(START_SPIRAL_SPEED * spiralSpeedFactor(4) - 36 * 0.93) < 1);
});

test('ball start position is a fraction of the stage kept one radius inside', () => {
  assert.deepEqual(startBallPosition({ ballX: 50, ballY: 68 }, 400, 1000, 20), { x: 200, y: 680 });
  assert.deepEqual(startBallPosition({ ballX: 0, ballY: 100 }, 400, 1000, 20), { x: 20, y: 980 });
  assert.deepEqual(randomDirectionVelocity(0, seeded()), { vx: 0, vy: 0 });
  const velocity = randomDirectionVelocity(250, seeded());
  assert.ok(Math.abs(Math.hypot(velocity.vx, velocity.vy) - 250) < 1e-9);
});

test('a start sets the Ball and particles, and zero speeds leave them still', () => {
  const physics = world();
  physics.applyStart({ ...START, formation: 'random', ballSpeed: 0, particleSpeed: 0 }, null, seeded());
  const snapshot = physics.snapshot();
  const ball = startBallPosition(START, WIDTH, HEIGHT, DEFAULT_SETTINGS.controlBallRadius);
  assert.ok(Math.abs(snapshot.controlBall.x - ball.x) < 1e-3);
  assert.ok(Math.abs(snapshot.controlBall.y - ball.y) < 1e-3);
  assert.equal(speedOf(snapshot.controlBall), 0);
  assert.ok(snapshot.particles.every((particle) => speedOf(particle) === 0));
});

test('random and name starts give every particle the slider speed in a random direction', () => {
  for (const formation of ['random', 'name']) {
    const physics = world();
    const targets = formation === 'name' ? [{ x: 100, y: 100, vx: 0, vy: 0 }, { x: 140, y: 100, vx: 0, vy: 0 }] : null;
    physics.applyStart({ ...START, formation }, targets, seeded(3));
    const snapshot = physics.snapshot();
    assert.ok(Math.abs(speedOf(snapshot.controlBall) - START.ballSpeed) < 1e-3);
    assert.ok(snapshot.particles.every((particle) => Math.abs(speedOf(particle) - START.particleSpeed) < 1e-3));
    const angles = new Set(snapshot.particles.map((particle) => Math.round(Math.atan2(particle.vy, particle.vx) * 10)));
    assert.ok(angles.size > 10, `${formation} directions vary`);
    if (formation === 'name') {
      assert.deepEqual([snapshot.particles[0].x, snapshot.particles[0].y], [100, 100]);
      assert.deepEqual([snapshot.particles[3].x, snapshot.particles[3].y], [140, 100]);
    }
  }
});

test('a spiral start spins along the spiral around the Ball', () => {
  const physics = world();
  physics.applyStart(START, null, seeded());
  const { controlBall, particles } = physics.snapshot();
  assert.equal(speedOf(particles[0]), 0);
  for (let index = 1; index < particles.length; index += 1) {
    const particle = particles[index];
    const dx = particle.x - controlBall.x;
    const dy = particle.y - controlBall.y;
    const radial = (dx * particle.vx + dy * particle.vy) / Math.hypot(dx, dy);
    assert.ok(Math.abs(radial) < 1e-3, `particle ${index} moves along the spiral`);
    assert.ok(Math.abs(speedOf(particle) - START.particleSpeed * spiralSpeedFactor(index)) < 1e-3);
  }
});

test('the same random source gives the same start', () => {
  const a = world();
  const b = world();
  a.applyStart({ ...START, formation: 'random' }, null, seeded(7));
  b.applyStart({ ...START, formation: 'random' }, null, seeded(7));
  assert.deepEqual(
    a.snapshot().particles.map((particle) => [particle.vx, particle.vy]),
    b.snapshot().particles.map((particle) => [particle.vx, particle.vy]),
  );
});

test('an absent Touch ball takes the start position but does not move', () => {
  const physics = world({ controlBallMode: 'touch' });
  physics.applyStart(START, null, seeded());
  const { controlBall } = physics.snapshot();
  const ball = startBallPosition(START, WIDTH, HEIGHT, DEFAULT_SETTINGS.controlBallRadius);
  assert.equal(controlBall.visible, false);
  assert.ok(Math.abs(controlBall.x - ball.x) < 1e-3 && Math.abs(controlBall.y - ball.y) < 1e-3);
  assert.equal(speedOf(controlBall), 0);
});

test('starts travel through exports, imports and the autosave, and old files read as the default', () => {
  assert.equal(PRESET_EXPORT_SCHEMA_VERSION, 14);
  const settings = FACTORY_PRESETS[0].settings;

  const current = createCurrentPresetExport('Work', DEFAULT_SETTINGS, null, null, null, undefined, START);
  assert.deepEqual(parsePresetExport(JSON.stringify(current))[0].start, START);

  const users = createUserPresetExport([{ name: 'A', start: START, settings }, null, { name: 'B', settings }]);
  const read = parsePresetExport(JSON.stringify(users));
  assert.deepEqual(read[0].start, START);
  assert.equal('start' in read[1], false);

  const autosave = createAutosaveExport([], settings, null, null, START);
  assert.deepEqual(parsePresetExport(JSON.stringify(autosave))[0].start, START);

  const schema12 = { kind: users.kind, schemaVersion: 12, presets: [{ name: 'Old', settings }] };
  assert.equal('start' in parsePresetExport(JSON.stringify(schema12))[0], false);
});

test('the work in progress keeps the shown start, and an old one reads as the default', () => {
  const settings = FACTORY_PRESETS[0].settings;
  const base = { settings, presetValue: 'custom', snapshot: null, lastAppliedValue: null };
  assert.deepEqual(parseWorkingState(JSON.stringify({ ...base, start: START })).start, START);
  assert.deepEqual(parseWorkingState(JSON.stringify(base)).start, DEFAULT_PRESET_START);
});

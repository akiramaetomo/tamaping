import test from 'node:test';
import assert from 'node:assert/strict';

import RAPIER from '@dimforge/rapier2d-compat';

import { BENCH_PRESETS } from '../.test-build/sim/benchPresets.js';
import {
  FreeSpotFinder,
  OverlapSeparator,
  PHYSICAL_ENTRY_MAX_FRAMES,
  findCoveredDots,
  needsPhysicalSpread,
  overlapEstimate,
  physicalEntryBudget,
  physicalTimeLimitMs,
} from '../.test-build/sim/physicalEntry.js';
import { DEFAULT_SETTINGS } from '../.test-build/sim/settings.js';
import { DotpingPhysicsWorld } from '../.test-build/sim/physicsWorld.js';

await RAPIER.init();

const DT = 1 / 60;
const benchB = BENCH_PRESETS.find((preset) => preset.id === 'B').settings;

function stacked(count, x = 100, y = 100) {
  return { xs: new Float64Array(count).fill(x), ys: new Float64Array(count).fill(y) };
}

test('the grid estimate counts pairs that share a cell', () => {
  const { xs, ys } = stacked(10);
  assert.equal(overlapEstimate(xs, ys, 10, 4), 45);
  // One dot per cell of one diameter: no pairs.
  const spread = Float64Array.from({ length: 10 }, (_, index) => 4 + index * 8);
  assert.equal(overlapEstimate(spread, new Float64Array(10).fill(4), 10, 4), 0);
});

test('the physics time limit is a share of the target frame', () => {
  assert.equal(DEFAULT_SETTINGS.physicalTargetFps, 60);
  assert.equal(physicalTimeLimitMs(30), 25);
  assert.equal(physicalTimeLimitMs(60), 12.5);
  assert.equal(physicalTimeLimitMs(0), 12.5);
  assert.equal(physicalTimeLimitMs(Number.NaN), 12.5);
});

test('the spread budget has a floor and grows with the dot count', () => {
  assert.equal(physicalEntryBudget(10), 3000);
  assert.equal(physicalEntryBudget(10000), 25000);
  const { xs, ys } = stacked(200);
  // 200 dots at one point: 19900 pairs, far above 3000.
  assert.equal(needsPhysicalSpread(xs, ys, 200, 4), true);
  assert.equal(needsPhysicalSpread(xs, ys, 70, 4), false);
});

test('covered dots are found from the top of the drawing order down', () => {
  // Five dots on one point: the top one (highest ID) stays, the rest rest under it.
  const { xs, ys } = stacked(5);
  const ids = [0, 1, 2, 3, 4];
  assert.deepEqual([...findCoveredDots(xs, ys, ids, 5, 4)], [4, 4, 4, 4, -1]);
  // Centres 1.7 radii apart are not covered (cover 0.8 of a diameter = 1.6 radii).
  const apart = Float64Array.from([100, 106.8]);
  const level = new Float64Array(2).fill(100);
  assert.deepEqual([...findCoveredDots(apart, level, [0, 1], 2, 4)], [-1, -1]);
  // With cover 1, any overlap counts.
  assert.deepEqual([...findCoveredDots(apart, level, [0, 1], 2, 4, 1)], [1, -1]);
  // The drawing order is the rank, not the index; and the limit holds.
  assert.deepEqual([...findCoveredDots(xs, ys, [4, 3, 2, 1, 0], 5, 4)], [-1, 0, 0, 0, 0]);
  assert.equal([...findCoveredDots(xs, ys, ids, 5, 4, 0.8, 2)].filter((host) => host >= 0).length, 2);
});

test('a free spot is the nearest one with no dot within a diameter', () => {
  // Empty field: the cell centre at the point (cells of one diameter, 8).
  const empty = new FreeSpotFinder([], [], 0, 4, 200, 200);
  assert.deepEqual(empty.find(21, 21), { x: 20, y: 20 });
  // The spot handed out is taken; the next is at least a diameter away.
  const next = empty.find(21, 21);
  assert.ok(Math.hypot(next.x - 20, next.y - 20) >= 8);

  // A heap at (100, 100) pushes the spot just out of it, never into the Ball.
  const { xs, ys } = stacked(20);
  const finder = new FreeSpotFinder(xs, ys, 20, 4, 200, 200, { x: 60, y: 100, radius: 20 });
  const spot = finder.find(100, 100);
  assert.ok(Math.hypot(spot.x - 100, spot.y - 100) >= 8);
  assert.ok(Math.hypot(spot.x - 100, spot.y - 100) < 16);
  assert.ok(Math.hypot(spot.x - 60, spot.y - 100) >= 24);

  // A full field has no spot.
  const full = new FreeSpotFinder([], [], 0, 4, 8, 8);
  assert.ok(full.find(4, 4));
  assert.equal(full.find(4, 4), null);
});

test('a separation pass pushes dots apart and never speeds a pair up', () => {
  const separator = new OverlapSeparator();
  const x = Float64Array.from([100, 100.5]);
  const y = Float64Array.from([100, 100]);
  const vx = Float64Array.from([50, -50]);
  const vy = Float64Array.from([0, 0]);
  const before = Math.abs(x[1] - x[0]);
  separator.pass(x, y, 2, 4, 400, 400, vx, vy);
  assert.ok(Math.abs(x[1] - x[0]) > before + 4);
  // The closing speed along the push is gone; no bounce is added.
  assert.ok(Math.abs(vx[0]) < 1e-9 && Math.abs(vx[1]) < 1e-9);

  // Dots at the very same point still get a direction.
  const sx = new Float64Array(3).fill(200);
  const sy = new Float64Array(3).fill(200);
  separator.pass(sx, sy, 3, 4, 400, 400);
  assert.ok(new Set([...sx].map((value) => value.toFixed(3))).size > 1);
});

function gatheredWorld(count, width = 360, height = 800) {
  const settings = { ...DEFAULT_SETTINGS, ...benchB, particleCount: count };
  const world = new DotpingPhysicsWorld(RAPIER, width, height, settings);
  world.setPointer(true, width / 2, height / 2);
  for (let step = 0; step < 600; step += 1) {
    world.step(DT);
  }
  return { world, settings };
}

function stepUntilRapier(world) {
  let frames = 0;
  while (world.physicalEntry === 'spreading' && frames < PHYSICAL_ENTRY_MAX_FRAMES + 2) {
    world.step(DT);
    frames += 1;
  }
  return frames;
}

function stepUntilSettled(world, limit = 600) {
  let frames = 0;
  while (world.physicalEntry !== null && frames < limit) {
    world.step(DT);
    frames += 1;
  }
  return frames;
}

function hiddenDots(world) {
  return world.snapshot().particles.filter((particle) => !particle.visible).length;
}

test('a gathered overlap crowd is spread, rests and flows out into Rapier', () => {
  const { world, settings } = gatheredWorld(1000);
  world.updateSettings({ ...settings, collisionMode: 'collision-physical' });
  assert.equal(world.physicalEntry, 'spreading');
  assert.equal(world.overlapEngine, 'js');
  assert.equal(world.snapshot().particles.length, 1000);
  assert.ok(world.restingParticleCount > 0);
  assert.equal(hiddenDots(world), world.restingParticleCount);

  const frames = stepUntilRapier(world);
  assert.ok(frames <= PHYSICAL_ENTRY_MAX_FRAMES, `spread took ${frames} frames`);
  assert.equal(world.overlapEngine, 'rapier');
  assert.equal(world.particleCount + world.restingParticleCount, 1000);

  stepUntilSettled(world);
  assert.equal(world.physicalEntry, null);
  assert.equal(world.restingParticleCount, 0);
  assert.equal(world.particleCount, 1000);
  assert.equal(hiddenDots(world), 0);
  const metrics = world.step(DT).metrics;
  assert.equal(metrics.physicalEntry, undefined);
  assert.equal(metrics.restingDots, undefined);
});

test('resting dots keep their IDs and come back in place in Independent overlap', () => {
  const { world, settings } = gatheredWorld(5000);
  world.updateSettings({ ...settings, collisionMode: 'collision-physical' });
  stepUntilRapier(world);
  assert.equal(world.overlapEngine, 'rapier');
  assert.ok(world.restingParticleCount > 0);
  assert.equal(world.particleCount + world.restingParticleCount, 5000);
  const metrics = world.step(DT).metrics;
  assert.ok(['flow-out', 'at-limit', 'field-full'].includes(metrics.physicalEntry));
  assert.equal(metrics.restingDots, world.restingParticleCount);

  // Every dot is in the snapshot at its ID; resting ones are hidden.
  const snapshot = world.snapshot().particles;
  assert.equal(snapshot.length, 5000);
  assert.ok(snapshot.every((particle) => particle !== undefined && Number.isFinite(particle.x)));
  assert.equal(hiddenDots(world), world.restingParticleCount);

  world.updateSettings({ ...settings, collisionMode: 'independence-overlapping' });
  assert.equal(world.restingParticleCount, 0);
  assert.equal(world.particleCount, 5000);
  assert.equal(world.physicalEntry, null);
  // Resting dots return where they rested.
  const back = world.snapshot().particles;
  for (let id = 0; id < 5000; id += 1) {
    if (!snapshot[id].visible) {
      assert.ok(Math.abs(back[id].x - snapshot[id].x) < 1e-6, `dot ${id} x`);
      assert.ok(Math.abs(back[id].y - snapshot[id].y) < 1e-6, `dot ${id} y`);
    }
  }
});

test('dots keep their spin angle through rest, flow-out and a rebuild', () => {
  // Friction 0 on dots and the Ball: no contact turns a dot, so each angle
  // stays as set, up to Rapier's solver noise (well under 0.01 rad).
  const { world, settings } = gatheredWorld(1000);
  const plain = { ...settings, particleFriction: 0, controlBallFriction: 0 };
  world.updateSettings(plain);
  world.readParticleAngles = true;
  const store = world.overlap;
  const original = Array.from({ length: 1000 }, (_, id) => 0.5 + id * 0.001);
  // Overlap slots are in ID order before any rest. The gathering left some
  // spin; stop it so the angles stay put.
  world.ids.forEach((id, slot) => {
    store.angle[slot] = original[id];
    store.angvel[slot] = 0;
  });
  world.controlBall.setAngvel(0, true);

  world.updateSettings({ ...plain, collisionMode: 'collision-physical' });
  assert.ok(world.restingParticleCount > 0);
  stepUntilRapier(world);
  stepUntilSettled(world);
  assert.equal(world.restingParticleCount, 0);
  const kept = (particles) =>
    particles.filter((particle, id) => Math.abs(particle.angle - original[id]) < 0.01).length;
  // Before the fix, every dot that rested came back at angle 0.
  assert.ok(kept(world.snapshot().particles) >= 990, `${kept(world.snapshot().particles)} of 1000 kept`);

  // A rebuild (resize) keeps particle and Ball angles.
  world.controlBall.setRotation(1.25, true);
  const before = world.snapshot();
  world.resize(380, 780);
  const after = world.snapshot();
  assert.ok(Math.abs(after.controlBall.angle - before.controlBall.angle) < 1e-6);
  assert.ok(after.particles.every((particle, id) => Math.abs(particle.angle - before.particles[id].angle) < 1e-6));
});

test('a scattered Physical collision start goes straight to Rapier', () => {
  const benchE = BENCH_PRESETS.find((preset) => preset.id === 'E').settings;
  const world = new DotpingPhysicsWorld(RAPIER, 360, 800, { ...DEFAULT_SETTINGS, ...benchE });
  assert.equal(world.physicalEntry, null);
  assert.equal(world.overlapEngine, 'rapier');

  // Overfilled by design (fill 1.75, like 35 Momiji Star on a phone): every
  // dot stays, because a scattered start needs no spread.
  const full = new DotpingPhysicsWorld(RAPIER, 360, 640, {
    ...DEFAULT_SETTINGS,
    collisionMode: 'collision-physical',
    particleCount: 500,
    particleRadius: 16,
  });
  assert.equal(full.physicalEntry, null);
  assert.equal(full.restingParticleCount, 0);
  assert.equal(full.particleCount, 500);
});

test('arranging Physical collision dots onto one point rests the heap, which flows out', () => {
  const world = new DotpingPhysicsWorld(RAPIER, 360, 800, {
    ...DEFAULT_SETTINGS,
    collisionMode: 'collision-physical',
    particleCount: 500,
  });
  assert.equal(world.physicalEntry, null);
  world.arrangeParticlesToTargets([{ x: 180, y: 400, vx: 0, vy: 0 }]);
  assert.equal(world.physicalEntry, 'spreading');
  // One point: only the top dot stays.
  assert.equal(world.restingParticleCount, 499);
  stepUntilRapier(world);
  assert.equal(world.overlapEngine, 'rapier');
  stepUntilSettled(world);
  assert.equal(world.restingParticleCount, 0);
  assert.equal(world.particleCount, 500);
});

test('a start brings resting dots back so every dot is placed', () => {
  const world = new DotpingPhysicsWorld(RAPIER, 360, 800, {
    ...DEFAULT_SETTINGS,
    collisionMode: 'collision-physical',
    particleCount: 500,
  });
  world.arrangeParticlesToTargets([{ x: 180, y: 400, vx: 0, vy: 0 }]);
  assert.equal(world.restingParticleCount, 499);
  world.arrangeRandomParticles();
  assert.equal(world.physicalEntry, null);
  assert.equal(world.restingParticleCount, 0);
  assert.equal(world.particleCount, 500);

  // A resize while dots rest keeps the count.
  world.arrangeParticlesToTargets([{ x: 180, y: 400, vx: 0, vy: 0 }]);
  world.resize(400, 700);
  assert.equal(world.particleCount + world.restingParticleCount, 500);
  assert.equal(world.snapshot().particles.length, 500);
});

test('?entry=held brings back the first entry: tail dots held, handover after the frame cap', () => {
  const { world, settings } = gatheredWorld(5000);
  const legacy = { ...settings, physicalEntryMode: 'held' };
  world.updateSettings({ ...legacy, collisionMode: 'collision-physical' });
  assert.equal(world.physicalEntry, 'spreading');
  // Held by ID: the simulated dots are the lowest IDs, the hidden ones the tail.
  const snapshot = world.snapshot().particles;
  const firstHidden = snapshot.findIndex((particle) => !particle.visible);
  assert.ok(firstHidden > 0);
  assert.ok(snapshot.slice(firstHidden).every((particle) => !particle.visible));
  assert.equal(world.particleCount + world.restingParticleCount, 5000);
  stepUntilRapier(world);
  assert.equal(world.overlapEngine, 'rapier');
  const metrics = world.step(DT).metrics;
  assert.equal(metrics.physicalEntryMode, 'held');
  // No flow-out: the held dots stay held.
  for (let step = 0; step < 60; step += 1) {
    world.step(DT);
  }
  assert.equal(world.restingParticleCount, 5000 - firstHidden);
  world.updateSettings({ ...legacy, collisionMode: 'independence-overlapping' });
  assert.equal(world.particleCount, 5000);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import RAPIER from '@dimforge/rapier2d-compat';

import { DEFAULT_SETTINGS } from '../.test-build/sim/settings.js';
import { DotpingPhysicsWorld } from '../.test-build/sim/physicsWorld.js';

await RAPIER.init();

const WIDTH = 360;
const HEIGHT = 800;
const SPEED = 300;

function oneParticleWorld(colliderLayout, contactRestitution, wallRestitution) {
  return new DotpingPhysicsWorld(RAPIER, WIDTH, HEIGHT, {
    ...DEFAULT_SETTINGS,
    colliderLayout,
    contactRestitution,
    wallRestitution,
    particleCount: 1,
    particleLinearDamping: 0,
    controlBallMode: 'touch',
    gravityMode: 'none',
  });
}

// Fires one particle at the left wall and returns outgoing / incoming speed.
function wallReboundRatio(colliderLayout, contactRestitution, wallRestitution) {
  const world = oneParticleWorld(colliderLayout, contactRestitution, wallRestitution);
  world.arrangeParticlesToTargets([{ x: 100, y: HEIGHT / 2, vx: -SPEED, vy: 0 }]);
  for (let index = 0; index < 90; index += 1) {
    world.step(1 / 60);
  }
  return world.snapshot().particles[0].speed / SPEED;
}

test('single layout bounces off walls with Wall Bounce, like split', () => {
  for (const [contact, wall] of [[0.3, 0.3], [0.3, 1], [1, 0.3], [0, 0.8], [0.9, 0]]) {
    const split = wallReboundRatio('split', contact, wall);
    const single = wallReboundRatio('single', contact, wall);
    assert.ok(Math.abs(split - wall) < 0.02, `split ${contact}/${wall}: ${split}`);
    assert.ok(Math.abs(single - split) < 0.005, `single ${contact}/${wall}: ${single} vs ${split}`);
  }
});

test('single layout keeps Wall Bounce after a runtime bounce change', () => {
  const world = oneParticleWorld('single', 0.3, 0.3);
  world.updateSettings({
    ...DEFAULT_SETTINGS,
    colliderLayout: 'single',
    contactRestitution: 0.6,
    wallRestitution: 0.9,
    particleCount: 1,
    particleLinearDamping: 0,
    controlBallMode: 'touch',
    gravityMode: 'none',
  });
  world.arrangeParticlesToTargets([{ x: 100, y: HEIGHT / 2, vx: -SPEED, vy: 0 }]);
  for (let index = 0; index < 90; index += 1) {
    world.step(1 / 60);
  }
  assert.ok(Math.abs(world.snapshot().particles[0].speed / SPEED - 0.9) < 0.02);
});

test('single layout uses one collider per body', () => {
  // 4 walls + control ball + particles.
  assert.equal(oneParticleWorld('single', 0.3, 0.3).colliderCount, 6);
  assert.equal(oneParticleWorld('split', 0.3, 0.3).colliderCount, 8);
});

// A crowd pulled onto the Ball, laid out without randomness.
function crowdWorld(overrides = {}) {
  const world = new DotpingPhysicsWorld(RAPIER, WIDTH, HEIGHT, {
    ...DEFAULT_SETTINGS,
    particleCount: 200,
    particleRadius: 4,
    collisionMode: 'collision-physical',
    gravityMode: 'gravity',
    gravityStrength: 3,
    ...overrides,
  });
  world.arrangeParticlesToTargets(Array.from({ length: 200 }, (_, index) => ({
    x: 40 + (index % 20) * 14,
    y: 120 + Math.floor(index / 20) * 14,
    vx: ((index * 37) % 11) - 5,
    vy: ((index * 53) % 13) - 6,
  })));
  return world;
}

function fingerprint(world, steps) {
  for (let index = 0; index < steps; index += 1) {
    world.step(1 / 60);
  }
  return world.snapshot().particles.map((dot) => `${dot.x.toFixed(6)},${dot.y.toFixed(6)}`).join(';');
}

test('the same start gives the same crowd, step for step', () => {
  assert.equal(fingerprint(crowdWorld(), 120), fingerprint(crowdWorld(), 120));
  const linked = { collisionMode: 'independence-overlapping', dotCombiMode: 'velocity' };
  assert.equal(fingerprint(crowdWorld(linked), 120), fingerprint(crowdWorld(linked), 120));
  const linkedRapier = { ...linked, overlapEngine: 'rapier' };
  assert.equal(fingerprint(crowdWorld(linkedRapier), 120), fingerprint(crowdWorld(linkedRapier), 120));
});

test('the Ball keeps up with a fast drag (no Rapier speed cap)', () => {
  const world = new DotpingPhysicsWorld(RAPIER, 702, 410, { ...DEFAULT_SETTINGS, particleCount: 1 });
  let worst = 0;
  for (let index = 0; index < 240; index += 1) {
    const t = index / 60;
    // About 1300 px/s along an ellipse, far above the 400 px/s cap of Rapier 0.21.
    const x = 351 + 300 * Math.cos(t * 4);
    const y = 205 + 150 * Math.sin(t * 4);
    world.setPointer(true, x, y);
    world.step(1 / 60);
    const ball = world.snapshot().controlBall;
    if (index > 30) {
      worst = Math.max(worst, Math.hypot(ball.x - x, ball.y - y));
    }
  }
  assert.ok(worst < 1, `Ball trails the pointer by ${worst.toFixed(2)} px`);
});

test('a fast particle keeps its speed in open space', () => {
  const world = oneParticleWorld('single', 0.5, 0.5);
  world.arrangeParticlesToTargets([{ x: 360, y: HEIGHT / 2, vx: 0, vy: 3000 }]);
  world.step(1 / 60);
  assert.ok(Math.abs(world.snapshot().particles[0].speed - 3000) < 1);
});

test('rebuilding frees the old world and the new one keeps working', () => {
  const world = crowdWorld();
  for (let index = 0; index < 30; index += 1) {
    world.resize(WIDTH + (index % 3), HEIGHT);
    world.reset();
  }
  world.step(1 / 60);
  const snapshot = world.snapshot();
  assert.equal(snapshot.particles.length, 200);
  assert.ok(snapshot.particles.every((dot) => Number.isFinite(dot.x) && Number.isFinite(dot.y)));
  assert.equal(world.colliderCount, 205);
});

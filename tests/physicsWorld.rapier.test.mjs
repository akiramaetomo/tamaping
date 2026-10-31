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

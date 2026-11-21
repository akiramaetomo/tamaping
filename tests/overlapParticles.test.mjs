import test from 'node:test';
import assert from 'node:assert/strict';

import RAPIER from '@dimforge/rapier2d-compat';

import { OverlapParticles } from '../.test-build/sim/overlapParticles.js';
import { DEFAULT_SETTINGS } from '../.test-build/sim/settings.js';
import { DotpingPhysicsWorld } from '../.test-build/sim/physicsWorld.js';

await RAPIER.init();

const DT = 1 / 60;

function params(overrides = {}) {
  return {
    width: 2000,
    height: 2000,
    radius: 4,
    mass: 1,
    friction: 0,
    restitution: 0.5,
    wallRestitution: 0.5,
    linearDamping: 0,
    ...overrides,
  };
}

function ball(overrides = {}) {
  return { x: 1000, y: 1000, vx: 0, vy: 0, radius: 50, mass: 1, friction: 0, angvel: 0, ...overrides };
}

test('friction turns both bodies and conserves linear and angular momentum', () => {
  const store = new OverlapParticles(1);
  // Off center, the particle moving down past the Ball's side, overlapping by
  // a hair so the lever arms equal the radii (a deeper overlap shortens them).
  const d = 54 - 1e-7;
  const px0 = 1000 + d * 0.75;
  const py0 = 1000 - d * Math.sqrt(1 - 0.75 * 0.75);
  store.set(0, px0, py0, 0, 400);
  const b = ball({ mass: 3, friction: 0.5 });
  const p = params({ mass: 1, radius: 4, friction: 0.5, restitution: 0.3 });
  const angular = (px, py, vx, vy, m, w, radius) => m * (px * vy - py * vx) + 0.5 * m * radius * radius * w;
  const before = angular(px0, py0, 0, 400, 1, 0, 4) + angular(1000, 1000, 0, 0, 3, 0, 50);
  const beforePy = 400;
  const result = store.solveBall(DT, b, p);
  // Linear momentum, measured before the position push-out moved anything.
  assert.ok(Math.abs(store.vy[0] + 3 * result.vy - beforePy) < 1e-9);
  assert.ok(Math.abs(store.vx[0] + 3 * result.vx) < 1e-9);
  assert.notEqual(store.angvel[0], 0);
  assert.notEqual(result.angvel, 0);
  // Angular momentum about the origin, at the contact positions (the push-out
  // changes positions, so use the positions from before it).
  const after = angular(px0, py0, store.vx[0], store.vy[0], 1, store.angvel[0], 4)
    + angular(1000, 1000, result.vx, result.vy, 3, result.angvel, 50);
  assert.ok(Math.abs(after - before) / Math.abs(before) < 1e-6, `${before} -> ${after}`);
  // With enough friction the contact ends up rolling: its surfaces no longer
  // slide against each other.
  const nx = (px0 - 1000) / d;
  const ny = (py0 - 1000) / d;
  const sliding = -(store.vx[0] - result.vx) * ny + (store.vy[0] - result.vy) * nx
    - 4 * store.angvel[0] - 50 * result.angvel;
  assert.ok(Math.abs(sliding) < 1e-6, `sliding ${sliding}`);
});

test('without friction nothing turns', () => {
  const store = new OverlapParticles(1);
  store.set(0, 1040, 1000 - 35, 0, 400);
  const result = store.solveBall(DT, ball(), params({ friction: 0 }));
  assert.equal(store.angvel[0], 0);
  assert.equal(result.angvel, 0);
});

test('a head-on contact conserves momentum and bounces with Contact Bounce', () => {
  const store = new OverlapParticles(1);
  // Just overlapping on the right of the Ball, moving towards it.
  store.set(0, 1053.9, 1000, -300, 0);
  const result = store.solveBall(DT, ball({ mass: 3 }), params({ mass: 1, restitution: 0.5 }));
  const before = -300 * 1;
  const after = store.vx[0] * 1 + result.vx * 3;
  assert.ok(Math.abs(after - before) < 1e-9, `momentum ${before} -> ${after}`);
  // Relative normal speed out = e x relative speed in.
  assert.ok(Math.abs((store.vx[0] - result.vx) - 150) < 1e-6);
});

test('a separating pair gets no impulse', () => {
  const store = new OverlapParticles(1);
  store.set(0, 1053, 1000, 200, 0);
  const result = store.solveBall(DT, ball(), params());
  assert.equal(store.vx[0], 200);
  assert.equal(result.vx, 0);
});

test('a fast Ball cannot pass through a small particle', () => {
  const store = new OverlapParticles(1);
  // 6000 px/s is 100 px per step, more than the whole contact diameter.
  store.set(0, 1080, 1000, 0, 0);
  const heavy = ball({ vx: 6000, mass: 1000 });
  const result = store.solveBall(DT, heavy, params({ radius: 2 }));
  assert.ok(store.vx[0] > 6000, `particle vx ${store.vx[0]}`);
  assert.ok(result.vx < 6000);
});

test('a particle skimming past the Ball is not hit', () => {
  const store = new OverlapParticles(1);
  store.set(0, 1000 - 200, 1000 - 60, 6000, 0);
  store.solveBall(DT, ball(), params({ radius: 4 }));
  assert.equal(store.vx[0], 6000);
  assert.equal(store.vy[0], 0);
});

test('a particle pressed onto a heavy Ball comes to rest without jitter', () => {
  const store = new OverlapParticles(1);
  store.set(0, 1080, 1000, -100, 0);
  const p = params({ restitution: 0.3 });
  const heavy = ball({ mass: 1e9 });
  const impacts = [];
  let maxLateSpeed = 0;
  for (let step = 0; step < 240; step += 1) {
    // A steady pull onto the Ball, as Gravity gives far from it.
    store.vx[0] -= 600 * DT;
    store.solveBall(DT, heavy, p);
    store.integrate(DT, heavy, p, impacts);
    if (step > 120) {
      maxLateSpeed = Math.max(maxLateSpeed, Math.abs(store.vx[0]));
    }
  }
  // A steady pull holds a small overlap, as Rapier's late contacts do.
  const gap = store.x[0] - 1000 - 54;
  assert.ok(Math.abs(gap) < 1, `gap ${gap}`);
  assert.ok(maxLateSpeed < 15, `speed while resting ${maxLateSpeed}`);
  assert.ok(impacts.filter((impact) => impact.kind === 'ball-particle').length <= 3);
});

test('walls reflect with Wall Bounce and report one impact per hit', () => {
  const store = new OverlapParticles(1);
  store.set(0, 100, 500, -300, 0);
  const p = params({ wallRestitution: 0.8 });
  const impacts = [];
  for (let step = 0; step < 90; step += 1) {
    store.solveBall(DT, null, p);
    store.integrate(DT, null, p, impacts);
  }
  assert.ok(Math.abs(store.vx[0] - 240) < 1e-9);
  assert.ok(store.x[0] >= 4);
  assert.equal(impacts.length, 1);
  assert.equal(impacts[0].kind, 'particle-wall');
});

function world(overlapEngine, overrides = {}) {
  return new DotpingPhysicsWorld(RAPIER, 360, 800, {
    ...DEFAULT_SETTINGS,
    collisionMode: 'independence-overlapping',
    overlapEngine,
    ...overrides,
  });
}

test('Independent overlap uses the TS engine by default', () => {
  const w = new DotpingPhysicsWorld(RAPIER, 360, 800, {
    ...DEFAULT_SETTINGS,
    collisionMode: 'independence-overlapping',
  });
  assert.equal(w.overlapEngine, 'js');
  assert.equal(new DotpingPhysicsWorld(RAPIER, 360, 800, DEFAULT_SETTINGS).overlapEngine, 'rapier');
});

test('the switch applies to Independent overlap only', () => {
  assert.equal(world('js').overlapEngine, 'js');
  assert.equal(world('rapier').overlapEngine, 'rapier');
  assert.equal(world('js', { collisionMode: 'collision-physical' }).overlapEngine, 'rapier');
  // 4 walls + the Ball; the trial particles have no colliders.
  assert.equal(world('js').colliderCount, 5);
});

test('the trial engine matches Rapier for a wall rebound', () => {
  for (const wall of [0.3, 0.8, 1]) {
    const ratios = ['rapier', 'js'].map((engine) => {
      const w = world(engine, {
        particleCount: 1,
        particleLinearDamping: 0.01,
        wallRestitution: wall,
        controlBallMode: 'touch',
      });
      w.arrangeParticlesToTargets([{ x: 100, y: 400, vx: -300, vy: 0 }]);
      for (let step = 0; step < 90; step += 1) {
        w.step(DT);
      }
      return w.snapshot().particles[0].speed / 300;
    });
    assert.ok(Math.abs(ratios[0] - ratios[1]) < 0.01, `wall ${wall}: ${ratios}`);
  }
});

test('an off-center hit with friction matches Rapier in speed and spin', () => {
  const results = ['rapier', 'js'].map((engine) => {
    const w = new DotpingPhysicsWorld(RAPIER, 4000, 4000, {
      ...DEFAULT_SETTINGS,
      collisionMode: 'independence-overlapping',
      overlapEngine: engine,
      particleCount: 1,
      contactRestitution: 0.3,
      particleFriction: 0.5,
      controlBallFriction: 0.5,
      particleLinearDamping: 0,
      controlBallLinearDamping: 0,
    });
    w.arrangeParticlesToTargets([{ x: 2040, y: 1000, vx: 0, vy: 0 }]);
    // Released Ball moving up at 450 px/s.
    w.setPointer(true, 2000, 2000);
    w.step(DT);
    w.setPointer(true, 2000, 2000 - 450 * DT);
    w.step(DT);
    w.setPointer(false, 0, 0);
    for (let step = 0; step < 200; step += 1) {
      w.step(DT);
    }
    const dot = w.snapshot().particles[0];
    return { vx: dot.vx, vy: dot.vy, spin: w.particles[0].angvel(), ballSpin: w.controlBall.angvel() };
  });
  // Rapier's soft solver overshoots rolling a little; the trial engine stops
  // at it exactly. Measured 2026-11-19: speed within 26 px/s of 430, spin
  // within 5%, Ball spin within 25%.
  const [rapier, js] = results;
  const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;
  assert.ok(near(rapier.vx, js.vx, 40) && near(rapier.vy, js.vy, 40), JSON.stringify(results));
  assert.ok(near(rapier.spin, js.spin, Math.abs(rapier.spin) * 0.1), JSON.stringify(results));
  assert.ok(Math.sign(rapier.ballSpin) === Math.sign(js.ballSpin), JSON.stringify(results));
  assert.ok(near(rapier.ballSpin, js.ballSpin, Math.abs(rapier.ballSpin) * 0.35), JSON.stringify(results));
});

test('the dragged Ball pushes trial particles out of its way', () => {
  const w = world('js', { particleCount: 1, particleRadius: 4 });
  w.arrangeParticlesToTargets([{ x: 180, y: 400, vx: 0, vy: 0 }]);
  w.setPointer(true, 60, 400);
  w.step(DT);
  for (let step = 0; step < 60; step += 1) {
    w.setPointer(true, 60 + step * 4, 400);
    w.step(DT);
  }
  const { particles, controlBall } = w.snapshot();
  const distance = Math.hypot(particles[0].x - controlBall.x, particles[0].y - controlBall.y);
  assert.ok(distance >= controlBall.radius + 4 - 0.5, `distance ${distance}`);
  assert.ok(particles[0].x > controlBall.x);
});

test('the trial engine gives the same crowd for the same start, and survives rebuilds', () => {
  const run = () => {
    const w = world('js', { particleCount: 200, particleRadius: 4, gravityMode: 'gravity', gravityStrength: 3 });
    w.arrangeParticlesToTargets(Array.from({ length: 200 }, (_, index) => ({
      x: 40 + (index % 20) * 14,
      y: 120 + Math.floor(index / 20) * 14,
      vx: ((index * 37) % 11) - 5,
      vy: ((index * 53) % 13) - 6,
    })));
    for (let step = 0; step < 120; step += 1) {
      w.step(DT);
    }
    return w;
  };
  const a = run();
  const b = run();
  const print = (w) => w.snapshot().particles.map((dot) => `${dot.x.toFixed(6)},${dot.y.toFixed(6)}`).join(';');
  assert.equal(print(a), print(b));

  for (let index = 0; index < 5; index += 1) {
    a.resize(360 + index, 800);
  }
  a.step(DT);
  const dots = a.snapshot().particles;
  assert.equal(dots.length, 200);
  assert.ok(dots.every((dot) => Number.isFinite(dot.x) && Number.isFinite(dot.y)));
  assert.equal(a.overlapEngine, 'js');
});

test('the snapshot carries the spin angle, for particles only on request', () => {
  for (const engine of ['rapier', 'js']) {
    const w = new DotpingPhysicsWorld(RAPIER, 4000, 4000, {
      ...DEFAULT_SETTINGS,
      collisionMode: 'independence-overlapping',
      overlapEngine: engine,
      particleCount: 1,
      contactRestitution: 0.3,
      particleFriction: 0.5,
      controlBallFriction: 0.5,
      particleLinearDamping: 0,
      controlBallLinearDamping: 0,
    });
    w.arrangeParticlesToTargets([{ x: 2040, y: 1000, vx: 0, vy: 0 }]);
    w.setPointer(true, 2000, 2000);
    w.step(DT);
    w.setPointer(true, 2000, 2000 - 450 * DT);
    w.step(DT);
    w.setPointer(false, 0, 0);
    for (let step = 0; step < 200; step += 1) {
      w.step(DT);
    }
    assert.equal(w.snapshot().particles[0].angle, 0, engine);
    w.readParticleAngles = true;
    const snapshot = w.snapshot();
    assert.notEqual(snapshot.particles[0].angle, 0, engine);
    assert.equal(snapshot.particles[0].angle, w.particles[0].rotation(), engine);
    assert.equal(snapshot.controlBall.angle, w.controlBall.rotation(), engine);
    assert.notEqual(snapshot.controlBall.angle, 0, engine);
  }
});

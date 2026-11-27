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

test('a fast light Ball does not pull a heavy particle towards itself', () => {
  // U43 `Spiral metalphone`: particle mass 100, Ball mass 0.1. A heavy
  // particle hit part way through the step barely moves; its position
  // correction must follow its own velocity change, not the Ball's rebound.
  for (const speed of [600, 2500, 4000]) {
    const store = new OverlapParticles(1);
    store.set(0, 1000, 1000, 0, 0);
    const start = 1000 - 42 - 5 - speed * DT * 0.5;
    const light = ball({ x: start, vx: speed, radius: 30, mass: 0.1 });
    const heavy = params({ radius: 12, mass: 100, restitution: 0.41 });
    const result = store.solveBall(DT, light, heavy);
    assert.ok(result.vx < 0, `${speed} px/s: the Ball rebounds`);
    // The Ball's own move belongs to Rapier; here it only has to be present.
    const after = { ...light, x: start + result.dx + result.vx * DT, vx: result.vx };
    store.integrate(DT, after, heavy, []);
    const moved = store.x[0] - 1000;
    assert.ok(moved >= 0, `${speed} px/s: particle moved ${moved} px towards the Ball`);
    assert.ok(moved < 0.1, `${speed} px/s: particle moved ${moved} px`);
  }
});

test('a fast Ball stops at a heavy particle instead of rebounding short of it', () => {
  // A dragged Ball pressed into a fixed dot used to rebound from where it
  // started the step and float away (U43, up to 117 px). Like Rapier's CCD,
  // it now ends the step at the impact and leaves on the next one.
  const store = new OverlapParticles(1);
  store.set(0, 1000, 1000, 0, 0);
  const radius = 20;
  const sumR = radius + 12;
  const start = 1000 - sumR - 5;
  const fast = ball({ x: start, vx: 3000, radius, mass: 0.1 });
  const result = store.solveBall(DT, fast, params({ radius: 12, mass: 100, restitution: 0.41 }));
  assert.ok(result.vx < 0, 'the Ball leaves the particle');
  const end = start + result.dx + result.vx * DT;
  const gap = 1000 - end - sumR;
  assert.ok(Math.abs(gap) < 0.5, `gap ${gap} px`);
});

test('a Ball reaching a fixed particle within the step stops at its surface', () => {
  // 900 px/s is 15 px per step, less than the Ball's radius: no CCD case.
  // `surface` meets the particle at the impact; `sink` (the old contact,
  // `?bc=sink`) lets the Ball move 10 px into it.
  const run = (ballContact) => {
    const store = new OverlapParticles(1);
    store.set(0, 1000, 1000, 0, 0);
    const radius = 20;
    const sumR = radius + 12;
    const start = 1000 - sumR - 5;
    const held = ball({ x: start, vx: 900, radius, mass: 0.1 });
    const result = store.solveBall(DT, held, params({ radius: 12, mass: 100, restitution: 0.41, ballContact }));
    const end = start + result.dx + result.vx * DT;
    return 1000 - end - sumR;
  };
  const surface = run('surface');
  assert.ok(Math.abs(surface) < 0.5, `surface gap ${surface} px`);
  assert.equal(run(undefined), surface);
  const sink = run('sink');
  assert.ok(Math.abs(sink + 10) < 0.5, `sink gap ${sink} px`);
});

test('a dragged Ball pressed into a fixed dot rests at its surface', () => {
  // U43 `Spiral metalphone` with Ball Size 20: the pointer held 20 px past a
  // dot that does not give way (mass 100, damping 83) against a Ball of mass
  // 0.1. The old contact sank in and floated off, 6 steps a cycle.
  const results = ['surface', 'sink'].map((overlapBallContact) => {
    const w = new DotpingPhysicsWorld(RAPIER, 400, 400, {
      ...DEFAULT_SETTINGS,
      collisionMode: 'independence-overlapping',
      overlapBallContact,
      particleCount: 1,
      particleRadius: 12,
      particleMass: 100,
      particleLinearDamping: 83,
      controlBallRadius: 20,
      controlBallMass: 0.1,
      controlBallLinearDamping: 0,
      contactRestitution: 0.41,
    });
    w.arrangeParticlesToTargets([{ x: 300, y: 200, vx: 0, vy: 0 }]);
    w.setPointer(true, 200, 200);
    for (let step = 0; step < 30; step += 1) w.step(DT);
    let maxGap = -Infinity;
    let minGap = Infinity;
    let sounds = 0;
    for (let step = 0; step < 120; step += 1) {
      w.setPointer(true, Math.min(200 + step * 5, 300 - 32 + 20), 200);
      const { impacts } = w.step(DT);
      sounds += impacts.filter((impact) => impact.kind === 'ball-particle').length;
      if (step >= 30) {
        const { particles, controlBall } = w.snapshot();
        const gap = Math.hypot(particles[0].x - controlBall.x, particles[0].y - controlBall.y) - 32;
        maxGap = Math.max(maxGap, gap);
        minGap = Math.min(minGap, gap);
      }
    }
    return { maxGap, minGap, sounds };
  });
  const [surface, sink] = results;
  assert.ok(surface.maxGap < 1 && surface.minGap > -1, JSON.stringify(results));
  assert.equal(surface.sounds, 1, JSON.stringify(results));
  // The comparison switch still shows the old behaviour.
  assert.ok(sink.maxGap - sink.minGap > 5, JSON.stringify(results));
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
  const configs = [['rapier', 'sink'], ['js', 'sink'], ['js', 'surface']];
  const results = configs.map(([engine, overlapBallContact]) => {
    const w = new DotpingPhysicsWorld(RAPIER, 4000, 4000, {
      ...DEFAULT_SETTINGS,
      collisionMode: 'independence-overlapping',
      overlapEngine: engine,
      overlapBallContact,
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
  // within 5%, Ball spin within 25%. That is the old contact (`sink`), which
  // lets the Ball move into the particle as Rapier does. `surface` meets the
  // particle at the impact, so the contact normal differs a little:
  // measured 2026-11-22, speed within 25 px/s, spin 10.6% lower.
  const [rapier, ...trials] = results;
  const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;
  trials.forEach((js, index) => {
    const spinTolerance = index === 0 ? 0.1 : 0.15;
    assert.ok(near(rapier.vx, js.vx, 40) && near(rapier.vy, js.vy, 40), JSON.stringify(results));
    assert.ok(near(rapier.spin, js.spin, Math.abs(rapier.spin) * spinTolerance), JSON.stringify(results));
    assert.ok(Math.sign(rapier.ballSpin) === Math.sign(js.ballSpin), JSON.stringify(results));
    assert.ok(near(rapier.ballSpin, js.ballSpin, Math.abs(rapier.ballSpin) * 0.35), JSON.stringify(results));
  });
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

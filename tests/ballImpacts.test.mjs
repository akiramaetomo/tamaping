import test from 'node:test';
import assert from 'node:assert/strict';

import RAPIER from '@dimforge/rapier2d-compat';

import { BallImpactWalk } from '../.test-build/sim/ballImpacts.js';
import { OverlapParticles } from '../.test-build/sim/overlapParticles.js';
import { DEFAULT_SETTINGS } from '../.test-build/sim/settings.js';
import { DotpingPhysicsWorld } from '../.test-build/sim/physicsWorld.js';

await RAPIER.init();

const DT = 1 / 60;

// The user's `Spiral metalphone` (2026-11-25): 30 dots that hardly give way,
// in a spiral, and a light Ball.
const METALPHONE = {
  ...DEFAULT_SETTINGS,
  collisionMode: 'independence-overlapping',
  gravityMode: 'none',
  particleCount: 30,
  particleRadius: 13,
  particleMass: 100,
  particleLinearDamping: 83,
  particleFriction: 1,
  contactRestitution: 0,
  controlBallRadius: 27,
  controlBallMass: 0.1,
  controlBallFriction: 1,
  controlBallLinearDamping: 0,
  wallRestitution: 0.9,
};
const SUM = METALPHONE.controlBallRadius + METALPHONE.particleRadius;
const CENTER = { x: 279, y: 166 };

function metalphone(overlapBallContact) {
  const w = new DotpingPhysicsWorld(RAPIER, 558, 415, { ...METALPHONE, overlapBallContact });
  w.applyStart({ formation: 'spiral', ballX: 50, ballY: 40, ballSpeed: 0, particleSpeed: 0 });
  return w;
}

function positions(w) {
  const { particles, controlBall } = w.snapshot();
  return { dots: particles, ball: controlBall };
}

// Steps once and returns the dots that began to sound, with their gap to the
// Ball at the end of the step.
function stepSounds(w) {
  const before = Uint8Array.from(w.overlap.ballTouch);
  const { impacts } = w.step(DT);
  const { dots, ball } = positions(w);
  const sounds = [];
  const energies = impacts.filter((impact) => impact.kind === 'ball-particle');
  dots.forEach((dot, index) => {
    if (w.overlap.ballTouch[index] && !before[index]) {
      sounds.push({ index, gap: Math.hypot(dot.x - ball.x, dot.y - ball.y) - SUM });
    }
  });
  return { sounds, energies, ball, dots };
}

// Slides the Ball along the inside of the spiral with the pointer `press` px
// past the place where the Ball touches the dots.
function slide(w, press, speed, onStep) {
  const start = positions(w).dots.map((dot) => ({
    angle: Math.atan2(dot.y - CENTER.y, dot.x - CENTER.x),
    radius: Math.hypot(dot.x - CENTER.x, dot.y - CENTER.y),
  }));
  const at = (turn) => {
    const index = Math.min(Math.floor(turn), start.length - 2);
    const part = turn - index;
    let next = start[index + 1].angle;
    if (next < start[index].angle - 1) next += Math.PI * 2;
    const angle = start[index].angle + (next - start[index].angle) * part;
    const radius = start[index].radius + (start[index + 1].radius - start[index].radius) * part - SUM;
    return { angle, radius };
  };
  const point = (turn, extra) => {
    const { angle, radius } = at(turn);
    return {
      x: CENTER.x + Math.cos(angle) * (radius + extra),
      y: CENTER.y + Math.sin(angle) * (radius + extra),
    };
  };
  const first = point(0, -1);
  w.controlBall.setTranslation(first, true);
  for (let step = 0; step < 20; step += 1) {
    w.setPointer(true, first.x, first.y);
    w.step(DT);
  }
  let turn = 0;
  let last = point(0, press);
  for (let step = 0; step < 600 && turn < 14; step += 1) {
    const p = point(turn, press * Math.min(1, step / 10));
    w.setPointer(true, p.x, p.y);
    onStep(stepSounds(w), p);
    // Along the line the pointer draws, about `speed` px/s.
    let moved = 0;
    while (moved < speed * DT && turn < 14) {
      turn += 0.01;
      const next = point(turn, press);
      moved += Math.hypot(next.x - last.x, next.y - last.y);
      last = next;
    }
  }
}

test('a dot sounds only when the Ball is there, however hard it is pressed', () => {
  for (const [press, speed] of [[5, 150], [10, 150], [20, 150], [20, 300], [10, 600]]) {
    const w = metalphone('impact');
    let sounds = 0;
    const heard = new Set();
    slide(w, press, speed, ({ sounds: now }) => {
      for (const { index, gap } of now) {
        sounds += 1;
        heard.add(index);
        assert.ok(gap < 2, `press ${press}, ${speed} px/s: dot ${index} sounded ${gap} px away`);
      }
    });
    assert.ok(heard.size >= 12, `press ${press}, ${speed} px/s: ${heard.size} dots heard`);
    assert.ok(sounds <= heard.size + 2, `press ${press}, ${speed} px/s: ${sounds} sounds for ${heard.size} dots`);
  }
});

test('the comparison switch still shows the early sounds of `surface`', () => {
  const w = metalphone('surface');
  let early = 0;
  slide(w, 10, 150, ({ sounds }) => {
    early += sounds.filter(({ gap }) => gap > 2).length;
  });
  assert.ok(early >= 5, `early sounds ${early}`);
});

test('the loudness of a hit follows the Ball, not how far the finger presses', () => {
  const median = (press) => {
    const w = metalphone('impact');
    const values = [];
    slide(w, press, 150, ({ energies }) => values.push(...energies.map((impact) => impact.energy)));
    values.sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)];
  };
  const light = median(2);
  const hard = median(10);
  assert.ok(hard / light < 1.6, `light press ${light}, hard press ${hard}`);
});

test('a held Ball pressed into a fixed dot stays at its surface and rings once', () => {
  for (const press of [5, 20, 40]) {
    const w = new DotpingPhysicsWorld(RAPIER, 400, 400, {
      ...METALPHONE,
      overlapBallContact: 'impact',
      particleCount: 1,
      contactRestitution: 0.41,
    });
    w.arrangeParticlesToTargets([{ x: 300, y: 200, vx: 0, vy: 0 }]);
    let sounds = 0;
    let maxGap = -Infinity;
    let minGap = Infinity;
    for (let step = 0; step < 150; step += 1) {
      w.setPointer(true, Math.min(150 + step * 3, 300 - SUM + press), 200);
      const { impacts } = w.step(DT);
      sounds += impacts.filter((impact) => impact.kind === 'ball-particle').length;
      if (step > 70) {
        const { dots, ball } = positions(w);
        const gap = Math.hypot(dots[0].x - ball.x, dots[0].y - ball.y) - SUM;
        maxGap = Math.max(maxGap, gap);
        minGap = Math.min(minGap, gap);
      }
    }
    assert.equal(sounds, 1, `press ${press}`);
    assert.ok(maxGap < 0.5 && minGap > -0.1, `press ${press}: gap ${minGap} to ${maxGap}`);
  }
});

// Presses the Ball against the inside of the spiral with the pointer `past` px
// beyond it, as a mouse does that runs on.
function pressFar(w, angle, past, steps) {
  const radius = 68.6 + 12.83 * (angle + 1.1) - SUM - 6;
  w.controlBall.setTranslation({ x: CENTER.x + Math.cos(angle) * radius, y: CENTER.y + Math.sin(angle) * radius }, true);
  let last = positions(w).ball;
  const moves = [];
  for (let step = 0; step < steps; step += 1) {
    w.setPointer(
      true,
      CENTER.x + Math.cos(angle + 0.3) * (radius + past),
      CENTER.y + Math.sin(angle + 0.3) * (radius + past),
    );
    w.step(DT);
    const { ball } = positions(w);
    moves.push(Math.hypot(ball.x - last.x, ball.y - last.y));
    last = ball;
  }
  return moves;
}

test('a held Ball has no hidden speed: let go, it goes on as it was seen to move', () => {
  for (const past of [40, 120, 200]) {
    for (const angle of [-0.6, 0.2, 1.0, 1.9]) {
      for (let phase = 0; phase < 4; phase += 1) {
        const w = metalphone('impact');
        const moves = pressFar(w, angle, past, 30 + phase);
        const seen = Math.max(...moves.slice(-2));
        w.setPointer(false, 0, 0);
        let last = positions(w).ball;
        for (let step = 0; step < 30; step += 1) {
          w.step(DT);
          const { ball } = positions(w);
          const move = Math.hypot(ball.x - last.x, ball.y - last.y);
          assert.ok(move < seen + 0.5, `past ${past}, angle ${angle}: ${move} px per step after ${seen}`);
          last = ball;
        }
      }
    }
  }
});

test('a held Ball caught between dots does not shake while the pointer waits far past them', () => {
  for (const past of [80, 200]) {
    for (const angle of [-0.6, 0.2, 1.0, 1.9]) {
      const moves = pressFar(metalphone('impact'), angle, past, 60);
      const shaking = moves.slice(30).filter((move) => move > 2).length;
      assert.ok(shaking <= 2, `past ${past}, angle ${angle}: ${shaking} of 30 steps`);
    }
  }
});

test('pressing pushes a dot about as much as before, not more with every slice', () => {
  const moved = (overlapBallContact) => {
    const w = new DotpingPhysicsWorld(RAPIER, 600, 400, {
      ...METALPHONE,
      overlapBallContact,
      particleCount: 1,
    });
    w.arrangeParticlesToTargets([{ x: 300, y: 200, vx: 0, vy: 0 }]);
    w.controlBall.setTranslation({ x: 300 - SUM - 1, y: 200 }, true);
    for (let step = 0; step < 300; step += 1) {
      w.setPointer(true, 300 - SUM + 20, 200);
      w.step(DT);
    }
    return positions(w).dots[0].x - 300;
  };
  const before = moved('surface');
  const now = moved('impact');
  assert.ok(now > before * 0.5 && now < before * 1.3, `surface ${before} px, impact ${now} px`);
});

test('a heavy Ball dragged through light dots is not held back', () => {
  const lag = (overlapBallContact) => {
    const w = new DotpingPhysicsWorld(RAPIER, 600, 400, {
      ...DEFAULT_SETTINGS,
      collisionMode: 'independence-overlapping',
      overlapBallContact,
      gravityMode: 'none',
      particleCount: 200,
      particleRadius: 4,
      particleMass: 0.01,
      controlBallRadius: 30,
      controlBallMass: 1000,
      controlBallLinearDamping: 0,
    });
    w.arrangeParticlesToTargets(Array.from({ length: 200 }, (_, index) => ({
      x: 100 + (index % 40) * 10, y: 180 + Math.floor(index / 40) * 10, vx: 0, vy: 0,
    })));
    let worst = 0;
    for (let step = 0; step < 60; step += 1) {
      const x = 60 + step * 8;
      w.setPointer(true, x, 200);
      w.step(DT);
      // The first steps take the Ball from the centre to the pointer.
      if (step > 10) worst = Math.max(worst, Math.abs(positions(w).ball.x - Math.min(x, 570)));
    }
    return worst;
  };
  const now = lag('impact');
  const surface = lag('surface');
  assert.ok(now < 0.5, `impact lag ${now}`);
  assert.ok(surface > 2, `surface lag ${surface}`);
});

test('a head-on hit conserves momentum and bounces with Contact Bounce, part way through the step', () => {
  const dots = new OverlapParticles(1);
  dots.set(0, 1060, 1000, -200, 0);
  const ball = { x: 1000, y: 1000, vx: 900, vy: 0, radius: 50, mass: 3, friction: 0, angvel: 0 };
  const params = {
    width: 2000, height: 2000, radius: 4, mass: 2, friction: 0, restitution: 0.5, wallRestitution: 0.5,
  };
  const end = new BallImpactWalk(dots).run(DT, ball, params);
  assert.ok(Math.abs(3 * end.vx + 2 * dots.vx[0] - (3 * 900 - 2 * 200)) < 1e-6);
  assert.ok(Math.abs(dots.vx[0] - end.vx - 0.5 * 1100) < 1e-6);
  assert.equal(dots.ballPushed[0], 1);
  assert.ok(Math.abs(dots.ballHitEnergy[0] - 1100) < 1e-6);
  // They touch after 6 px of the 18.3 px they close in the step, then part.
  const gap = dots.x[0] + dots.vx[0] * DT - end.x - 54;
  const toi = 6 / (1100 * DT);
  assert.ok(Math.abs(gap - 0.5 * 1100 * DT * (1 - toi)) < 1e-6, `gap ${gap}`);
});

test('a fast Ball hits every dot in its way in order, and only those', () => {
  const dots = new OverlapParticles(4);
  // Three light dots in a row and one beside the path.
  dots.set(0, 1070, 1000, 0, 0);
  dots.set(1, 1080, 1000, 0, 0);
  dots.set(2, 1090, 1000, 0, 0);
  dots.set(3, 1080, 1080, 0, 0);
  const ball = { x: 1000, y: 1000, vx: 4000, vy: 0, radius: 50, mass: 1000, friction: 0, angvel: 0 };
  const params = {
    width: 4000, height: 2000, radius: 4, mass: 0.01, friction: 0, restitution: 0, wallRestitution: 0.5,
  };
  const end = new BallImpactWalk(dots).run(DT, ball, params);
  assert.deepEqual(Array.from(dots.ballPushed), [1, 1, 1, 0]);
  assert.ok(Math.abs(end.x - (1000 + 4000 * DT)) < 0.1, `Ball at ${end.x}`);
  for (const index of [0, 1, 2]) {
    const gap = dots.x[index] + dots.vx[index] * DT - end.x - 54;
    assert.ok(gap > -0.2, `dot ${index} gap ${gap}`);
  }
});

test('a fixed dot stops the Ball, and the dot behind it is not touched', () => {
  const dots = new OverlapParticles(2);
  dots.set(0, 1070, 1000, 0, 0);
  dots.set(1, 1100, 1000, 0, 0);
  const ball = { x: 1000, y: 1000, vx: 6000, vy: 0, radius: 50, mass: 0.1, friction: 0, angvel: 0, held: true };
  const params = {
    width: 4000, height: 2000, radius: 4, mass: 100, friction: 0, restitution: 0, wallRestitution: 0.5,
  };
  const end = new BallImpactWalk(dots).run(DT, ball, params);
  assert.deepEqual(Array.from(dots.ballPushed), [1, 0]);
  assert.equal(dots.vx[1], 0);
  assert.ok(Math.abs(end.x - 1016) < 0.3, `Ball at ${end.x}`);
});

test('a Ball turned by a dot next to a wall stays inside the field', () => {
  for (let offset = -30; offset <= 30; offset += 5) {
    const dots = new OverlapParticles(1);
    dots.set(0, 1000 + offset, 70, 0, 0);
    const ball = { x: 1000, y: 160, vx: 0, vy: -9000, radius: 27, mass: 0.1, friction: 1, angvel: 0, held: true };
    const params = {
      width: 2000, height: 2000, radius: 13, mass: 100, friction: 1, restitution: 0, wallRestitution: 0.9,
    };
    const end = new BallImpactWalk(dots).run(DT, ball, params);
    assert.ok(end.y >= 27, `offset ${offset}: y ${end.y}`);
    const gap = Math.hypot(dots.x[0] + dots.vx[0] * DT - end.x, dots.y[0] + dots.vy[0] * DT - end.y) - 40;
    assert.ok(gap > -0.1, `offset ${offset}: gap ${gap}`);
  }
});

function lonelyBall(overlapBallContact, over = {}) {
  const w = new DotpingPhysicsWorld(RAPIER, 360, 800, {
    ...DEFAULT_SETTINGS,
    collisionMode: 'independence-overlapping',
    overlapBallContact,
    gravityMode: 'none',
    particleCount: 1,
    particleRadius: 1,
    controlBallRadius: 30,
    ...over,
  });
  w.arrangeParticlesToTargets([{ x: 2, y: 2, vx: 0, vy: 0 }]);
  return w;
}

test('walls bounce, damp and sound as they do with Rapier', () => {
  for (const [wallRestitution, controlBallLinearDamping] of [[1, 0], [0.9, 0], [0, 0], [0.9, 0.5]]) {
    const run = (contact) => {
      const w = lonelyBall(contact, { wallRestitution, controlBallLinearDamping });
      w.controlBall.setTranslation({ x: 180, y: 400 }, true);
      w.controlBall.setLinvel({ x: 500, y: 237 }, true);
      const sounds = [];
      for (let step = 0; step < 100; step += 1) {
        for (const impact of w.step(DT).impacts) {
          if (impact.kind === 'ball-wall') sounds.push(impact.energy);
        }
      }
      return { speed: positions(w).ball.speed, sounds };
    };
    const rapier = run('sink');
    const walk = run('impact');
    const name = `bounce ${wallRestitution}, damping ${controlBallLinearDamping}`;
    assert.ok(Math.abs(walk.speed - rapier.speed) < 1 + rapier.speed * 0.02, `${name}: ${walk.speed} against ${rapier.speed}`);
    assert.equal(walk.sounds.length, rapier.sounds.length, name);
    walk.sounds.forEach((energy, index) => {
      assert.ok(Math.abs(energy - rapier.sounds[index]) < rapier.sounds[index] * 0.1, `${name}: ${energy} against ${rapier.sounds[index]}`);
    });
  }
});

test('a damped Ball trails the pointer as it does with Rapier', () => {
  const lag = (contact, controlBallLinearDamping) => {
    const w = lonelyBall(contact, { controlBallLinearDamping });
    for (let step = 0; step < 50; step += 1) {
      w.setPointer(true, 60 + step * 4, 400);
      w.step(DT);
    }
    return 60 + 49 * 4 - positions(w).ball.x;
  };
  for (const damping of [0, 10, 100]) {
    const rapier = lag('sink', damping);
    const walk = lag('impact', damping);
    assert.ok(Math.abs(walk - rapier) < 0.05, `damping ${damping}: ${walk} against ${rapier}`);
  }
});

test('the Ball still turns by its spin, and friction spins both bodies', () => {
  const w = new DotpingPhysicsWorld(RAPIER, 600, 400, {
    ...METALPHONE,
    overlapBallContact: 'impact',
    particleCount: 1,
    particleMass: 1,
    particleLinearDamping: 0,
    controlBallMass: 1,
  });
  w.readParticleAngles = true;
  w.arrangeParticlesToTargets([{ x: 300, y: 225, vx: 0, vy: 0 }]);
  w.controlBall.setTranslation({ x: 230, y: 200 }, true);
  w.controlBall.setLinvel({ x: 400, y: 0 }, true);
  for (let step = 0; step < 30; step += 1) w.step(DT);
  const { dots, ball } = positions(w);
  assert.notEqual(ball.angle, 0);
  assert.notEqual(dots[0].angle, 0);
});

test('a Touch Ball that is away does nothing, and comes back', () => {
  const w = lonelyBall('impact', { controlBallMode: 'touch' });
  for (let step = 0; step < 5; step += 1) assert.equal(w.step(DT).impacts.length, 0);
  w.setPointer(true, 100, 300);
  w.step(DT);
  const { ball } = positions(w);
  assert.ok(ball.visible);
  assert.ok(Math.abs(ball.x - 100) < 0.01 && Math.abs(ball.y - 300) < 0.01);
});

test('a crowd packed onto the Ball does not hold it back or leave it inside', () => {
  const w = new DotpingPhysicsWorld(RAPIER, 558, 415, {
    ...DEFAULT_SETTINGS,
    collisionMode: 'independence-overlapping',
    overlapBallContact: 'impact',
    gravityMode: 'gravity',
    gravityStrength: 3,
    particleCount: 1000,
    particleRadius: 8,
  });
  for (let step = 0; step < 240; step += 1) w.step(DT);
  let worst = 0;
  for (let step = 0; step < 120; step += 1) {
    const x = 279 + 150 * Math.sin(step * 0.06);
    w.setPointer(true, x, 207);
    w.step(DT);
    if (step > 10) worst = Math.max(worst, Math.abs(positions(w).ball.x - x));
  }
  assert.ok(worst < 3, `lag ${worst}`);
  const { dots, ball } = positions(w);
  const deep = dots.filter((dot) => Math.hypot(dot.x - ball.x, dot.y - ball.y) < 60 - 4).length;
  assert.ok(deep < 100, `${deep} dots deep inside the Ball`);
  for (const dot of dots) assert.ok(Number.isFinite(dot.x) && Number.isFinite(dot.y));
});

test('the metrics name the contact rule in use', () => {
  const w = lonelyBall('impact');
  assert.equal(w.step(DT).metrics.overlapBallContact, 'impact');
});

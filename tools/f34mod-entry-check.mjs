// Reproduces the 2026-11-21 report: an `Independent overlap` crowd pulled
// onto the Ball by a strong Gravity, then switched to `Physical collision`,
// then raised to 10000 dots. Prints step times per phase (see
// docs/project-status.md, 2026-11-21 entry). Runs headless in Node on the
// real Rapier build.
//
//   npm test                      # builds .test-build
//   node tools/f34mod-entry-check.mjs [width] [height] [gravity] [capMs] [presetJson]
//
// Prints, per phase, step times, the entry state, resting dots (now and the
// range over the phase) and the grid estimate of the visible dots.
// Defaults: 651 x 442 (the report's viewport), Gravity 100, 60 s cap for the
// 10000-dot phase. Without presetJson the scene uses the settings below,
// copied from the user's F34 variant (usr_data/debug1120, not tracked).
import { readFileSync } from 'node:fs';

import RAPIER from '@dimforge/rapier2d-compat';

import { DEFAULT_SETTINGS } from '../.test-build/sim/settings.js';
import { DotpingPhysicsWorld } from '../.test-build/sim/physicsWorld.js';
import { overlapEstimate } from '../.test-build/sim/physicalEntry.js';

await RAPIER.init();

const F34MOD = {
  start: { formation: 'random', ballX: 50, ballY: 50, ballSpeed: 410, particleSpeed: 0 },
  settings: {
    collisionMode: 'independence-overlapping',
    gravityMode: 'gravity',
    gravityStrength: 100,
    particleCount: 5000,
    particleRadius: 3,
    particleMass: 0.01,
    contactRestitution: 1,
    particleFriction: 0.25,
    particleLinearDamping: 100,
    controlBallMode: 'persistent',
    controlBallRadius: 27,
    controlBallMass: 1000,
    controlBallFriction: 0.25,
    controlBallLinearDamping: 0,
    wallRestitution: 1,
    ballWeave: false,
  },
};

const [W = 651, H = 442, gravityArg, cap10000 = 60000] = process.argv.slice(2, 6).map(Number);
const preset = process.argv[6]
  ? JSON.parse(readFileSync(process.argv[6], 'utf8')).presets[0]
  : F34MOD;
const gravity = Number.isFinite(gravityArg) ? gravityArg : preset.settings.gravityStrength;
const settings = { ...DEFAULT_SETTINGS, ...preset.settings, gravityStrength: gravity };
const world = new DotpingPhysicsWorld(RAPIER, W, H, settings);
world.applyStart(preset.start);
const DT = 1 / 60;

function estimate() {
  // Visible dots only: resting dots sit under their hosts.
  const particles = world.snapshot().particles.filter((p) => p.visible);
  const xs = Float64Array.from(particles, (p) => p.x);
  const ys = Float64Array.from(particles, (p) => p.y);
  return `est=${overlapEstimate(xs, ys, particles.length, settings.particleRadius)} n=${particles.length}`;
}

function run(label, frames, capMs = 20000) {
  let worst = 0;
  let total = 0;
  let count = 0;
  let restMin = Infinity;
  let restMax = 0;
  const startedAt = performance.now();
  for (let index = 0; index < frames; index += 1) {
    const stepStartedAt = performance.now();
    world.step(DT);
    const cost = performance.now() - stepStartedAt;
    worst = Math.max(worst, cost);
    total += cost;
    count += 1;
    restMin = Math.min(restMin, world.restingParticleCount);
    restMax = Math.max(restMax, world.restingParticleCount);
    if (performance.now() - startedAt > capMs) break;
  }
  console.log(
    `${label}: frames=${count} mean=${(total / count).toFixed(1)}ms worst=${worst.toFixed(0)}ms`
      + ` engine=${world.overlapEngine} entry=${world.physicalEntry}`
      + ` resting=${world.restingParticleCount} (${restMin}-${restMax}) ${estimate()}`,
  );
}

console.log(`field ${W}x${H} gravity ${gravity}`);
run('overlap 10s', 600);
world.updateSettings({ ...settings, collisionMode: 'collision-physical' });
run('physical first 60', 60);
run('physical next 120', 120);
world.updateSettings({ ...settings, collisionMode: 'collision-physical', particleCount: 10000 });
console.log(`after count 10000: entry=${world.physicalEntry} resting=${world.restingParticleCount} ${estimate()}`);
run('physical 10000 first 50', 50, cap10000);
run('physical 10000 next 600', 600, cap10000);
world.updateSettings({ ...settings, collisionMode: 'independence-overlapping', particleCount: 10000 });
console.log(`back to overlap: n=${world.particleCount} resting=${world.restingParticleCount}`);

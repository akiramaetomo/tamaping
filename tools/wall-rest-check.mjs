// Compares how calmly dots rest against the walls in each collider layout
// (see docs/testing-guide.md, `Wall Rest Check`). Runs headless in Node on
// the real Rapier build, with a seeded `Math.random`, so both layouts start
// from the same scene.
//
//   npm test                      # builds .test-build
//   node tools/wall-rest-check.mjs [--layouts split,single] [--seeds 5]
//                                  [--settle 10] [--measure 3]
//
// Each seed is a different starting scatter. Per scene and layout it prints
// the mean and standard deviation over seeds of, in the measure window:
//   wall_rms_speed   RMS speed of dots within 2 radii of a wall (jitter)
//   wall_dots        average number of those dots
//   max_wall_pen     deepest dot surface past a wall
//   max_overlap      deepest dot-dot overlap (Physical collision only)
//   wall_impacts_s   particle-wall impact events per second (tick sounds)

import RAPIER from '@dimforge/rapier2d-compat';
import { DEFAULT_SETTINGS } from '../.test-build/sim/settings.js';
import { DotpingPhysicsWorld } from '../.test-build/sim/physicsWorld.js';

const WIDTH = 360;
const HEIGHT = 800;
const DT = 1 / 60;
const OVERLAP_SAMPLE_EVERY = 10;

const options = parseArgs(process.argv.slice(2));

// Each scene presses dots against a wall in a slow, settled way.
const SCENES = [
  {
    name: 'antigravity-physical',
    settings: { collisionMode: 'collision-physical', gravityMode: 'antigravity', gravityStrength: 1 },
    pointer: { x: WIDTH / 2, y: HEIGHT / 2 },
  },
  {
    name: 'gravity-physical-ball-at-bottom',
    settings: { collisionMode: 'collision-physical', gravityMode: 'gravity', gravityStrength: 1 },
    pointer: { x: WIDTH / 2, y: HEIGHT },
  },
  {
    name: 'gravity-physical-ball-in-corner',
    settings: { collisionMode: 'collision-physical', gravityMode: 'gravity', gravityStrength: 1 },
    pointer: { x: WIDTH, y: HEIGHT },
  },
  {
    name: 'antigravity-overlap',
    settings: { collisionMode: 'independence-overlapping', gravityMode: 'antigravity', gravityStrength: 1 },
    pointer: { x: WIDTH / 2, y: HEIGHT / 2 },
  },
];

await RAPIER.init();

for (const scene of SCENES) {
  console.log(`----- ${scene.name}`);
  for (const layout of options.layouts) {
    const results = [];
    for (let seed = 1; seed <= options.seeds; seed += 1) {
      results.push(runScene(scene, layout, seed));
    }
    const field = (key, digits) => meanAndSd(results.map((result) => result[key]), digits);
    console.log(
      [
        `layout=${layout.padEnd(6)}`,
        `wall_rms_speed=${field('wallRmsSpeed', 3)}`,
        `wall_dots=${field('wallDots', 1)}`,
        `max_wall_pen=${field('maxWallPenetration', 3)}`,
        `max_overlap=${field('maxOverlap', 3)}`,
        `wall_impacts_s=${field('wallImpactsPerSecond', 2)}`,
      ].join(' '),
    );
  }
}

function runScene(scene, layout, seed) {
  const restoreRandom = seedRandom(seed);
  const settings = { ...DEFAULT_SETTINGS, ...scene.settings, colliderLayout: layout };
  const world = new DotpingPhysicsWorld(RAPIER, WIDTH, HEIGHT, settings);
  restoreRandom();

  const radius = settings.particleRadius;
  const settleSteps = Math.round(options.settle / DT);
  const measureSteps = Math.round(options.measure / DT);
  let speedSquares = 0;
  let wallSamples = 0;
  let maxWallPenetration = 0;
  let maxOverlap = 0;
  let wallImpacts = 0;

  world.setPointer(true, scene.pointer.x, scene.pointer.y);
  for (let step = 0; step < settleSteps + measureSteps; step += 1) {
    const { impacts } = world.step(DT);
    if (step < settleSteps) {
      continue;
    }

    wallImpacts += impacts.filter((impact) => impact.kind === 'particle-wall').length;
    const { particles } = world.snapshot();
    for (const dot of particles) {
      const wallGap = Math.min(dot.x, dot.y, WIDTH - dot.x, HEIGHT - dot.y) - radius;
      maxWallPenetration = Math.max(maxWallPenetration, -wallGap);
      if (wallGap < radius * 2) {
        speedSquares += dot.speed * dot.speed;
        wallSamples += 1;
      }
    }

    if (settings.collisionMode === 'collision-physical' && step % OVERLAP_SAMPLE_EVERY === 0) {
      maxOverlap = Math.max(maxOverlap, deepestOverlap(particles, radius));
    }
  }

  return {
    wallRmsSpeed: wallSamples > 0 ? Math.sqrt(speedSquares / wallSamples) : 0,
    wallDots: wallSamples / measureSteps,
    maxWallPenetration,
    maxOverlap,
    wallImpactsPerSecond: wallImpacts / options.measure,
  };
}

function meanAndSd(values, digits) {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return `${mean.toFixed(digits)}±${Math.sqrt(variance).toFixed(digits)}`;
}

function deepestOverlap(particles, radius) {
  const cell = radius * 2;
  const grid = new Map();
  let deepest = 0;
  for (const dot of particles) {
    const cx = Math.floor(dot.x / cell);
    const cy = Math.floor(dot.y / cell);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const other of grid.get(`${cx + dx},${cy + dy}`) ?? []) {
          deepest = Math.max(deepest, radius * 2 - Math.hypot(dot.x - other.x, dot.y - other.y));
        }
      }
    }
    const key = `${cx},${cy}`;
    grid.set(key, [...(grid.get(key) ?? []), dot]);
  }
  return deepest;
}

// mulberry32; returns a function that restores the original `Math.random`.
function seedRandom(seed) {
  const original = Math.random;
  let state = seed >>> 0;
  Math.random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => {
    Math.random = original;
  };
}

function parseArgs(args) {
  const parsed = { layouts: ['split', 'single'], seeds: 5, settle: 10, measure: 3 };
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index + 1];
    switch (args[index]) {
      case '--layouts':
        parsed.layouts = value.split(',').map((layout) => layout.trim());
        index += 1;
        break;
      case '--seeds':
        parsed.seeds = Number(value);
        index += 1;
        break;
      case '--settle':
        parsed.settle = Number(value);
        index += 1;
        break;
      case '--measure':
        parsed.measure = Number(value);
        index += 1;
        break;
      default:
        throw new Error(`Unknown option: ${args[index]}`);
    }
  }
  return parsed;
}

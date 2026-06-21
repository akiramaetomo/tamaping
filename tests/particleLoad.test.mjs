import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PARTICLE_LOAD_DENSE_FILL_RATIO,
  PARTICLE_LOAD_EXTREME_COUNT,
  PARTICLE_LOAD_EXTREME_FILL_RATIO,
  PARTICLE_LOAD_EXTREME_RADIUS,
  PARTICLE_LOAD_HEAVY_COUNT,
  PARTICLE_LOAD_HEAVY_FILL_RATIO,
  PARTICLE_LOAD_VALUE_CLASSES,
  estimateParticleLoad,
  particleLoadLabel,
  particleLoadTitle,
} from '../.test-build/app/particleLoad.js';

const EPSILON = 0.0000001;

function assertAlmostEqual(actual, expected, epsilon = EPSILON) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

function countForFillRatio(fillRatio, radius, area = 10000) {
  return (fillRatio * area) / (Math.PI * radius * radius);
}

test('particle load fill-ratio thresholds preserve normal dense heavy and extreme levels', () => {
  assert.equal(PARTICLE_LOAD_DENSE_FILL_RATIO, 1);
  assert.equal(PARTICLE_LOAD_HEAVY_FILL_RATIO, 2);
  assert.equal(PARTICLE_LOAD_EXTREME_FILL_RATIO, 4);

  assert.deepEqual(
    estimateParticleLoad({ width: 100, height: 100, particleCount: 0, particleRadius: 10 }),
    { level: 'normal', fillRatio: 0 },
  );

  assert.equal(
    estimateParticleLoad({
      width: 100,
      height: 100,
      particleCount: countForFillRatio(0.99, 10),
      particleRadius: 10,
    }).level,
    'normal',
  );

  const dense = estimateParticleLoad({
    width: 100,
    height: 100,
    particleCount: countForFillRatio(1, 10),
    particleRadius: 10,
  });
  assert.equal(dense.level, 'dense');
  assertAlmostEqual(dense.fillRatio, 1);

  assert.equal(
    estimateParticleLoad({
      width: 100,
      height: 100,
      particleCount: countForFillRatio(2, 10),
      particleRadius: 10,
    }).level,
    'heavy',
  );
  assert.equal(
    estimateParticleLoad({
      width: 100,
      height: 100,
      particleCount: countForFillRatio(4, 10),
      particleRadius: 10,
    }).level,
    'extreme',
  );
});

test('particle load count and radius shortcuts preserve stress classifications', () => {
  assert.equal(PARTICLE_LOAD_HEAVY_COUNT, 2000);
  assert.equal(PARTICLE_LOAD_EXTREME_COUNT, 5000);
  assert.equal(PARTICLE_LOAD_EXTREME_RADIUS, 10);

  assert.equal(
    estimateParticleLoad({
      width: 100000,
      height: 100000,
      particleCount: PARTICLE_LOAD_HEAVY_COUNT,
      particleRadius: 2,
    }).level,
    'heavy',
  );
  assert.equal(
    estimateParticleLoad({
      width: 100000,
      height: 100000,
      particleCount: PARTICLE_LOAD_EXTREME_COUNT,
      particleRadius: PARTICLE_LOAD_EXTREME_RADIUS,
    }).level,
    'extreme',
  );
  assert.equal(
    estimateParticleLoad({
      width: 100000,
      height: 100000,
      particleCount: PARTICLE_LOAD_EXTREME_COUNT,
      particleRadius: PARTICLE_LOAD_EXTREME_RADIUS - 0.1,
    }).level,
    'heavy',
  );
});

test('particle load labels title text and class list preserve UI wording', () => {
  assert.deepEqual(PARTICLE_LOAD_VALUE_CLASSES, [
    'hud__value--load-dense',
    'hud__value--load-heavy',
    'hud__value--load-extreme',
  ]);
  assert.equal(particleLoadLabel('normal'), 'Normal');
  assert.equal(particleLoadLabel('dense'), 'Dense');
  assert.equal(particleLoadLabel('heavy'), 'Heavy');
  assert.equal(particleLoadLabel('extreme'), 'Extreme');
  assert.equal(
    particleLoadTitle({ level: 'dense', fillRatio: 1.234 }),
    'Particle load: Dense (1.23x fill)',
  );
});

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_DESIGN_VIEWPORT,
  DEFAULT_VIEW_SCALE_MODE,
  computeViewScale,
  normalizeDesignViewport,
  viewScaleLabel,
  viewScaleTitle,
} from '../.test-build/sim/viewScale.js';

const EPSILON = 0.0000001;

function assertAlmostEqual(actual, expected, epsilon = EPSILON) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

test('view scale defaults to Fit against a 360x800 phone design screen', () => {
  assert.equal(DEFAULT_VIEW_SCALE_MODE, 'fit');
  assert.deepEqual(DEFAULT_DESIGN_VIEWPORT, { width: 360, height: 800 });
});

test('1:1 keeps the screen as the world', () => {
  const view = computeViewScale({ width: 1920, height: 960 }, DEFAULT_DESIGN_VIEWPORT, '1:1');
  assert.deepEqual(view, { mode: '1:1', scale: 1, worldWidth: 1920, worldHeight: 960 });
  assert.equal(viewScaleLabel(view), '1:1');
});

test('Fit keeps the design area and the screen aspect ratio', () => {
  const screen = { width: 1920, height: 960 };
  const view = computeViewScale(screen, DEFAULT_DESIGN_VIEWPORT, 'fit');
  assertAlmostEqual(view.worldWidth * view.worldHeight, 360 * 800, 0.0001);
  assertAlmostEqual(view.worldWidth / view.worldHeight, screen.width / screen.height);
  assertAlmostEqual(view.worldWidth * view.scale, screen.width);
  assertAlmostEqual(view.scale, Math.sqrt((1920 * 960) / (360 * 800)));
  assert.equal(viewScaleLabel(view), `Fit ×${view.scale.toFixed(2)}`);
});

test('Fit on the design screen itself is an identity', () => {
  const view = computeViewScale({ width: 360, height: 800 }, DEFAULT_DESIGN_VIEWPORT, 'fit');
  assertAlmostEqual(view.scale, 1);
  assertAlmostEqual(view.worldWidth, 360);
  assertAlmostEqual(view.worldHeight, 800);
});

test('Fit shrinks a preset designed on a larger screen', () => {
  const view = computeViewScale({ width: 360, height: 800 }, { width: 1300, height: 700 }, 'fit');
  assert.ok(view.scale < 1);
  assertAlmostEqual(view.worldWidth * view.worldHeight, 1300 * 700, 0.001);
});

test('Fit keeps the particle fill ratio of the design screen', () => {
  const fill = (width, height) => (1000 * Math.PI * 8 * 8) / (width * height);
  const view = computeViewScale({ width: 1920, height: 950 }, DEFAULT_DESIGN_VIEWPORT, 'fit');
  assertAlmostEqual(fill(view.worldWidth, view.worldHeight), fill(360, 800), 0.0000001);
});

test('view scale guards against empty screens and design sizes', () => {
  const view = computeViewScale({ width: 0, height: -5 }, { width: 0, height: 0 }, 'fit');
  assert.ok(Number.isFinite(view.scale) && view.scale > 0);
  assert.ok(Number.isFinite(view.worldWidth) && view.worldWidth > 0);
  assert.ok(Number.isFinite(view.worldHeight) && view.worldHeight > 0);
});

test('design viewport normalization rejects bad values and clamps sizes', () => {
  assert.equal(normalizeDesignViewport(null), null);
  assert.equal(normalizeDesignViewport({ width: 'x', height: 800 }), null);
  assert.equal(normalizeDesignViewport({ width: 360 }), null);
  assert.deepEqual(normalizeDesignViewport({ width: 1299.6, height: 700.2 }), { width: 1300, height: 700 });
  assert.deepEqual(normalizeDesignViewport({ width: 5, height: 99999 }), { width: 100, height: 10000 });
});

test('view scale title names the design and screen sizes', () => {
  const screen = { width: 1920, height: 960 };
  const fit = computeViewScale(screen, DEFAULT_DESIGN_VIEWPORT, 'fit');
  assert.match(viewScaleTitle(fit, DEFAULT_DESIGN_VIEWPORT, screen), /design 360×800 -> screen 1920×960/);
  const oneToOne = computeViewScale(screen, DEFAULT_DESIGN_VIEWPORT, '1:1');
  assert.match(viewScaleTitle(oneToOne, DEFAULT_DESIGN_VIEWPORT, screen), /^1:1/);
});

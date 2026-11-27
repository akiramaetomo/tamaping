import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RAY_CORE_RADIUS,
  RAY_FOOTPRINT_MAX_MARGIN,
  RAY_SPIKE_HALF_LENGTH,
  RAY_SPIKE_HALF_WIDTH,
  rayFootprintMargin,
  rayFootprintOutline,
  rayFootprintShare,
  rayFootprintTemplate,
} from '../.test-build/render/rayFootprint.js';

function inside(points, x, y) {
  let hit = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      hit = !hit;
    }
  }
  return hit;
}

// Points of the drawn X: the core disc and both spikes' rectangles (the
// spike outline lies within its rectangle for every Curve), pulled in by a
// hair so that points on the outline's own edge do not count.
function xPoints() {
  const points = [];
  const pull = 0.999;
  for (let step = 0; step < 720; step += 1) {
    const angle = (step / 720) * Math.PI * 2;
    for (const r of [0.25, 0.5, 0.75, 1]) {
      points.push([Math.cos(angle) * RAY_CORE_RADIUS * r * pull, Math.sin(angle) * RAY_CORE_RADIUS * r * pull]);
    }
  }
  for (const angle of [Math.PI / 4, -Math.PI / 4]) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    for (let i = -100; i <= 100; i += 1) {
      for (let j = -10; j <= 10; j += 1) {
        const x = (i / 100) * RAY_SPIKE_HALF_LENGTH * pull;
        const y = (j / 10) * RAY_SPIKE_HALF_WIDTH * pull;
        points.push([x * cos - y * sin, x * sin + y * cos]);
      }
    }
  }
  return points;
}

test('the ray outline covers the whole X at every margin', () => {
  for (const margin of [0, 0.05, 0.1, RAY_FOOTPRINT_MAX_MARGIN]) {
    const outline = rayFootprintOutline(margin);
    const missed = xPoints().filter(([x, y]) => !inside(outline, x, y));
    assert.equal(missed.length, 0, `margin ${margin}: ${missed.length} points of the X outside`);
  }
});

function edgeDistance(points, x, y) {
  let best = Infinity;
  for (let i = 0; i < points.length; i += 1) {
    const [ax, ay] = points[i];
    const [bx, by] = points[(i + 1) % points.length];
    const dx = bx - ax;
    const dy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
    best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
  }
  return best;
}

test('the grown outline keeps the margin all round the X', () => {
  for (const margin of [0.03, 0.08, 0.15]) {
    const outline = rayFootprintOutline(margin);
    const closest = Math.min(...xPoints().map(([x, y]) => edgeDistance(outline, x, y)));
    assert.ok(closest > margin * 0.99, `margin ${margin}: closest ${closest}`);
  }
});

test('the ray outline never leaves the square sprite', () => {
  for (const margin of [0, RAY_FOOTPRINT_MAX_MARGIN, 1, 10]) {
    for (const [x, y] of rayFootprintOutline(margin)) {
      // The template is stored as 32-bit floats.
      assert.ok(Math.abs(x) <= 1 + 1e-6 && Math.abs(y) <= 1 + 1e-6, `margin ${margin}: ${x}, ${y}`);
    }
  }
});

test('the triangles tile the outline once, so no pixel is drawn twice', () => {
  const { base, grow, indices } = rayFootprintTemplate();
  for (const margin of [0, 0.08, RAY_FOOTPRINT_MAX_MARGIN]) {
    const point = (index) => [base[index * 2] + grow[index * 2] * margin, base[index * 2 + 1] + grow[index * 2 + 1] * margin];
    let total = 0;
    const signs = new Set();
    for (let i = 0; i < indices.length; i += 3) {
      const [ax, ay] = point(indices[i]);
      const [bx, by] = point(indices[i + 1]);
      const [cx, cy] = point(indices[i + 2]);
      const twice = (bx - ax) * (cy - ay) - (cx - ax) * (by - ay);
      assert.ok(Math.abs(twice) > 1e-6, 'no degenerate triangle');
      signs.add(Math.sign(twice));
      total += Math.abs(twice) / 2;
    }
    assert.equal(signs.size, 1, 'all triangles wind the same way');
    assert.ok(Math.abs(total - rayFootprintShare(margin) * 4) < 1e-6, `margin ${margin}: ${total}`);
  }
});

test('the outline paints a fraction of the square', () => {
  assert.ok(Math.abs(rayFootprintShare(0) - 0.268) < 0.005, String(rayFootprintShare(0)));
  // Glow star 1k: dots of radius 3 at view scale 1.93 and resolution 2; a
  // ray at rest is 29 device pixels from centre to tip, with the 2-pixel
  // margin of rayMesh.ts.
  const restMargin = rayFootprintMargin(2, 2.5 * 3 * 1.93 * 2);
  assert.ok(rayFootprintShare(restMargin) < 0.42, String(rayFootprintShare(restMargin)));
  // Never more than this, however small the ray.
  assert.ok(rayFootprintShare(RAY_FOOTPRINT_MAX_MARGIN) < 0.6, String(rayFootprintShare(RAY_FOOTPRINT_MAX_MARGIN)));
});

test('the margin is given in device pixels and kept within the square', () => {
  assert.equal(rayFootprintMargin(2.5, 50), 0.05);
  assert.equal(rayFootprintMargin(2.5, 1), RAY_FOOTPRINT_MAX_MARGIN);
  assert.equal(rayFootprintMargin(2.5, 0), RAY_FOOTPRINT_MAX_MARGIN);
  assert.equal(rayFootprintMargin(-1, 50), 0);
});

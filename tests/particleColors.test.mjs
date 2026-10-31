import test from 'node:test';
import assert from 'node:assert/strict';

import {
  paletteColor,
  particleColor,
  speedColor,
  speedColorToward,
  vividGlowColor,
} from '../.test-build/render/particleColors.js';

const GLOW_MODES = ['gold', 'white', 'cyan', 'pink', 'red', 'green', 'rainbow'];
const PALETTES = ['blue', 'green', 'yellow', 'red', 'pink', 'orange', 'white', 'pastel', 'colorful'];

test('speed color with a cached glow target matches the per-frame computation', () => {
  for (const mode of GLOW_MODES) {
    for (const vividness of [0, 0.5, 0.85, 1, 1.6, 2]) {
      for (const index of [0, 1, 7, 123, 999]) {
        const target = vividGlowColor(mode, index, vividness);
        for (const response of [0, 0.3, 1, 10, 100]) {
          for (const speed of [0, 120, 800, 2000, 4000, 9000]) {
            const base = paletteColor('blue', index);
            assert.equal(
              speedColorToward(speed, base, response, target),
              speedColor(speed, base, response, mode, vividness, index),
              `${mode} v${vividness} i${index} r${response} s${speed}`,
            );
          }
        }
      }
    }
  }
});

test('palette colors are stable per dot and stay 24-bit', () => {
  for (const palette of PALETTES) {
    for (const index of [0, 1, 500, 1999]) {
      const color = paletteColor(palette, index);
      assert.equal(paletteColor(palette, index), color);
      assert.ok(Number.isInteger(color) && color >= 0 && color <= 0xffffff, `${palette} ${index}`);
    }
  }
  assert.notEqual(paletteColor('blue', 0), paletteColor('blue', 1));
});

test('particle color packs BGR plus an alpha byte like Pixi particles', () => {
  // Pixi Particle: color = bgr + ((alpha * 255 | 0) << 24)
  assert.equal(particleColor(0x123456, 0), 0x563412);
  assert.equal(particleColor(0xffffff, 0.72), 0xffffff + ((0.72 * 255) | 0) * 2 ** 24 - 2 ** 32);
  assert.equal(particleColor(0x0000ff, 0.18), 0xff0000 + (((0.18 * 255) | 0) << 24));
  assert.equal(particleColor(0xf7fbff, 0.94) >>> 24, (0.94 * 255) | 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { MESSAGE_FORMATION_SAMPLE_ALPHA } from '../.test-build/app/messageFormation.js';
import { sampleMessagePixels } from '../.test-build/app/messageFormationCanvas.js';

function alphaImage(width, height, alphaAt) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      data[(y * width + x) * 4 + 3] = alphaAt(x, y);
    }
  }
  return { width, height, data };
}

test('message pixel sampling keeps only grid points at or above the alpha threshold', () => {
  const image = alphaImage(16, 8, (x) => (x < 8 ? MESSAGE_FORMATION_SAMPLE_ALPHA : MESSAGE_FORMATION_SAMPLE_ALPHA - 1));

  // Small particles and font: the step stays at its minimum of 4 pixels.
  assert.deepEqual(sampleMessagePixels(image, 13, 1), [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 0, y: 4 },
    { x: 4, y: 4 },
  ]);
});

test('message pixel sampling step grows with particle size and font size', () => {
  const image = alphaImage(40, 1, () => 255);

  // Particle radius 4 -> step floor(4 * 2.25) = 9.
  assert.deepEqual(sampleMessagePixels(image, 13, 4).map((point) => point.x), [0, 9, 18, 27, 36]);
  // Font size 260 -> step 260 / 13 = 20.
  assert.deepEqual(sampleMessagePixels(image, 260, 1).map((point) => point.x), [0, 20]);
});

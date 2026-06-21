import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AUDIO_UI_MAX,
  LOG_UI_MAX,
  WEIGHT_UI_MAX,
  audioDurationFromSlider,
  audioFrequencyFromSlider,
  audioSpreadFromSlider,
  brightnessResponseFromSlider,
  controlBallSizeFromSlider,
  dampingFromSlider,
  formatAudioDuration,
  formatAudioFrequency,
  formatAudioSpread,
  formatBrightnessResponse,
  formatControlBallSize,
  formatDamping,
  formatGravityStrength,
  formatVividness,
  formatWeight,
  gravityStrengthFromSlider,
  logValueFromSlider,
  particleWeightFromSlider,
  sliderFromAudioDuration,
  sliderFromAudioFrequency,
  sliderFromAudioSpread,
  sliderFromBrightnessResponse,
  sliderFromControlBallSize,
  sliderFromDamping,
  sliderFromGravityStrength,
  sliderFromLogValue,
  sliderFromParticleWeight,
  sliderFromWeight,
  weightFromSlider,
} from '../.test-build/app/settingScales.js';

const EPSILON = 0.0000001;

function assertAlmostEqual(actual, expected, epsilon = EPSILON) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

test('generic logarithmic slider mapping clamps endpoints and round-trips', () => {
  assert.equal(LOG_UI_MAX, 1000);
  assertAlmostEqual(logValueFromSlider(-10, 0.1, 1000), 0.1);
  assertAlmostEqual(logValueFromSlider(LOG_UI_MAX, 0.1, 1000), 1000);
  assertAlmostEqual(logValueFromSlider(LOG_UI_MAX / 2, 0.1, 1000), 10);
  assert.equal(sliderFromLogValue(0.001, 0.1, 1000), 0);
  assert.equal(sliderFromLogValue(10000, 0.1, 1000), LOG_UI_MAX);
  assert.equal(sliderFromLogValue(10, 0.1, 1000), LOG_UI_MAX / 2);
});

test('damping scale preserves zero/off and existing formatting thresholds', () => {
  assert.equal(sliderFromDamping(0), 0);
  assert.equal(dampingFromSlider(0), 0);
  assertAlmostEqual(dampingFromSlider(1000), 100);
  assert.equal(sliderFromDamping(100), 1000);
  assert.equal(formatDamping(0), '0');
  assert.equal(formatDamping(0.1234), '0.123');
  assert.equal(formatDamping(3.456), '3.46');
  assert.equal(formatDamping(42.3), '42.3');
  assert.equal(formatDamping(123.4), '123');
});

test('weight and particle weight scales preserve logarithmic ranges', () => {
  assert.equal(WEIGHT_UI_MAX, 1000);
  assertAlmostEqual(weightFromSlider(0), 0.1);
  assertAlmostEqual(weightFromSlider(WEIGHT_UI_MAX), 1000);
  assertAlmostEqual(weightFromSlider(WEIGHT_UI_MAX / 2), 10);
  assert.equal(sliderFromWeight(10), WEIGHT_UI_MAX / 2);
  assert.equal(sliderFromWeight(0.001), 0);
  assert.equal(sliderFromWeight(99999), WEIGHT_UI_MAX);
  assertAlmostEqual(particleWeightFromSlider(0), 0.01);
  assertAlmostEqual(particleWeightFromSlider(1000), 100);
  assert.equal(sliderFromParticleWeight(1), 500);
  assert.equal(formatWeight(0.123), '0.12');
  assert.equal(formatWeight(5.67), '5.7');
  assert.equal(formatWeight(123.4), '123');
});

test('gravity, ball size, and brightness scales keep accepted display rules', () => {
  assertAlmostEqual(gravityStrengthFromSlider(0), 0.01);
  assertAlmostEqual(gravityStrengthFromSlider(1000), 100);
  assert.equal(sliderFromGravityStrength(1), 500);
  assert.equal(formatGravityStrength(0.5), '0.50G');
  assert.equal(formatGravityStrength(5), '5.00G');
  assert.equal(formatGravityStrength(50), '50.0G');

  assert.equal(controlBallSizeFromSlider(0), 2);
  assert.equal(controlBallSizeFromSlider(500), 20);
  assert.equal(controlBallSizeFromSlider(1000), 200);
  assert.equal(sliderFromControlBallSize(20), 500);
  assert.equal(formatControlBallSize(19.6), '20');

  assert.equal(brightnessResponseFromSlider(0), 0);
  assertAlmostEqual(brightnessResponseFromSlider(1000), 100);
  assert.equal(sliderFromBrightnessResponse(0), 0);
  assert.equal(sliderFromBrightnessResponse(10), 500);
  assert.equal(formatBrightnessResponse(0), '0.00x');
  assert.equal(formatBrightnessResponse(2.345), '2.35x');
  assert.equal(formatBrightnessResponse(12.34), '12.3x');
  assert.equal(formatVividness(0.85), '0.85x');
});

test('audio scales preserve pitch spread duration mapping and labels', () => {
  assert.equal(AUDIO_UI_MAX, 1000);
  assertAlmostEqual(audioFrequencyFromSlider(0), 30);
  assertAlmostEqual(audioFrequencyFromSlider(1000), 10000);
  assert.equal(sliderFromAudioFrequency(30), 0);
  assert.equal(sliderFromAudioFrequency(10000), 1000);
  assert.equal(formatAudioFrequency(440), '440Hz');
  assert.equal(formatAudioFrequency(1250), '1.3kHz');
  assert.equal(formatAudioFrequency(9950), '10kHz');

  assertAlmostEqual(audioSpreadFromSlider(0), 1);
  assertAlmostEqual(audioSpreadFromSlider(1000), 2);
  assert.equal(sliderFromAudioSpread(1), 0);
  assert.equal(sliderFromAudioSpread(2), 1000);
  assert.equal(formatAudioSpread(1.234), '1.23x');

  assertAlmostEqual(audioDurationFromSlider(0), 1);
  assertAlmostEqual(audioDurationFromSlider(1000), 1000);
  assert.equal(sliderFromAudioDuration(1), 0);
  assert.equal(sliderFromAudioDuration(1000), 1000);
  assert.equal(formatAudioDuration(12.3), '12ms');
});

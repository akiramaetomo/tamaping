import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_SETTINGS } from '../.test-build/sim/settings.js';
import { settingsFromUrl } from '../.test-build/app/urlSettings.js';

test('url settings keep defaults without diagnostic parameters', () => {
  const settings = settingsFromUrl(DEFAULT_SETTINGS, '');

  assert.deepEqual(settings, DEFAULT_SETTINGS);
  assert.notEqual(settings, DEFAULT_SETTINGS);
});

test('url settings read the Rapier length unit with a 1000 cap', () => {
  assert.equal(settingsFromUrl(DEFAULT_SETTINGS, '?lu=10').rapierLengthUnit, 10);
  assert.equal(settingsFromUrl(DEFAULT_SETTINGS, '?rapierLengthUnit=25&lu=10').rapierLengthUnit, 25);
  assert.equal(settingsFromUrl(DEFAULT_SETTINGS, '?lu=5000').rapierLengthUnit, 1000);

  for (const bad of ['?lu=0', '?lu=-3', '?lu=abc', '?lu=']) {
    assert.equal(
      settingsFromUrl(DEFAULT_SETTINGS, bad).rapierLengthUnit,
      DEFAULT_SETTINGS.rapierLengthUnit,
      bad,
    );
  }
});

test('url settings accept only known collider layouts', () => {
  assert.equal(settingsFromUrl(DEFAULT_SETTINGS, '?cl=single').colliderLayout, 'single');
  assert.equal(settingsFromUrl(DEFAULT_SETTINGS, '?colliderLayout=split&cl=single').colliderLayout, 'split');
  assert.equal(
    settingsFromUrl(DEFAULT_SETTINGS, '?cl=triple').colliderLayout,
    DEFAULT_SETTINGS.colliderLayout,
  );
});

test('url settings accept only known particle renderers', () => {
  assert.equal(DEFAULT_SETTINGS.particleRenderer, 'sprite');
  assert.equal(settingsFromUrl(DEFAULT_SETTINGS, '?pr=graphics').particleRenderer, 'graphics');
  assert.equal(
    settingsFromUrl(DEFAULT_SETTINGS, '?particleRenderer=sprite&pr=graphics').particleRenderer,
    'sprite',
  );
  assert.equal(
    settingsFromUrl(DEFAULT_SETTINGS, '?pr=canvas').particleRenderer,
    DEFAULT_SETTINGS.particleRenderer,
  );
});

test('url debug parameters open the debug overlay', () => {
  for (const search of ['?debug=1', '?debugAudio=1', '?debugProfile=audio', '?dbg=physics']) {
    assert.equal(settingsFromUrl(DEFAULT_SETTINGS, search).debug, true, search);
  }
  assert.equal(settingsFromUrl(DEFAULT_SETTINGS, '?debug=0').debug, DEFAULT_SETTINGS.debug);
});

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

test('url fx=weave opens the Weave trial scene; nothing else turns weave on', () => {
  const trial = settingsFromUrl(DEFAULT_SETTINGS, '?fx=weave');
  assert.equal(trial.ballWeave, true);
  assert.equal(trial.ballShape, 'fish');
  assert.equal(trial.particleShape, 'circle');
  assert.equal(settingsFromUrl(DEFAULT_SETTINGS, '?fx=fish').ballWeave, false);
});

test('url fx parameter turns the PoC motion effects on for dots and ball', () => {
  const off = settingsFromUrl(DEFAULT_SETTINGS, '');
  assert.equal(off.particleFxRays || off.particleFxTrail, false);
  assert.equal(off.ballFxRays || off.ballFxTrail, false);
  assert.equal(off.particleShape, 'circle');
  assert.equal(off.ballShape, 'circle');

  const trail = settingsFromUrl(DEFAULT_SETTINGS, '?fx=trail');
  assert.equal(trail.particleFxTrail, true);
  assert.equal(trail.ballFxTrail, true);
  assert.equal(trail.particleFxRays, false);

  const all = settingsFromUrl(DEFAULT_SETTINGS, '?fx=rays,trail,star,bogus');
  assert.equal(all.particleFxRays && all.ballFxRays, true);
  assert.equal(all.particleShape, 'star');
  assert.equal(all.ballShape, 'star');

  // `sparkle`: the fixed X body. `none` was removed and is ignored.
  const sparkle = settingsFromUrl(DEFAULT_SETTINGS, '?fx=sparkle,rays');
  assert.equal(sparkle.particleShape, 'sparkle');
  assert.equal(sparkle.ballShape, 'sparkle');
  assert.equal(sparkle.particleFxRays, true);
  // Shape `Turn` is on by default.
  assert.equal(sparkle.particleShapeTurn && sparkle.ballShapeTurn, true);
  assert.equal(settingsFromUrl(DEFAULT_SETTINGS, '?fx=none').particleShape, 'circle');

  const fish = settingsFromUrl(DEFAULT_SETTINGS, '?fx=fish,shapeturn');
  assert.equal(fish.particleShape, 'fish');
  assert.equal(fish.ballShape, 'fish');
  assert.equal(fish.particleShapeTurn && fish.ballShapeTurn, true);
  assert.equal(fish.particleFxRaysTurn || fish.ballFxRaysTurn, false);
  assert.equal(off.particleFxAfterglow || off.ballFxAfterglow, false);
  const glow = settingsFromUrl(DEFAULT_SETTINGS, '?fx=afterglow');
  assert.equal(glow.particleFxAfterglow && glow.ballFxAfterglow, true);
  assert.equal(glow.particleFxTrail || glow.ballFxTrail, false);
});

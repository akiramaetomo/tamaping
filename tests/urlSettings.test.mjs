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

test('url settings accept only known overlap engines', () => {
  assert.equal(DEFAULT_SETTINGS.overlapEngine, 'js');
  assert.equal(settingsFromUrl(DEFAULT_SETTINGS, '?ov=rapier').overlapEngine, 'rapier');
  assert.equal(settingsFromUrl(DEFAULT_SETTINGS, '?ov=js').overlapEngine, 'js');
  assert.equal(settingsFromUrl(DEFAULT_SETTINGS, '?overlapEngine=rapier&ov=js').overlapEngine, 'rapier');
  assert.equal(settingsFromUrl(DEFAULT_SETTINGS, '?ov=wasm').overlapEngine, 'js');
  assert.equal(DEFAULT_SETTINGS.overlapBallContact, 'impact');
  assert.equal(settingsFromUrl(DEFAULT_SETTINGS, '?bc=sink').overlapBallContact, 'sink');
  assert.equal(settingsFromUrl(DEFAULT_SETTINGS, '?overlapBallContact=sink').overlapBallContact, 'sink');
  assert.equal(settingsFromUrl(DEFAULT_SETTINGS, '?bc=impact').overlapBallContact, 'impact');
  assert.equal(settingsFromUrl(DEFAULT_SETTINGS, '?bc=soft').overlapBallContact, 'impact');
  assert.equal(DEFAULT_SETTINGS.physicalEntryMode, 'rest');
  assert.equal(settingsFromUrl(DEFAULT_SETTINGS, '?entry=held').physicalEntryMode, 'held');
  assert.equal(settingsFromUrl(DEFAULT_SETTINGS, '?entry=spill').physicalEntryMode, 'rest');
  assert.equal(settingsFromUrl(DEFAULT_SETTINGS, '?physfps=60').physicalTargetFps, 60);
  assert.equal(settingsFromUrl(DEFAULT_SETTINGS, '?physicalTargetFps=15').physicalTargetFps, 15);
  assert.equal(settingsFromUrl(DEFAULT_SETTINGS, '?physfps=0').physicalTargetFps, 60);
  assert.equal(settingsFromUrl(DEFAULT_SETTINGS, '?physfps=fast').physicalTargetFps, 60);
});

test('url settings accept only known particle renderers', () => {
  assert.equal(DEFAULT_SETTINGS.particleRenderer, 'sprite');
  assert.equal(DEFAULT_SETTINGS.rayDrawing, 'mesh');
  assert.equal(DEFAULT_SETTINGS.canvasAntialias, false);
  assert.equal(settingsFromUrl(DEFAULT_SETTINGS, '?aa=off').canvasAntialias, false);
  assert.equal(settingsFromUrl(DEFAULT_SETTINGS, '?aa=on').canvasAntialias, true);
  assert.equal(settingsFromUrl(DEFAULT_SETTINGS, '?aa=0').canvasAntialias, false);
  assert.equal(settingsFromUrl(DEFAULT_SETTINGS, '?rays=quad').rayDrawing, 'quad');
  assert.equal(settingsFromUrl(DEFAULT_SETTINGS, '?rayDrawing=quad&rays=mesh').rayDrawing, 'quad');
  assert.equal(settingsFromUrl(DEFAULT_SETTINGS, '?rays=sprite').rayDrawing, 'mesh');
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
  // Shape `Turn` is `Motion` by default.
  assert.equal(sparkle.particleShapeTurn, 'motion');
  assert.equal(sparkle.ballShapeTurn, 'motion');
  assert.equal(settingsFromUrl(DEFAULT_SETTINGS, '?fx=none').particleShape, 'circle');

  const fish = settingsFromUrl(DEFAULT_SETTINGS, '?fx=fish,shapeturn');
  assert.equal(fish.particleShape, 'fish');
  assert.equal(fish.ballShape, 'fish');
  assert.equal(fish.particleShapeTurn, 'motion');
  assert.equal(fish.ballShapeTurn, 'motion');
  const spin = settingsFromUrl(DEFAULT_SETTINGS, '?fx=spin');
  assert.equal(spin.particleShapeTurn, 'spin');
  assert.equal(spin.ballShapeTurn, 'spin');
  assert.equal(spin.particleShape, 'circle');
  assert.equal(fish.particleFxRaysTurn || fish.ballFxRaysTurn, false);
  assert.equal(off.particleFxAfterglow || off.ballFxAfterglow, false);
  const glow = settingsFromUrl(DEFAULT_SETTINGS, '?fx=afterglow');
  assert.equal(glow.particleFxAfterglow && glow.ballFxAfterglow, true);
  assert.equal(glow.particleFxTrail || glow.ballFxTrail, false);
});

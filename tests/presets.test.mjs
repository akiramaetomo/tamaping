import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_SETTINGS } from '../.test-build/sim/settings.js';
import {
  FACTORY_PRESETS,
  PRESET_EXPORT_SCHEMA_VERSION,
  PRESET_MY_PANEL_MAX_ITEMS,
  USER_PRESET_COUNT,
  createCurrentPresetExport,
  createUserPresetExport,
  importUserPresets,
  parsePresetExport,
  presetFromSettings,
} from '../.test-build/sim/presets.js';

test('factory and user preset capacities match the curated release set', () => {
  assert.equal(FACTORY_PRESETS.length, 30);
  assert.equal(USER_PRESET_COUNT, 30);
  assert.equal(FACTORY_PRESETS[0].name, '1. Hello Ping');
  assert.equal(FACTORY_PRESETS[0].formationLabel, 'Hello Ping');
  assert.equal(FACTORY_PRESETS[0].initialFormation, 'name');
  assert.equal(FACTORY_PRESETS[1].name, '2. Blue Sand Cosmos');
  assert.equal(FACTORY_PRESETS[1].formationLabel, 'Blue SAND');
  assert.equal(FACTORY_PRESETS[1].initialFormation, 'name');
  assert.equal(FACTORY_PRESETS[2].name, '3. ラピスグラス');
  assert.equal('formationLabel' in FACTORY_PRESETS[2], false);
  assert.equal(FACTORY_PRESETS[3].name, '4. おれんじブリブリ');
  assert.equal(FACTORY_PRESETS[3].formationLabel, 'おれブリ');
  assert.equal(FACTORY_PRESETS[7].formationLabel, 'TAMAN BRIN');
  assert.equal(FACTORY_PRESETS[8].name, '9. Ball Rhythm');
  assert.equal('formationLabel' in FACTORY_PRESETS[8], false);
  assert.equal(FACTORY_PRESETS[15].name, '16. Moon 海水浴');
  assert.equal(FACTORY_PRESETS[15].formationLabel, '九十九里');
  assert.equal(FACTORY_PRESETS[17].name, '18. Chromatic Star Cosmos');
  assert.equal(FACTORY_PRESETS[17].formationLabel, 'Chroma Star');
  assert.equal(FACTORY_PRESETS[23].name, '24. Play with Yellow Python');
  assert.equal(FACTORY_PRESETS[23].initialFormation, 'flash');
  assert.equal(FACTORY_PRESETS[26].name, '✦m ネオン盆踊り');
  assert.equal(FACTORY_PRESETS[26].formationLabel, 'BON');
  assert.equal(FACTORY_PRESETS[24].name.startsWith('✦'), true);
  assert.equal(FACTORY_PRESETS[29].name.startsWith('✦'), true);
  assert.equal(FACTORY_PRESETS.some((preset) => preset.name.includes('Pink Sand Scream')), false);
  assert.equal(FACTORY_PRESETS.some((preset) => preset.name.includes('Jelly Synth')), true);
  assert.equal(FACTORY_PRESETS.every((preset) => preset.settings.audioTriggerSpreadMs === 16), true);
  assert.deepEqual(
    FACTORY_PRESETS.reduce(
      (counts, preset) => ({
        ...counts,
        [preset.initialFormation]: counts[preset.initialFormation] + 1,
      }),
      { random: 0, flash: 0, name: 0 },
    ),
    { random: 7, flash: 11, name: 12 },
  );
});

test('current preset export preserves tunable settings and excludes runtime toggles', () => {
  const exportFile = createCurrentPresetExport(
    '  ',
    {
      ...DEFAULT_SETTINGS,
      soundEnabled: false,
      debug: true,
      colliderLayout: 'split',
      particleCount: 321,
      particleRadius: 64,
      particleRimWidth: 75,
      audioTriggerSpreadMs: 16,
      particleShape: 'sparkle',
      ballShape: 'fish',
      particleShapeOpacity: 0.5,
      ballFxTrailLength: 2,
      particleFxAfterglowStrength: 1.5,
      particleShapeTurn: true,
      particleFxRays: true,
      particleFxRaysCurve: -0.5,
      ballFxRaysCurve: 0,
      particleFxAfterglow: true,
      ballFxAfterglow: true,
    },
    'audio',
    '  Show Name  ',
  );

  assert.equal(exportFile.schemaVersion, PRESET_EXPORT_SCHEMA_VERSION);
  assert.equal(exportFile.source, 'current');
  assert.equal(exportFile.presets[0].name, 'Current');
  assert.equal(exportFile.presets[0].formationLabel, 'Show Name');
  assert.equal(exportFile.presets[0].settings.pinnedGroup, 'audio');
  assert.equal(exportFile.presets[0].settings.particleCount, 321);
  assert.equal(exportFile.presets[0].settings.particleRadius, 64);
  assert.equal(exportFile.presets[0].settings.particleRimWidth, 75);
  assert.equal(exportFile.presets[0].settings.audioTriggerSpreadMs, 16);
  assert.equal('particleFillEnabled' in exportFile.presets[0].settings, false);
  assert.equal('soundEnabled' in exportFile.presets[0].settings, false);
  assert.equal('debug' in exportFile.presets[0].settings, false);
  // Shapes and motion effects are stored in presets (round 10).
  const stored = exportFile.presets[0].settings;
  assert.equal(stored.particleShape, 'sparkle');
  assert.equal(stored.ballShape, 'fish');
  assert.equal(stored.particleShapeTurn, true);
  assert.equal(stored.particleFxRays, true);
  assert.equal(stored.particleFxRaysCurve, -0.5);
  assert.equal(stored.ballFxRaysCurve, 0);
  assert.equal(stored.particleFxAfterglow && stored.ballFxAfterglow, true);
  assert.equal(stored.particleShapeOpacity, 0.5);
  assert.equal(stored.ballFxTrailLength, 2);
  assert.equal(stored.particleFxAfterglowStrength, 1.5);
  assert.equal(stored.ballShapeCurve, -0.75);
  assert.equal('colliderLayout' in exportFile.presets[0].settings, false);
});

test('preset import normalizes legacy audio fields, invalid choices, and numeric ranges', () => {
  const [preset] = parsePresetExport(JSON.stringify([
    {
      name: '  ',
      formationLabel: '  Formation Label  ',
      settings: {
        collisionMode: 'bad-mode',
        particleCount: -5,
        particleRadius: 999,
        particleRimWidth: 99,
        particleMass: -2,
        gravityStrength: 500,
        controlBallRadius: 999,
        audioFrequencyHz: 20,
        audioFrequencySpread: 3,
        audioDurationMs: 0,
        audioTriggerSpreadMs: 99,
        audioBallWaveform: 'bad-wave',
        audioParticleWaveform: 'square',
        controlBallPalette: 'pink-glow',
        particlePalette: 'orange',
        pinnedGroup: 'bad-group',
      },
    },
  ]));

  assert.equal(preset.name, 'User 1');
  assert.equal(preset.formationLabel, 'Formation Label');
  assert.equal(preset.settings.collisionMode, DEFAULT_SETTINGS.collisionMode);
  assert.equal(preset.settings.particleCount, 0);
  assert.equal(preset.settings.particleRadius, 100);
  assert.equal(preset.settings.particleRimWidth, 99);
  assert.equal('particleFillEnabled' in preset.settings, false);
  assert.equal(preset.settings.particlePalette, 'orange');
  assert.equal(preset.settings.particleMass, 0.01);
  assert.equal(preset.settings.gravityStrength, 100);
  assert.equal(preset.settings.controlBallRadius, 200);
  assert.equal(preset.settings.audioBallFrequencyHz, 30);
  assert.equal(preset.settings.audioParticleFrequencyHz, 30);
  assert.equal(preset.settings.audioBallFrequencySpread, 2);
  assert.equal(preset.settings.audioParticleFrequencySpread, 2);
  assert.equal(preset.settings.audioBallDurationMs, 1);
  assert.equal(preset.settings.audioParticleDurationMs, 1);
  assert.equal(preset.settings.audioTriggerSpreadMs, DEFAULT_SETTINGS.audioTriggerSpreadMs);
  assert.equal(preset.settings.audioBallWaveform, DEFAULT_SETTINGS.audioBallWaveform);
  assert.equal(preset.settings.audioParticleWaveform, 'square');
  assert.equal(preset.settings.controlBallPalette, 'pink');
  assert.equal(preset.settings.pinnedGroup, null);
});

test('preset import maps removed or unknown shapes to Circle and clamps effect values', () => {
  const [preset] = parsePresetExport(JSON.stringify([
    {
      name: 'Old look',
      settings: {
        particleShape: 'none',
        ballShape: 'heart',
        particleShapeOpacity: 9,
        ballShapeOpacity: -1,
        particleShapeCurve: -3,
        particleFxRaysCurve: 'bent',
        particleFxTrailOpacity: 10,
        particleFxTrailLength: 0,
        ballFxAfterglowStrength: 5,
        ballFxAfterglowLength: 0.01,
        ballFxRays: 'yes',
      },
    },
  ]));
  const settings = preset.settings;
  assert.equal(settings.particleShape, 'circle');
  assert.equal(settings.ballShape, 'circle');
  assert.equal(settings.particleShapeOpacity, 1.35);
  assert.equal(settings.ballShapeOpacity, 0);
  assert.equal(settings.particleShapeCurve, -1);
  assert.equal(settings.particleFxRaysCurve, -0.75);
  assert.equal(settings.particleFxTrailOpacity, 3);
  assert.equal(settings.particleFxTrailLength, 0.25);
  assert.equal(settings.ballFxAfterglowStrength, 2);
  assert.equal(settings.ballFxAfterglowLength, 0.25);
  assert.equal(settings.ballFxRays, false);
});

test('presets without shape and effect keys apply the defaults', () => {
  const [preset] = parsePresetExport(JSON.stringify([
    { name: 'Before round 10', settings: { particleCount: 42 } },
  ]));
  for (const key of [
    'particleShape', 'ballShape', 'particleShapeTurn', 'particleShapeOpacity', 'ballShapeCurve',
    'particleFxRays', 'ballFxRaysCurve', 'particleFxTrail', 'ballFxTrailOpacity',
    'particleFxAfterglow', 'ballFxAfterglowLength',
  ]) {
    assert.equal(preset.settings[key], DEFAULT_SETTINGS[key], key);
  }
  // Factory presets carry the defaults too, so switching presets resets the look.
  for (const factory of FACTORY_PRESETS) {
    assert.equal(factory.settings.particleShape, 'circle', factory.name);
    assert.equal(factory.settings.ballFxAfterglow, false, factory.name);
  }
});

test('preset import accepts My Panel as a pinned group', () => {
  const [preset] = parsePresetExport(JSON.stringify([
    { name: 'Pins My Panel', settings: { pinnedGroup: 'my' } },
  ]));

  assert.equal(preset.settings.pinnedGroup, 'my');
});

test('a preset without My Panel rows stays without them', () => {
  assert.equal('myPanelItems' in presetFromSettings(DEFAULT_SETTINGS, 'my'), false);
  for (const factory of FACTORY_PRESETS) {
    assert.equal('myPanelItems' in factory.settings, false, factory.name);
  }

  const [noKey, notAList] = parsePresetExport(JSON.stringify([
    { name: 'No rows', settings: {} },
    { name: 'Bad rows', settings: { myPanelItems: 'mode.flash' } },
  ]));
  assert.equal('myPanelItems' in noKey.settings, false);
  assert.equal('myPanelItems' in notAList.settings, false);
});

test('preset My Panel rows keep their order, without bad entries or rows past the cap', () => {
  const tooMany = Array.from({ length: 12 }, (_, index) => `row.${index}`);
  const [cleaned, empty, full] = parsePresetExport(JSON.stringify([
    { name: 'Cleaned', settings: { myPanelItems: ['b', 7, 'a', 'b', null] } },
    { name: 'Empty', settings: { myPanelItems: [] } },
    { name: 'Full', settings: { myPanelItems: tooMany } },
  ]));

  assert.deepEqual(cleaned.settings.myPanelItems, ['b', 'a']);
  // An empty list is an empty panel, not a preset without rows.
  assert.deepEqual(empty.settings.myPanelItems, []);
  assert.deepEqual(full.settings.myPanelItems, tooMany.slice(0, PRESET_MY_PANEL_MAX_ITEMS));
});

test('preset My Panel rows survive an export and import', () => {
  const rows = ['mode.flash', 'audio.sound'];
  const file = createCurrentPresetExport('Work', DEFAULT_SETTINGS, 'my', null, null, rows);
  const [read] = parsePresetExport(JSON.stringify(file));

  assert.equal(file.schemaVersion, 12);
  assert.deepEqual(read.settings.myPanelItems, rows);

  const { presets } = importUserPresets(Array(USER_PRESET_COUNT).fill(null), [read], null);
  assert.deepEqual(presets[0].settings.myPanelItems, rows);
  assert.deepEqual(parsePresetExport(JSON.stringify(createUserPresetExport(presets)))[0].settings.myPanelItems, rows);
});

test('preset import fills missing particle rim width as pseudo-fill for legacy presets', () => {
  const [preset] = parsePresetExport(JSON.stringify([
    {
      name: 'Legacy filled particles',
      settings: {
        particlePalette: 'blue',
        particleRadius: 8,
        particleFillEnabled: true,
        audioTriggerSpreadMs: 16,
      },
    },
  ]));

  assert.equal(preset.settings.particleRimWidth, 100);
  assert.equal(preset.settings.audioTriggerSpreadMs, 16);
  assert.equal('particleFillEnabled' in preset.settings, false);
});

test('user preset import fills empty slots before using the overwrite range', () => {
  const basePreset = {
    name: 'Existing',
    settings: presetFromSettings(DEFAULT_SETTINGS),
  };
  const incoming = [
    { name: 'First Incoming', settings: presetFromSettings({ ...DEFAULT_SETTINGS, particleCount: 101 }) },
    { name: 'Second Incoming', settings: presetFromSettings({ ...DEFAULT_SETTINGS, particleCount: 202 }) },
  ];
  const current = Array.from({ length: USER_PRESET_COUNT }, () => null);
  current[0] = basePreset;
  current[2] = basePreset;

  const result = importUserPresets(current, incoming, 10);

  assert.equal(result.imported, 2);
  assert.equal(result.presets[0]?.name, 'Existing');
  assert.equal(result.presets[1]?.name, 'First Incoming');
  assert.equal(result.presets[1]?.settings.particleCount, 101);
  assert.equal(result.presets[2]?.name, 'Existing');
  assert.equal(result.presets[3]?.name, 'Second Incoming');
  assert.equal(result.presets[3]?.settings.particleCount, 202);
  assert.equal(result.presets[10], null);
});

test('user preset import stops at the end of the overwrite range when no slots are empty', () => {
  const full = Array.from({ length: USER_PRESET_COUNT }, (_, index) => ({
    name: `Existing ${index + 1}`,
    settings: presetFromSettings(DEFAULT_SETTINGS),
  }));
  const incoming = [
    { name: 'Overwrite A', settings: presetFromSettings(DEFAULT_SETTINGS) },
    { name: 'Overwrite B', settings: presetFromSettings(DEFAULT_SETTINGS) },
    { name: 'Overwrite C', settings: presetFromSettings(DEFAULT_SETTINGS) },
  ];

  const result = importUserPresets(full, incoming, USER_PRESET_COUNT - 2);

  assert.equal(result.imported, 2);
  assert.equal(result.presets[USER_PRESET_COUNT - 2]?.name, 'Overwrite A');
  assert.equal(result.presets[USER_PRESET_COUNT - 1]?.name, 'Overwrite B');
});

test('presets keep a valid design viewport and drop invalid ones', () => {
  const exportFile = createCurrentPresetExport(
    'PC tuned',
    DEFAULT_SETTINGS,
    null,
    null,
    { width: 1299.6, height: 700.4 },
  );
  assert.equal(exportFile.schemaVersion, 12);
  assert.deepEqual(exportFile.presets[0].designViewport, { width: 1300, height: 700 });
  assert.equal('designViewport' in exportFile.presets[0].settings, false);

  const [kept, dropped, legacy] = parsePresetExport(JSON.stringify([
    exportFile.presets[0],
    { ...exportFile.presets[0], designViewport: { width: 'bad' } },
    { name: 'v8', settings: presetFromSettings(DEFAULT_SETTINGS) },
  ]));
  assert.deepEqual(kept.designViewport, { width: 1300, height: 700 });
  assert.equal('designViewport' in dropped, false);
  assert.equal('designViewport' in legacy, false);

  const { presets } = importUserPresets(Array(USER_PRESET_COUNT).fill(null), [kept, legacy], null);
  assert.deepEqual(presets[0].designViewport, { width: 1300, height: 700 });
  assert.equal('designViewport' in presets[1], false);
});

test('legacy shared audio fields fill both voices unless per-voice values exist', () => {
  const [shared, mixed] = parsePresetExport(JSON.stringify([
    {
      name: 'Shared audio',
      settings: { audioFrequencyHz: 880, audioFrequencySpread: 1.25, audioDurationMs: 120 },
    },
    {
      name: 'Mixed audio',
      settings: {
        audioFrequencyHz: 880,
        audioDurationMs: 120,
        audioParticleFrequencyHz: 2200,
        audioBallDurationMs: 40,
      },
    },
  ]));

  assert.equal(shared.settings.audioBallFrequencyHz, 880);
  assert.equal(shared.settings.audioParticleFrequencyHz, 880);
  assert.equal(shared.settings.audioBallFrequencySpread, 1.25);
  assert.equal(shared.settings.audioParticleFrequencySpread, 1.25);
  assert.equal(shared.settings.audioBallDurationMs, 120);
  assert.equal(shared.settings.audioParticleDurationMs, 120);
  assert.equal('audioFrequencyHz' in shared.settings, false);

  assert.equal(mixed.settings.audioBallFrequencyHz, 880);
  assert.equal(mixed.settings.audioParticleFrequencyHz, 2200);
  assert.equal(mixed.settings.audioBallDurationMs, 40);
  assert.equal(mixed.settings.audioParticleDurationMs, 120);
});

test('preset import keeps a missing pinned group distinct from an explicit unpin', () => {
  const [missing, unpinned] = parsePresetExport(JSON.stringify([
    { name: 'Old', settings: { particleCount: 100 } },
    { name: 'Unpinned', settings: { particleCount: 100, pinnedGroup: null } },
  ]));

  // A missing field leaves the current pin alone when the preset is applied.
  assert.equal('pinnedGroup' in missing.settings, false);
  assert.equal(unpinned.settings.pinnedGroup, null);
});

test('current preset export round-trips through import unchanged', () => {
  const tuned = {
    ...DEFAULT_SETTINGS,
    collisionMode: 'collision-physical',
    particleCount: 520,
    particleRadius: 12,
    gravityMode: 'antigravity',
    audioParticleWaveform: 'square',
    audioTriggerSpreadMs: 16,
  };
  const exportFile = createCurrentPresetExport('Round trip', tuned, 'my', 'RT', { width: 1280, height: 720 });
  const [imported] = parsePresetExport(JSON.stringify(exportFile));

  assert.deepEqual(imported, exportFile.presets[0]);
  assert.deepEqual(imported.settings, presetFromSettings(tuned, 'my'));
});

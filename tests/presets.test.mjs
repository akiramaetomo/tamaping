import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_SETTINGS } from '../.test-build/sim/settings.js';
import {
  FACTORY_PRESETS,
  PRESET_EXPORT_SCHEMA_VERSION,
  USER_PRESET_COUNT,
  createCurrentPresetExport,
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
      colliderLayout: 'single',
      particleCount: 321,
      particleRadius: 64,
      particleRimWidth: 75,
      audioTriggerSpreadMs: 16,
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

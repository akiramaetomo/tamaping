import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_SETTINGS } from '../.test-build/sim/settings.js';
import {
  FACTORY_PRESETS,
  FACTORY_PRESET_COUNT,
  PRESET_EXPORT_SCHEMA_VERSION,
  PRESET_MY_PANEL_MAX_ITEMS,
  USER_PRESET_COUNT,
  createCurrentPresetExport,
  createUserPresetExport,
  normalizePresetSettings,
  normalizeUserPreset,
  parsePresetExport,
  presetFromSettings,
  STARTER_USER_PRESETS,
} from '../.test-build/sim/presets.js';
import { FACTORY_PRESET_DEFINITION_DATA } from '../.test-build/sim/factoryPresetData.js';
import { FACTORY_PRESET_GENRES, FACTORY_PRESET_GENRE_FALLBACK } from '../.test-build/sim/factoryPresetGenres.js';
import { DEFAULT_PRESET_START } from '../.test-build/sim/presetStart.js';
import { applyPresetImport, planPresetImport } from '../.test-build/sim/presetImport.js';

function importInto(current, incoming) {
  const plan = planPresetImport(current, incoming);
  return applyPresetImport(current, plan, []);
}

test('factory list is ordered by genre, numbered by its order', () => {
  assert.equal(FACTORY_PRESETS.length, FACTORY_PRESET_DEFINITION_DATA.length);
  assert.equal(FACTORY_PRESET_COUNT, 43);
  assert.equal(USER_PRESET_COUNT, 60);
  // Spec `Proposed Factory Preset Genres (2026-11-22)`: the genres in order,
  // each preset in exactly one, and the list in the same order, so the numbers
  // run from top to bottom of the drop-down.
  assert.deepEqual(
    FACTORY_PRESET_GENRES.map((genre) => `${genre.label}:${genre.presets.length}`),
    ['Basics:5', 'Watch:7', 'Synth:4', 'Instruments:4', 'Toys:8', 'Creatures:8', 'Art:1', 'AI-made:6'],
  );
  assert.deepEqual(
    FACTORY_PRESETS.map((preset) => preset.name.replace(/^\d+\. /, '')),
    FACTORY_PRESET_GENRES.flatMap((genre) => genre.presets),
  );
  assert.deepEqual(
    FACTORY_PRESETS.map((preset) => preset.genre),
    FACTORY_PRESET_GENRES.flatMap((genre) => genre.presets.map(() => genre.label)),
  );
  assert.equal(FACTORY_PRESETS.some((preset) => preset.genre === FACTORY_PRESET_GENRE_FALLBACK), false);
  assert.equal(FACTORY_PRESETS[0].name, '1. Hello Ping');
  assert.equal(FACTORY_PRESETS[0].formationLabel, 'Hello');
  assert.equal(FACTORY_PRESETS[2].name, '3. Hello Tama');
  assert.deepEqual(FACTORY_PRESETS[2].designViewport, { width: 537, height: 537 });
  assert.equal(FACTORY_PRESETS[7].formationLabel, 'Glow Sparkle');
  // Deleted on 2026-11-22 (user decision).
  for (const gone of ['🤖 Light Painting', '🤖 Melting Word', '🤖 Pond Scatter', '🤖 Dust Planet']) {
    assert.equal(FACTORY_PRESET_DEFINITION_DATA.some((entry) => entry.name === gone), false, gone);
  }
  // The agent presets close the list. The agent's mark is in the name only:
  // the Name formation draws the label.
  FACTORY_PRESETS.forEach((preset, index) => {
    assert.equal(preset.name.includes('🤖'), index >= 37, preset.name);
    assert.equal(preset.formationLabel?.includes('🤖') ?? false, false, preset.name);
    assert.ok(preset.name.length <= 40, preset.name);
  });
  FACTORY_PRESETS.forEach((preset, index) => {
    assert.equal(preset.id, `factory-${index + 1}`);
    // One number only: the source prefixes (`5. `, `✦29 `) are gone.
    assert.match(preset.name, new RegExp(`^${index + 1}\. [^\d✦]`), preset.name);
    assert.equal('audioTriggerSpreadMs' in preset.settings, false, preset.name);
    assert.notEqual(preset.start.ballY, 68, preset.name);
  });
  // A row without a start takes the default start (Gyu-Pang☆).
  assert.deepEqual(FACTORY_PRESETS[22].start, DEFAULT_PRESET_START);
});

test('every factory entry is its source preset after normalization', () => {
  FACTORY_PRESET_DEFINITION_DATA.forEach((entry, index) => {
    const factory = FACTORY_PRESETS[index];
    const source = normalizeUserPreset(entry, index);
    assert.equal(factory.name, `${index + 1}. ${source.name}`);
    assert.equal(factory.formationLabel, source.formationLabel);
    assert.deepEqual(factory.designViewport, source.designViewport);
    assert.deepEqual(factory.start, source.start ?? DEFAULT_PRESET_START);
    assert.deepEqual(
      normalizePresetSettings(factory.settings),
      source.settings,
      factory.name,
    );
  });
});

test('starter user presets are the 11 B rows in the user preset shape', () => {
  assert.equal(STARTER_USER_PRESETS.length, 11);
  assert.deepEqual(
    STARTER_USER_PRESETS.map((preset) => preset.name),
    [
      'Ball Rhythm',
      'Chromatic Star Cosmos',
      'Snake Pulse',
      '桃色ワープゼリー',
      'Filled Red, Blue, White',
      'Honeybee Fish',
      'Unlinked Fish',
      'Blue Black Hole',
      'Snake Rhythm',
      'Cyber Fish',
      'Playing with Synchronized Fish',
    ],
  );
  for (const preset of STARTER_USER_PRESETS) {
    assert.deepEqual(normalizeUserPreset(preset), preset, preset.name);
    assert.equal('audioTriggerSpreadMs' in preset.settings, false, preset.name);
    assert.notEqual(preset.start?.ballY, 68, preset.name);
  }
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
      particleShapeTurn: 'spin',
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
  // Sound timing is not part of a preset any more (no effect since 2026-10-27).
  assert.equal('audioTriggerSpreadMs' in exportFile.presets[0].settings, false);
  assert.equal('particleFillEnabled' in exportFile.presets[0].settings, false);
  assert.equal('soundEnabled' in exportFile.presets[0].settings, false);
  assert.equal('debug' in exportFile.presets[0].settings, false);
  // Shapes and motion effects are stored in presets (round 10).
  const stored = exportFile.presets[0].settings;
  assert.equal(stored.particleShape, 'sparkle');
  assert.equal(stored.ballShape, 'fish');
  assert.equal(stored.particleShapeTurn, 'spin');
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
  assert.equal('audioTriggerSpreadMs' in preset.settings, false);
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
  // Factory presets carry every shape and effect key, so switching presets
  // always sets the look.
  for (const factory of FACTORY_PRESETS) {
    for (const key of ['particleShape', 'ballShape', 'ballFxAfterglow', 'particleFxTrail']) {
      assert.equal(typeof factory.settings[key], typeof DEFAULT_SETTINGS[key], `${factory.name} ${key}`);
    }
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
  FACTORY_PRESET_DEFINITION_DATA.forEach((entry, index) => {
    assert.equal(
      'myPanelItems' in FACTORY_PRESETS[index].settings,
      'myPanelItems' in entry.settings,
      entry.name,
    );
  });

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

  assert.equal(file.schemaVersion, PRESET_EXPORT_SCHEMA_VERSION);
  assert.deepEqual(read.settings.myPanelItems, rows);

  const { presets } = importInto(Array(USER_PRESET_COUNT).fill(null), [read]);
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
  assert.equal('audioTriggerSpreadMs' in preset.settings, false);
  assert.equal('particleFillEnabled' in preset.settings, false);
});

test('user preset import fills empty slots in file order', () => {
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

  const result = importInto(current, incoming);

  assert.equal(result.added, 2);
  assert.equal(result.presets[0]?.name, 'Existing');
  assert.equal(result.presets[1]?.name, 'First Incoming');
  assert.equal(result.presets[1]?.settings.particleCount, 101);
  assert.equal(result.presets[2]?.name, 'Existing');
  assert.equal(result.presets[3]?.name, 'Second Incoming');
  assert.equal(result.presets[3]?.settings.particleCount, 202);
  assert.equal(result.presets[4], null);
});

test('presets keep a valid design viewport and drop invalid ones', () => {
  const exportFile = createCurrentPresetExport(
    'PC tuned',
    DEFAULT_SETTINGS,
    null,
    null,
    { width: 1299.6, height: 700.4 },
  );
  assert.equal(exportFile.schemaVersion, PRESET_EXPORT_SCHEMA_VERSION);
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

  const { presets } = importInto(Array(USER_PRESET_COUNT).fill(null), [kept, legacy]);
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

test('shape Turn reads the old boolean and the three choices', async () => {
  const { shapeTurnValue } = await import('../.test-build/sim/presets.js');
  assert.equal(shapeTurnValue(true, 'off'), 'motion');
  assert.equal(shapeTurnValue(false, 'motion'), 'off');
  for (const value of ['off', 'motion', 'spin']) {
    assert.equal(shapeTurnValue(value, 'off'), value);
  }
  assert.equal(shapeTurnValue('wobble', 'motion'), 'motion');
  assert.equal(shapeTurnValue(undefined, 'spin'), 'spin');
});

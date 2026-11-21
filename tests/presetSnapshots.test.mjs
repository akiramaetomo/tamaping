import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_SETTINGS } from '../.test-build/sim/settings.js';
import {
  PRESET_EXPORT_SCHEMA_VERSION,
  PRESET_SNAPSHOT_COUNT,
  USER_PRESET_COUNT,
  createAutosaveExport,
  createCurrentPresetExport,
  emptySnapshotSlots,
  normalizePresetSettings,
  parsePresetExport,
  parsePresetImportFile,
  presetFromSettings,
  presetSnapshotFromSettings,
  presetSnapshotsEqual,
  FACTORY_PRESETS,
} from '../.test-build/sim/presets.js';
import { presetEditOutcome } from '../.test-build/app/presetValues.js';
import { parseWorkingState } from '../.test-build/app/workingState.js';
import { applyPresetImport, planPresetImport } from '../.test-build/sim/presetImport.js';

// Spec: `Snap Panel`.

const SLOW = { ...DEFAULT_SETTINGS, particleCount: 300, gravityStrength: 2 };
const FAST = { ...DEFAULT_SETTINGS, particleCount: 1200, controlBallRadius: 60 };

function slots(...values) {
  const list = emptySnapshotSlots();
  values.forEach((value, index) => {
    list[index] = value ? presetSnapshotFromSettings(value) : null;
  });
  return list;
}

test('four slots, a schema newer than the 0.2.9 files', () => {
  assert.equal(PRESET_SNAPSHOT_COUNT, 4);
  assert.equal(emptySnapshotSlots().length, 4);
  assert.equal(PRESET_EXPORT_SCHEMA_VERSION, 15);
});

test('a snapshot holds the preset values without pin, rows or snapshots', () => {
  const snapshot = presetSnapshotFromSettings(SLOW);
  assert.equal(snapshot.particleCount, 300);
  assert.equal(snapshot.gravityStrength, 2);
  assert.equal('pinnedGroup' in snapshot, false);
  assert.equal('myPanelItems' in snapshot, false);
  assert.equal('snapshots' in snapshot, false);
  // Settings a preset does not store stay out as well.
  assert.equal('soundEnabled' in snapshot, false);
});

test('a preset with only empty slots stores no snapshots and equals one without', () => {
  const none = presetFromSettings(DEFAULT_SETTINGS, null);
  const empty = presetFromSettings(DEFAULT_SETTINGS, null, undefined, emptySnapshotSlots());
  assert.equal('snapshots' in empty, false);
  assert.equal(presetEditOutcome(empty, none, 'user:0'), 'applied');
});

test('recording a slot marks the applied preset Modified; the same slots do not', () => {
  const applied = presetFromSettings(DEFAULT_SETTINGS, null, undefined, slots(SLOW));
  const same = presetFromSettings(DEFAULT_SETTINGS, null, undefined, slots(SLOW));
  const recorded = presetFromSettings(DEFAULT_SETTINGS, null, undefined, slots(SLOW, FAST));
  assert.equal(presetEditOutcome(same, applied, 'user:0'), 'applied');
  assert.equal(presetEditOutcome(recorded, applied, 'user:0'), 'modified');
});

test('the lit slot is the one equal to the current values', () => {
  const list = slots(SLOW, null, FAST);
  const current = presetSnapshotFromSettings(FAST);
  assert.deepEqual(list.map((slot) => presetSnapshotsEqual(slot, current)), [false, false, true, false]);
  // An empty slot is never lit.
  assert.equal(presetSnapshotsEqual(null, null), false);
});

test('snapshots survive Export current and import, slot by slot', () => {
  const file = createCurrentPresetExport('Work', DEFAULT_SETTINGS, 'my', null, null, ['mode.flash'], null, slots(null, SLOW, null, FAST));
  const [read] = parsePresetExport(JSON.stringify(file));
  assert.equal(file.schemaVersion, PRESET_EXPORT_SCHEMA_VERSION);
  assert.equal(read.settings.snapshots.length, 4);
  assert.equal(read.settings.snapshots[0], null);
  assert.equal(read.settings.snapshots[2], null);
  assert.ok(presetSnapshotsEqual(read.settings.snapshots[1], presetSnapshotFromSettings(SLOW)));
  assert.ok(presetSnapshotsEqual(read.settings.snapshots[3], presetSnapshotFromSettings(FAST)));
  // Rows are not touched by the snapshots.
  assert.deepEqual(read.settings.myPanelItems, ['mode.flash']);

  const plan = planPresetImport(Array(USER_PRESET_COUNT).fill(null), [read]);
  const { presets } = applyPresetImport(Array(USER_PRESET_COUNT).fill(null), plan, []);
  assert.deepEqual(presets[0].settings.snapshots, read.settings.snapshots);
});

test('the work in progress keeps its snapshots in backups and through a reload', () => {
  const working = presetFromSettings(DEFAULT_SETTINGS, null, undefined, slots(FAST));
  const backup = createAutosaveExport([], working, null, null, null);
  const { working: readBack } = parsePresetImportFile(JSON.stringify(backup));
  assert.ok(presetSnapshotsEqual(readBack.settings.snapshots[0], presetSnapshotFromSettings(FAST)));

  const restored = parseWorkingState(JSON.stringify({ settings: working, presetValue: 'custom', snapshot: null }));
  assert.ok(presetSnapshotsEqual(restored.settings.snapshots[0], presetSnapshotFromSettings(FAST)));
});

test('read slots are cleaned: bad entries empty, extra slots dropped, values checked', () => {
  const read = normalizePresetSettings({
    snapshots: [
      'not a slot',
      { particleCount: 99999, gravityMode: 'sideways', pinnedGroup: 'my', myPanelItems: ['x'], snapshots: [{}] },
      null,
      [1, 2],
      { particleCount: 50 },
    ],
  });
  assert.equal(read.snapshots.length, 4);
  assert.equal(read.snapshots[0], null);
  assert.equal(read.snapshots[2], null);
  assert.equal(read.snapshots[3], null);
  const slot = read.snapshots[1];
  assert.equal(slot.particleCount, 10000);
  assert.equal(slot.gravityMode, DEFAULT_SETTINGS.gravityMode);
  assert.equal('pinnedGroup' in slot, false);
  assert.equal('myPanelItems' in slot, false);
  assert.equal('snapshots' in slot, false);
});

test('a read slot keeps the key order of a recorded one', () => {
  // Written in another order, as a hand-edited file might be.
  const recorded = presetSnapshotFromSettings(SLOW);
  const reversed = Object.fromEntries(Object.entries(recorded).reverse());
  const read = normalizePresetSettings({ snapshots: [reversed] });
  assert.equal(JSON.stringify(read.snapshots[0]), JSON.stringify(recorded));
});

test('files without snapshots, or with only bad ones, read as no snapshots', () => {
  const [old, bad, empty] = parsePresetExport(JSON.stringify({
    kind: 'dotping-presets',
    schemaVersion: 14,
    presets: [
      { name: 'Old', settings: {} },
      { name: 'Bad', settings: { snapshots: 'slot' } },
      { name: 'Empty', settings: { snapshots: [null, null] } },
    ],
  }));
  assert.equal('snapshots' in old.settings, false);
  assert.equal('snapshots' in bad.settings, false);
  assert.equal('snapshots' in empty.settings, false);
});

test('the Snap pin is preset data: stored only when on, kept through files, part of Modified', () => {
  const off = presetFromSettings(DEFAULT_SETTINGS, 'mode', undefined, slots(SLOW));
  const on = presetFromSettings(DEFAULT_SETTINGS, 'mode', undefined, slots(SLOW), true);
  assert.equal('snapPinned' in off, false);
  assert.equal(on.snapPinned, true);
  // Its own pin: the other pin stays as it is.
  assert.equal(on.pinnedGroup, 'mode');
  assert.equal(presetEditOutcome(on, off, 'user:0'), 'modified');

  const file = createCurrentPresetExport('Work', DEFAULT_SETTINGS, null, null, null, undefined, null, slots(SLOW), true);
  const [read] = parsePresetExport(JSON.stringify(file));
  assert.equal(read.settings.snapPinned, true);

  const restored = parseWorkingState(JSON.stringify({ settings: on, presetValue: 'custom', snapshot: null }));
  assert.equal(restored.settings.snapPinned, true);

  const [bad] = parsePresetExport(JSON.stringify([{ name: 'Bad', settings: { snapPinned: 'yes' } }]));
  assert.equal('snapPinned' in bad.settings, false);
});

test('a snapshot never carries the Snap pin', () => {
  assert.equal('snapPinned' in presetSnapshotFromSettings(DEFAULT_SETTINGS), false);
  const read = normalizePresetSettings({ snapshots: [{ snapPinned: true }] });
  assert.equal('snapPinned' in read.snapshots[0], false);
});

// Spec: `Proposed Preset Sets (2026-11-21)`. Factory sets are found by name, so
// a later merge that renumbers the list does not move these checks.
const factoryNamed = (name) => FACTORY_PRESETS.find((preset) => preset.name.replace(/^\d+\. /, '') === name);

function checkSet(hostName, goneName, expectedDiffs, pinnedGroup) {
  const host = factoryNamed(hostName);
  assert.ok(host, hostName);
  const own = presetSnapshotFromSettings({ ...DEFAULT_SETTINGS, ...host.settings });
  const [first, second, third, fourth] = host.settings.snapshots;
  // Slot 1 equals the applied values, so it is lit right after applying.
  assert.ok(presetSnapshotsEqual(first, own), hostName);
  assert.equal(third, null);
  assert.equal(fourth, null);
  const differs = Object.keys(first).filter((key) => JSON.stringify(first[key]) !== JSON.stringify(second[key]));
  assert.deepEqual(differs.sort(), [...expectedDiffs].sort(), hostName);
  assert.equal(host.settings.snapPinned, true);
  assert.equal(host.settings.pinnedGroup, pinnedGroup);
  // The other member left the list; it lives on as slot 2.
  assert.equal(factoryNamed(goneName), undefined, goneName);
  return { host, second };
}

test('Linked Fish is a preset set: slot 1 day (itself), slot 2 night', () => {
  const { second: night } = checkSet('Linked Fish', 'Playing with Fish at Night', [
    'ballShapeOpacity', 'collisionMode', 'controlBallRadius', 'dotCombiMode', 'particlePalette',
  ], 'my');
  assert.equal(night.collisionMode, 'collision-physical');
  assert.equal(night.dotCombiMode, 'off');
  assert.equal(night.particlePalette, 'blue');
});

test('宇宙波 is a preset set: slot 1 waves in space (itself), slot 2 the sea at night', () => {
  const { host, second: sea } = checkSet('宇宙波', 'Moon 海水浴', [
    'gravityStrength', 'contactRestitution', 'particleFriction', 'controlBallPalette',
    'controlBallRimEnabled', 'controlBallRadius', 'controlBallMass', 'controlBallFriction',
    'wallRestitution', 'audioBallWaveform', 'audioBallFrequencyHz', 'audioBallDurationMs',
    'audioParticleFrequencyHz', 'audioParticleFrequencySpread', 'audioParticleDurationMs',
    'particleShape', 'particleFxRays', 'particleFxAfterglowStrength', 'particleFxAfterglowLength',
  ], 'audio');
  // The moon: a small yellow Ball, plain dots, low long sound.
  assert.equal(sea.controlBallPalette, 'yellow');
  assert.equal(sea.particleShape, 'circle');
  assert.ok(sea.audioParticleDurationMs > 600);
  // The user's tuning of 2026-11-22: finer dust in both slots, a soft afterglow
  // on the sea, and My Panel rows from the export.
  assert.equal(host.settings.particleCount, 2000);
  assert.equal(sea.particleCount, 2000);
  assert.equal(sea.particleRadius, 2);
  assert.equal(sea.particleFxAfterglow, true);
  assert.equal(host.settings.myPanelItems.length, 6);
});

test('Pink Sand Scratch is a preset set: slot 2 the former Pink Junk, fewer and bigger dots', () => {
  const { host, second: junk } = checkSet('Pink Sand Scratch', 'Pink Junk', [
    'gravityStrength', 'particleCount', 'particleRadius', 'controlBallPalette',
    'controlBallRimEnabled', 'audioBallFrequencyHz', 'audioBallFrequencySpread',
    'audioBallDurationMs', 'audioParticleFrequencyHz', 'audioParticleDurationMs', 'particleShape',
  ], 'audio');
  // A switch changes Count: 2000 small stars, then 500 big round dots.
  assert.equal(host.settings.particleCount, 2000);
  assert.equal(junk.particleCount, 500);
  assert.equal(junk.particleRadius, 8);
  // The host keeps its own My Panel rows (user decision 2026-11-22).
  assert.equal(host.settings.myPanelItems.length, 5);
});

test('Red Typhoon is a set of its own: three slots that differ only in gravity strength', () => {
  const host = factoryNamed('Red Typhoon');
  assert.ok(host);
  const own = presetSnapshotFromSettings({ ...DEFAULT_SETTINGS, ...host.settings });
  const [first, second, third, fourth] = host.settings.snapshots;
  // Slot 1 equals the applied values, so it is lit right after applying.
  assert.ok(presetSnapshotsEqual(first, own));
  assert.equal(fourth, null);
  for (const slot of [second, third]) {
    const differs = Object.keys(first).filter((key) => JSON.stringify(first[key]) !== JSON.stringify(slot[key]));
    assert.deepEqual(differs, ['gravityStrength']);
  }
  // The user's tuning of 2026-11-22: strong, then almost none, then weak gravity,
  // on 2000 dots of size 2 in every slot (so a switch never rebuilds the world).
  assert.ok(first.gravityStrength > third.gravityStrength);
  assert.ok(third.gravityStrength > second.gravityStrength);
  assert.equal(first.particleCount, 2000);
  assert.equal(first.particleRadius, 2);
  assert.equal(host.settings.snapPinned, true);
  assert.equal(host.settings.pinnedGroup, 'my');
  assert.equal(host.settings.myPanelItems.length, 4);
});

test('sets are made one by one, by intent: only the agreed presets have slots', () => {
  const withSlots = FACTORY_PRESETS.filter((preset) => preset.settings.snapshots)
    .map((preset) => preset.name.replace(/^\d+\. /, ''));
  assert.deepEqual(withSlots, ['Red Typhoon', 'Pink Sand Scratch', '宇宙波', 'Linked Fish', '🤖 Lone Comet']);
});

test('Lone Comet is a set: slot 1 the agent\'s comet alone, slot 2 the user\'s mod with sparkles', () => {
  const host = factoryNamed('🤖 Lone Comet');
  assert.ok(host);
  const own = presetSnapshotFromSettings({ ...DEFAULT_SETTINGS, ...host.settings });
  const [first, mod, third, fourth] = host.settings.snapshots;
  assert.ok(presetSnapshotsEqual(first, own));
  assert.equal(third, null);
  assert.equal(fourth, null);
  // Slot 1: one comet Ball, no particles.
  assert.equal(first.particleCount, 0);
  // Slot 2 (user, 2026-11-22): 30 yellow sparkles that pass through each other,
  // with rays and afterglow, and a sparkle Ball.
  assert.equal(mod.particleCount, 30);
  assert.equal(mod.collisionMode, 'independence-overlapping');
  assert.equal(mod.particlePalette, 'yellow');
  assert.equal(mod.particleShape, 'sparkle');
  assert.equal(mod.particleFxRays, true);
  assert.equal(mod.particleFxAfterglow, true);
  assert.equal(mod.ballShape, 'sparkle');
  assert.equal(host.settings.snapPinned, true);
  // The host keeps its own start and rows.
  assert.equal(host.start.ballSpeed, 700);
  assert.equal(host.settings.myPanelItems.length, 3);
});

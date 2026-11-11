import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_SETTINGS } from '../.test-build/sim/settings.js';
import {
  AUTOSAVE_WORKING_PRESET_NAME,
  LEGACY_USER_PRESET_STORAGE_KEY,
  PRESET_NAME_MAX_LENGTH,
  USER_PRESET_COUNT,
  USER_PRESET_STORAGE_KEY,
  createAutosaveExport,
  createUserPresetExport,
  loadUserPresets,
  parsePresetImportFile,
  presetFromSettings,
} from '../.test-build/sim/presets.js';
import {
  applyPresetImport,
  defaultImportChoices,
  planPresetImport,
  presetIdentityKey,
  uniquePresetName,
} from '../.test-build/sim/presetImport.js';

function preset(name, particleCount = 300, extra = {}) {
  return {
    name,
    settings: presetFromSettings({ ...DEFAULT_SETTINGS, particleCount }),
    ...extra,
  };
}

function slots(...presets) {
  const list = Array.from({ length: USER_PRESET_COUNT }, () => null);
  presets.forEach((item, index) => {
    list[index] = item;
  });
  return list;
}

// Reads a file the way Import does, then applies the default choices.
function importFile(current, fileJson, choices) {
  const { presets, working } = parsePresetImportFile(JSON.stringify(fileJson));
  const plan = planPresetImport(current, presets, working);
  return { plan, result: applyPresetImport(current, plan, choices ?? defaultImportChoices(plan)) };
}

test('reading the same export again adds nothing', () => {
  const saved = slots(preset('Wave', 100), preset('Rain', 200, { start: { formation: 'spiral' } }));
  const file = createUserPresetExport(saved);

  const { plan, result } = importFile(saved, file);

  assert.deepEqual(plan.counts, { saved: 2, new: 0, conflict: 0, working: 0 });
  assert.equal(result.ok, true);
  assert.equal(result.added, 0);
  assert.equal(result.skipped, 2);
  assert.deepEqual(result.presets, saved);
});

test('identical means every stored part, whatever the key order', () => {
  const a = preset('Wave', 100, { formationLabel: 'W', designViewport: { width: 400, height: 800 } });
  const reordered = {
    settings: Object.fromEntries(Object.entries(a.settings).reverse()),
    designViewport: { height: 800, width: 400 },
    formationLabel: 'W',
    name: 'Wave',
  };
  assert.equal(presetIdentityKey(a), presetIdentityKey(reordered));
  assert.notEqual(presetIdentityKey(a), presetIdentityKey({ ...a, formationLabel: 'X' }));
  assert.notEqual(presetIdentityKey(a), presetIdentityKey({ ...a, designViewport: { width: 401, height: 800 } }));
  assert.notEqual(
    presetIdentityKey(a),
    presetIdentityKey({ ...a, settings: { ...a.settings, myPanelItems: ['mode.flash'] } }),
  );
});

test('a preset normalised on read is identical to its saved copy', () => {
  // Older files miss newer keys; both sides take the same defaults.
  const legacy = { name: 'Old', settings: { particleCount: 120 } };
  const [read] = parsePresetImportFile(JSON.stringify([legacy])).presets;
  assert.equal(presetIdentityKey(read), presetIdentityKey(legacy));
});

test('the same settings under another name are added, not skipped', () => {
  const saved = slots(preset('Wave', 100));
  const { plan, result } = importFile(saved, [preset('Wave copy', 100)]);
  assert.equal(plan.counts.new, 1);
  assert.equal(result.added, 1);
  assert.equal(result.presets[1].name, 'Wave copy');
});

test('a same-name preset that differs is added under a new name by default', () => {
  const saved = slots(preset('Wave', 100), preset('Wave (2)', 150));
  const { plan, result } = importFile(saved, [preset('Wave', 999)]);

  assert.equal(plan.rows[0].kind, 'conflict');
  assert.equal(result.added, 1);
  assert.equal(result.presets[2].name, 'Wave (3)');
  assert.equal(result.presets[2].settings.particleCount, 999);
  assert.equal(result.presets[0].settings.particleCount, 100);
  assert.deepEqual(result.outcomes[0], { action: 'added', slot: 2, name: 'Wave (3)' });
});

test('overwrite replaces the first slot with that name, skip keeps it', () => {
  const saved = slots(preset('A'), preset('Wave', 100), preset('Wave', 101));
  const incoming = [preset('Wave', 999)];

  const over = importFile(saved, incoming, ['overwrite']).result;
  assert.equal(over.overwritten, 1);
  assert.equal(over.presets[1].settings.particleCount, 999);
  assert.equal(over.presets[2].settings.particleCount, 101);
  assert.equal(over.presets[3], null);

  const skip = importFile(saved, incoming, ['skip']).result;
  assert.equal(skip.skipped, 1);
  assert.deepEqual(skip.presets, saved);
});

test('names match exactly after trimming, case counts', () => {
  const saved = slots(preset('Wave', 100));
  const { plan } = importFile(saved, [preset('  Wave ', 200), preset('wave', 300)]);
  assert.deepEqual(plan.rows.map((row) => row.kind), ['conflict', 'new']);
});

test('duplicates inside one file are added once', () => {
  const { plan, result } = importFile(slots(), [preset('Wave', 100), preset('Wave', 100), preset('Wave', 200)]);
  assert.deepEqual(plan.rows.map((row) => row.kind), ['new', 'saved', 'conflict']);
  assert.equal(result.added, 2);
  assert.deepEqual(result.presets.slice(0, 2).map((item) => item?.name), ['Wave', 'Wave (2)']);
});

test('a copy Import renamed counts as saved when the file is read again', () => {
  const file = [preset('Wave', 100), preset('Wave', 200)];
  const first = importFile(slots(), file).result;
  assert.deepEqual(first.presets.slice(0, 2).map((item) => item?.name), ['Wave', 'Wave (2)']);

  const again = importFile(first.presets, file);
  assert.deepEqual(again.plan.counts, { saved: 2, new: 0, conflict: 0, working: 0 });

  // Also when the new name had to be shortened.
  const long = 'y'.repeat(PRESET_NAME_MAX_LENGTH);
  const longFile = [preset(long, 100), preset(long, 200)];
  const longFirst = importFile(slots(), longFile).result;
  assert.equal(longFirst.presets[1].name.length, PRESET_NAME_MAX_LENGTH);
  assert.equal(importFile(longFirst.presets, longFile).plan.counts.saved, 2);

  // A different preset under the renamed name is not a copy.
  assert.equal(importFile(first.presets, [preset('Wave', 300)]).plan.rows[0].kind, 'conflict');
});

test('an in-file same-name preset can overwrite the one added before it', () => {
  const { result } = importFile(slots(), [preset('Wave', 100), preset('Wave', 200)], ['add', 'overwrite']);
  assert.equal(result.added, 1);
  assert.equal(result.overwritten, 1);
  assert.equal(result.presets[0].settings.particleCount, 200);
  assert.equal(result.presets[1], null);
});

test('the work in progress of a backup is offered and skipped by default', () => {
  const saved = slots(preset('Wave', 100));
  const backup = createAutosaveExport(saved, presetFromSettings({ ...DEFAULT_SETTINGS, particleCount: 777 }));

  const skipped = importFile(slots(), backup);
  assert.deepEqual(skipped.plan.rows.map((row) => row.kind), ['new', 'working']);
  assert.equal(skipped.result.added, 1);
  assert.equal(skipped.result.presets.filter(Boolean).length, 1);

  const added = importFile(slots(), backup, ['add', 'add']).result;
  assert.equal(added.presets[1].name, AUTOSAVE_WORKING_PRESET_NAME);
  assert.equal(added.presets[1].settings.particleCount, 777);
});

test('an added work in progress follows the same-name rule', () => {
  const working = presetFromSettings({ ...DEFAULT_SETTINGS, particleCount: 777 });
  const saved = slots({ name: AUTOSAVE_WORKING_PRESET_NAME, settings: presetFromSettings(DEFAULT_SETTINGS) });
  const { result } = importFile(saved, createAutosaveExport([], working), ['add']);
  assert.equal(result.presets[1].name, `${AUTOSAVE_WORKING_PRESET_NAME} (2)`);
});

test('import is refused when the presets to add need more slots than are free', () => {
  const full = Array.from({ length: USER_PRESET_COUNT }, (_, index) => preset(`P${index}`, index + 1));
  full[USER_PRESET_COUNT - 1] = null;
  const incoming = [preset('New A', 5000), preset('New B', 5001), preset('P0', 5002)];

  const { plan, result } = importFile(full, incoming);
  assert.equal(result.ok, false);
  assert.equal(result.needsSlots, 2);
  assert.deepEqual(result.outcomes.map((outcome) => outcome.action), ['added', 'no-slot', 'no-slot']);

  // Overwriting the same-name row and skipping one new row makes it fit.
  const fitted = applyPresetImport(full, plan, ['add', 'skip', 'overwrite']);
  assert.equal(fitted.ok, true);
  assert.equal(fitted.added, 1);
  assert.equal(fitted.overwritten, 1);
});

test('a new name keeps within the name limit', () => {
  const long = 'x'.repeat(PRESET_NAME_MAX_LENGTH);
  const name = uniquePresetName(long, new Set([long]));
  assert.equal(name.length, PRESET_NAME_MAX_LENGTH);
  assert.ok(name.endsWith(' (2)'));
  assert.equal(uniquePresetName('Wave (2)', new Set(['Wave', 'Wave (2)'])), 'Wave (3)');
});

function fakeStorage(entries = {}) {
  const data = new Map(Object.entries(entries));
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => {
      data.set(key, String(value));
    },
  };
}

test('the 30-slot key fills the 60-slot key once and is left untouched', () => {
  const old = Array.from({ length: 30 }, () => null);
  old[0] = preset('Old work', 123);
  old[29] = preset('Last', 456);
  const legacyJson = JSON.stringify(old);
  const storage = fakeStorage({ [LEGACY_USER_PRESET_STORAGE_KEY]: legacyJson });

  const loaded = loadUserPresets(storage);
  assert.equal(loaded.length, USER_PRESET_COUNT);
  assert.equal(loaded[0].name, 'Old work');
  assert.equal(loaded[29].name, 'Last');
  assert.equal(loaded[30], null);
  assert.equal(JSON.parse(storage.data.get(USER_PRESET_STORAGE_KEY)).length, USER_PRESET_COUNT);
  assert.equal(storage.data.get(LEGACY_USER_PRESET_STORAGE_KEY), legacyJson);

  // A later change to the old key, as a stale tab would make, is not read.
  storage.setItem(LEGACY_USER_PRESET_STORAGE_KEY, JSON.stringify([]));
  assert.equal(loadUserPresets(storage)[29].name, 'Last');
});

test('slots 31 to 60 are kept by storage', () => {
  const list = slots();
  list[59] = preset('Sixty', 60);
  const storage = fakeStorage({ [USER_PRESET_STORAGE_KEY]: JSON.stringify(list) });
  assert.equal(loadUserPresets(storage)[59].name, 'Sixty');
});

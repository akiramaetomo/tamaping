import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WORKING_STATE_BOOT_KEY,
  WORKING_STATE_STORAGE_KEY,
  WorkingStateSaver,
  beginWorkingStateBoot,
  finishWorkingStateBoot,
  parseWorkingState,
  workingStateAllowed,
} from '../.test-build/app/workingState.js';
import { DEFAULT_SETTINGS } from '../.test-build/sim/settings.js';
import { presetFromSettings } from '../.test-build/sim/presets.js';
import { DEFAULT_DESIGN_VIEWPORT } from '../.test-build/sim/viewScale.js';

function memoryStorage(initial = {}) {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, value),
    removeItem: (key) => items.delete(key),
  };
}

function workingState(patch = {}) {
  return {
    settings: presetFromSettings({ ...DEFAULT_SETTINGS, particleCount: 321, ballFxAfterglow: true }, 'my'),
    presetValue: 'factory:factory-3',
    snapshot: presetFromSettings(DEFAULT_SETTINGS, null),
    lastAppliedValue: 'factory:factory-3',
    designViewport: { width: 402, height: 717 },
    ...patch,
  };
}

test('diagnostic URLs neither restore nor save the working state', () => {
  assert.equal(workingStateAllowed(''), true);
  assert.equal(workingStateAllowed('?debug=1'), true);
  assert.equal(workingStateAllowed('?dbg=audio'), true);
  assert.equal(workingStateAllowed('?fx=trail'), false);
  assert.equal(workingStateAllowed('?bench=A'), false);
  assert.equal(workingStateAllowed('?dbg=perf'), false);
});

test('working state keeps its values through a save and parse', () => {
  const parsed = parseWorkingState(JSON.stringify(workingState()));

  assert.equal(parsed.settings.particleCount, 321);
  assert.equal(parsed.settings.ballFxAfterglow, true);
  assert.equal(parsed.settings.pinnedGroup, 'my');
  assert.equal(parsed.presetValue, 'factory:factory-3');
  assert.equal(parsed.lastAppliedValue, 'factory:factory-3');
  assert.deepEqual(parsed.designViewport, { width: 402, height: 717 });
  assert.equal(parsed.snapshot.particleCount, DEFAULT_SETTINGS.particleCount);
});

test('broken or partial working state is safe', () => {
  assert.equal(parseWorkingState(null), null);
  assert.equal(parseWorkingState('{not json'), null);
  assert.equal(parseWorkingState('[]'), null);
  assert.equal(parseWorkingState('{"presetValue":"custom"}'), null);

  const partial = parseWorkingState(JSON.stringify({ settings: { particleCount: 999999, particleShape: 'nope' } }));
  assert.equal(partial.settings.particleCount, 10000);
  assert.equal(partial.settings.particleShape, DEFAULT_SETTINGS.particleShape);
  assert.equal(partial.presetValue, 'custom');
  assert.equal(partial.snapshot, null);
  assert.equal(partial.lastAppliedValue, null);
  assert.deepEqual(partial.designViewport, DEFAULT_DESIGN_VIEWPORT);
});

test('a start without stored state sets no boot marker', () => {
  const storage = memoryStorage();

  assert.equal(beginWorkingStateBoot(storage), null);
  assert.equal(storage.getItem(WORKING_STATE_BOOT_KEY), null);
});

test('a start that died during restore makes the next start skip it once and keep the state', () => {
  const json = JSON.stringify(workingState());
  const storage = memoryStorage({ [WORKING_STATE_STORAGE_KEY]: json });

  assert.equal(beginWorkingStateBoot(storage).settings.particleCount, 321);
  assert.equal(storage.getItem(WORKING_STATE_BOOT_KEY), '1');

  assert.equal(beginWorkingStateBoot(storage), null);
  assert.equal(storage.getItem(WORKING_STATE_BOOT_KEY), null);
  assert.equal(storage.getItem(WORKING_STATE_STORAGE_KEY), json);

  assert.equal(beginWorkingStateBoot(storage).settings.particleCount, 321);
});

test('a stable start clears the boot marker', () => {
  const storage = memoryStorage({ [WORKING_STATE_STORAGE_KEY]: JSON.stringify(workingState()) });

  beginWorkingStateBoot(storage);
  finishWorkingStateBoot(storage);

  assert.equal(beginWorkingStateBoot(storage).presetValue, 'factory:factory-3');
});

test('the saver writes only after the state changed', () => {
  const stored = JSON.stringify(workingState({ presetValue: 'custom' }));
  const storage = memoryStorage({ [WORKING_STATE_STORAGE_KEY]: stored });
  let current = workingState();
  const saver = new WorkingStateSaver(storage, () => current);

  // Nothing changed since the start, so a state skipped after a crash survives.
  assert.equal(saver.flush(), false);
  assert.equal(storage.getItem(WORKING_STATE_STORAGE_KEY), stored);

  current = workingState({ presetValue: 'user:2' });
  assert.equal(saver.flush(), true);
  assert.equal(JSON.parse(storage.getItem(WORKING_STATE_STORAGE_KEY)).presetValue, 'user:2');
  assert.equal(saver.flush(), false);
});

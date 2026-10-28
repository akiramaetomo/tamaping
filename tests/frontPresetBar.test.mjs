import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseFrontPresetBarVisible,
  presetBrowseOrder,
  stepPresetValue,
} from '../.test-build/app/frontPresetBar.js';
import { FACTORY_PRESETS, USER_PRESET_COUNT } from '../.test-build/sim/presets.js';

const userPreset = { name: 'Mine', settings: {} };
const users = Array.from({ length: USER_PRESET_COUNT }, () => null);
users[1] = userPreset;
users[4] = userPreset;

const order = presetBrowseOrder(users);
const firstFactory = `factory:${FACTORY_PRESETS[0].id}`;
const lastFactory = `factory:${FACTORY_PRESETS[FACTORY_PRESETS.length - 1].id}`;

test('browse order lists factory presets, then saved user slots only', () => {
  assert.equal(order.length, FACTORY_PRESETS.length + 2);
  assert.equal(order[0], firstFactory);
  assert.deepEqual(order.slice(-2), ['user:1', 'user:4']);
});

test('stepping crosses the factory/user boundary and skips empty slots', () => {
  assert.equal(stepPresetValue(order, lastFactory, null, 1), 'user:1');
  assert.equal(stepPresetValue(order, 'user:1', null, 1), 'user:4');
  assert.equal(stepPresetValue(order, 'user:1', null, -1), lastFactory);
});

test('stepping wraps around at both ends', () => {
  assert.equal(stepPresetValue(order, 'user:4', null, 1), firstFactory);
  assert.equal(stepPresetValue(order, firstFactory, null, -1), 'user:4');
  const factoryOnly = presetBrowseOrder(users.map(() => null));
  assert.equal(stepPresetValue(factoryOnly, lastFactory, null, 1), firstFactory);
});

test('from Custom tuning the step starts at the last applied preset', () => {
  assert.equal(stepPresetValue(order, 'custom', 'user:1', 1), 'user:4');
  assert.equal(stepPresetValue(order, 'custom', 'user:1', -1), lastFactory);
});

test('from Custom tuning with nothing applied, next is first and previous is last', () => {
  assert.equal(stepPresetValue(order, 'custom', null, 1), firstFactory);
  assert.equal(stepPresetValue(order, 'custom', null, -1), 'user:4');
  // A deleted user slot no longer anchors the step.
  assert.equal(stepPresetValue(order, 'custom', 'user:2', 1), firstFactory);
  assert.equal(stepPresetValue([], 'custom', null, 1), null);
});

test('the front bar is shown unless the player closed it', () => {
  assert.equal(parseFrontPresetBarVisible(null), true);
  assert.equal(parseFrontPresetBarVisible('1'), true);
  assert.equal(parseFrontPresetBarVisible('0'), false);
});

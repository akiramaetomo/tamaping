import test from 'node:test';
import assert from 'node:assert/strict';

import { effectivePresetMessageText } from '../.test-build/app/messageFormation.js';
import {
  designViewportForPresetValue,
  initialFormationForPresetValue,
  presetEditOutcome,
  presetExportFilename,
  presetExportName,
  presetFormationLabel,
  presetMessageText,
  presetSettingsEqual,
  presetSettingsForValue,
} from '../.test-build/app/presetValues.js';
import { FACTORY_PRESETS, presetFromSettings } from '../.test-build/sim/presets.js';
import { DEFAULT_SETTINGS } from '../.test-build/sim/settings.js';
import { DEFAULT_DESIGN_VIEWPORT } from '../.test-build/sim/viewScale.js';

test('export file names carry the local date with padded month and day', () => {
  assert.equal(
    presetExportFilename('dotping-user-presets', new Date(2026, 10, 5, 23, 59)),
    'dotping-user-presets-2026-11-05.json',
  );
  assert.equal(
    presetExportFilename('dotping-current-preset', new Date(2027, 0, 9, 0, 1)),
    'dotping-current-preset-2027-01-09.json',
  );
});

const factory = FACTORY_PRESETS[0];
const userSettings = presetFromSettings({ ...DEFAULT_SETTINGS, particleCount: 240 }, 'my');
const userPresets = [
  null,
  { name: 'Mine', formationLabel: 'HELLO', designViewport: { width: 1280, height: 720 }, settings: userSettings },
  { name: 'Plain', settings: userSettings },
];

test('preset values resolve factory, user, empty, and custom selections', () => {
  const factoryValue = `factory:${factory.id}`;

  assert.equal(
    presetFormationLabel(factoryValue, userPresets),
    effectivePresetMessageText(factory.name, factory.formationLabel),
  );
  assert.equal(presetFormationLabel('user:1', userPresets), 'HELLO');
  assert.equal(presetFormationLabel('user:2', userPresets), 'Plain');
  assert.equal(presetFormationLabel('custom', userPresets), null);
  assert.equal(presetMessageText('custom', userPresets), 'Custom');
  assert.equal(presetMessageText('user:1', userPresets), 'HELLO');

  assert.equal(presetExportName(factoryValue, userPresets), factory.name);
  assert.equal(presetExportName('user:2', userPresets), 'Plain');
  assert.equal(presetExportName('user:0', userPresets), 'Current');
  assert.equal(presetExportName('custom', userPresets), 'Current');

  assert.equal(presetSettingsForValue(factoryValue, userPresets), factory.settings);
  assert.equal(presetSettingsForValue('user:1', userPresets), userSettings);
  assert.equal(presetSettingsForValue('user:0', userPresets), null);
  assert.equal(presetSettingsForValue('factory:missing', userPresets), null);
  assert.equal(presetSettingsForValue('custom', userPresets), null);
});

test('design viewport comes only from user presets that recorded one', () => {
  assert.deepEqual(designViewportForPresetValue('user:1', userPresets), { width: 1280, height: 720 });
  assert.equal(designViewportForPresetValue('user:2', userPresets), DEFAULT_DESIGN_VIEWPORT);
  assert.equal(designViewportForPresetValue('user:0', userPresets), DEFAULT_DESIGN_VIEWPORT);
  assert.equal(
    designViewportForPresetValue(`factory:${factory.id}`, userPresets),
    DEFAULT_DESIGN_VIEWPORT,
  );
});

test('initial formation applies only to factory presets that define one', () => {
  const withFormation = FACTORY_PRESETS.find((preset) => preset.initialFormation);
  assert.ok(withFormation, 'expected at least one factory preset with an initial formation');
  assert.equal(
    initialFormationForPresetValue(`factory:${withFormation.id}`),
    withFormation.initialFormation,
  );

  const withoutFormation = FACTORY_PRESETS.find((preset) => !preset.initialFormation);
  if (withoutFormation) {
    assert.equal(initialFormationForPresetValue(`factory:${withoutFormation.id}`), null);
  }
  assert.equal(initialFormationForPresetValue('user:1'), null);
  assert.equal(initialFormationForPresetValue('custom'), null);
});

test('preset edit outcome returns to Applied, shows Modified, or falls back to Custom', () => {
  const applied = presetFromSettings(DEFAULT_SETTINGS, null);
  const changed = presetFromSettings({ ...DEFAULT_SETTINGS, particleCount: 999 }, null);
  const pinned = presetFromSettings(DEFAULT_SETTINGS, 'audio');

  assert.equal(presetSettingsEqual(applied, presetFromSettings(DEFAULT_SETTINGS, null)), true);
  assert.equal(presetSettingsEqual(applied, changed), false);
  assert.equal(presetSettingsEqual(applied, pinned), false);

  // Editing back to the applied values restores Applied.
  assert.equal(presetEditOutcome(applied, applied, 'factory:x'), 'applied');
  // Any setting or pin difference keeps the preset selected as Modified.
  assert.equal(presetEditOutcome(changed, applied, 'factory:x'), 'modified');
  assert.equal(presetEditOutcome(pinned, applied, 'user:3'), 'modified');
  // Without an applied snapshot, or after the selection became Custom, edits are Custom.
  assert.equal(presetEditOutcome(changed, null, 'factory:x'), 'custom');
  assert.equal(presetEditOutcome(changed, applied, 'custom'), 'custom');
});

test('runtime-only settings do not turn an applied preset into Modified', () => {
  const applied = presetFromSettings(DEFAULT_SETTINGS, null);
  const runtimeOnly = presetFromSettings(
    { ...DEFAULT_SETTINGS, debug: !DEFAULT_SETTINGS.debug, soundEnabled: !DEFAULT_SETTINGS.soundEnabled },
    null,
  );

  assert.equal(presetEditOutcome(runtimeOnly, applied, 'factory:x'), 'applied');
});

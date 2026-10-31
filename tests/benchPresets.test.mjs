import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BENCH_DESIGN_VIEWPORT,
  BENCH_PRESETS,
  benchIdFromParams,
  benchPresetForValue,
  benchPresetValue,
} from '../.test-build/sim/benchPresets.js';
import {
  designViewportForPresetValue,
  initialFormationForPresetValue,
  presetExportName,
  presetSettingsForValue,
} from '../.test-build/app/presetValues.js';
import { presetBrowseOrder } from '../.test-build/app/frontPresetBar.js';
import { FACTORY_PRESETS } from '../.test-build/sim/presets.js';

const byId = (id) => BENCH_PRESETS.find((preset) => preset.id === id);

test('bench presets define the four agreed scenes at 1000 dots', () => {
  assert.deepEqual(BENCH_PRESETS.map((preset) => preset.id), ['A', 'B', 'C', 'D']);
  for (const preset of BENCH_PRESETS) {
    assert.equal(preset.settings.particleCount, 1000);
    assert.equal(preset.settings.pinnedGroup, null);
    assert.ok(preset.name.startsWith('⏱ '));
  }

  assert.equal(byId('A').settings.collisionMode, 'collision-physical');
  assert.equal(byId('A').settings.gravityMode, 'none');
  assert.equal(byId('A').settings.particleRadius, 4);

  assert.equal(byId('B').settings.collisionMode, 'independence-overlapping');
  assert.equal(byId('B').settings.gravityMode, 'gravity');
  assert.equal(byId('B').settings.gravityStrength, 3);
  assert.equal(byId('B').settings.particleRadius, 8);

  assert.equal(byId('C').settings.collisionMode, 'independence-overlapping');
  assert.equal(byId('C').settings.gravityMode, 'none');
  assert.equal(byId('C').settings.particleRadius, 16);
  assert.equal(byId('C').settings.particleRimWidth, 50);

  assert.equal(byId('D').settings.collisionMode, 'collision-physical');
  assert.equal(byId('D').settings.gravityMode, 'gravity');
  assert.equal(byId('D').settings.gravityStrength, 1);
  assert.equal(byId('D').settings.particleRadius, 4);
});

test('bench presets stay out of the factory list and front bar browsing', () => {
  assert.equal(FACTORY_PRESETS.length, 30);
  assert.ok(FACTORY_PRESETS.every((preset) => !preset.name.startsWith('⏱')));
  assert.ok(presetBrowseOrder([]).every((value) => !value.startsWith('bench:')));
});

test('bench select values resolve settings, name and the fixed design screen', () => {
  const value = benchPresetValue('B');
  assert.equal(value, 'bench:B');
  assert.equal(benchPresetForValue(value), byId('B'));
  assert.equal(benchPresetForValue('bench:Z'), undefined);
  assert.equal(benchPresetForValue('factory:B'), undefined);

  assert.deepEqual(presetSettingsForValue(value, []), byId('B').settings);
  assert.equal(presetExportName(value, []), '⏱ B Physics gathered');
  assert.deepEqual(designViewportForPresetValue(value, []), BENCH_DESIGN_VIEWPORT);
  assert.deepEqual(BENCH_DESIGN_VIEWPORT, { width: 360, height: 800 });
  assert.equal(initialFormationForPresetValue(value), null);
});

test('bench query parameter accepts known ids case-insensitively', () => {
  const id = (search) => benchIdFromParams(new URLSearchParams(search));
  assert.equal(id('?bench=B'), 'B');
  assert.equal(id('?bench=c'), 'C');
  assert.equal(id('?bench=%20d%20'), 'D');
  assert.equal(id('?bench=E'), null);
  assert.equal(id('?bench='), null);
  assert.equal(id(''), null);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_MY_PANEL_ITEMS,
  MY_PANEL_MAX_ITEMS,
  normalizeMyPanelState,
  parseMyPanelState,
  restoreDefaultMyPanelItems,
  toggleMyPanelItem,
} from '../.test-build/app/myPanel.js';
import {
  SETTINGS_TABS,
  isCardVisibleInTab,
  resolveInitialSettingsTab,
} from '../.test-build/app/settingsTabs.js';
import { ControlRegistry } from '../.test-build/app/controlRegistry.js';

const KNOWN = new Set(['mode.flash', 'mode.name', 'ball.size', 'audio.sound']);

test('settings tab defaults to All on desktop and Preset on mobile', () => {
  assert.equal(resolveInitialSettingsTab(null, false), 'all');
  assert.equal(resolveInitialSettingsTab(null, true), 'preset');
  assert.equal(resolveInitialSettingsTab('audio', true), 'audio');
  assert.equal(resolveInitialSettingsTab('my', false), 'my');
  assert.equal(resolveInitialSettingsTab('removed-tab', false), 'all');
  assert.deepEqual(
    SETTINGS_TABS.map(([id]) => id),
    ['my', 'preset', 'mode', 'ball', 'particles', 'interaction', 'audio', 'utility', 'all'],
  );
});

test('All shows every card except an empty My Panel; single tabs show one card', () => {
  assert.equal(isCardVisibleInTab('mode', 'all', 0), true);
  assert.equal(isCardVisibleInTab('my', 'all', 0), false);
  assert.equal(isCardVisibleInTab('my', 'all', 2), true);
  assert.equal(isCardVisibleInTab('my', 'my', 0), true);
  assert.equal(isCardVisibleInTab('mode', 'ball', 0), false);
  assert.equal(isCardVisibleInTab('ball', 'ball', 0), true);
});

test('My Panel state drops unknown ids, duplicates and items past the cap', () => {
  assert.deepEqual(
    normalizeMyPanelState(
      { items: ['mode.flash', 'gone', 'mode.flash', 3, 'mode.name'], pinned: true },
      KNOWN,
    ),
    { items: ['mode.flash', 'mode.name'], pinned: true },
  );
  assert.deepEqual(
    normalizeMyPanelState({ items: [...KNOWN], pinned: 'yes' }, KNOWN, 2),
    { items: ['mode.flash', 'mode.name'], pinned: false },
  );
  assert.deepEqual(parseMyPanelState('{broken', KNOWN), { items: [], pinned: false });
  assert.deepEqual(parseMyPanelState('', KNOWN), { items: [], pinned: false });
  assert.equal(MY_PANEL_MAX_ITEMS, 10);
});

test('My Panel starts with the default items only when nothing was saved', () => {
  const known = new Set([...DEFAULT_MY_PANEL_ITEMS, 'ball.size']);
  assert.deepEqual(parseMyPanelState(null, known), {
    items: [...DEFAULT_MY_PANEL_ITEMS],
    pinned: false,
  });
  // An emptied panel was saved on purpose, so it stays empty.
  assert.deepEqual(
    parseMyPanelState(JSON.stringify({ items: [], pinned: false }), known),
    { items: [], pinned: false },
  );
  // Default restores the items and keeps the pin choice.
  assert.deepEqual(
    restoreDefaultMyPanelItems({ items: ['ball.size'], pinned: true }, known),
    { items: [...DEFAULT_MY_PANEL_ITEMS], pinned: true },
  );
  // Unknown default ids are dropped like any other unknown id.
  assert.deepEqual(parseMyPanelState(null, KNOWN).items, ['audio.sound', 'mode.flash']);
});

test('toggling My Panel items keeps pick order and respects the cap', () => {
  let state = { items: [], pinned: false };
  state = toggleMyPanelItem(state, 'mode.name');
  state = toggleMyPanelItem(state, 'mode.flash');
  assert.deepEqual(state.items, ['mode.name', 'mode.flash']);

  const full = toggleMyPanelItem(state, 'ball.size', 2);
  assert.equal(full, state);

  state = toggleMyPanelItem(state, 'mode.name');
  assert.deepEqual(state.items, ['mode.flash']);
});

test('control registry rejects duplicate ids and syncs other live copies', () => {
  const registry = new ControlRegistry();
  const synced = [];
  let notify = () => {};
  const definition = {
    id: 'ball.size',
    card: 'ball',
    kind: 'setting',
    panelLabel: 'Ball size',
    create: (label, changed) => {
      const name = label ?? 'card';
      if (name === 'card') {
        notify = changed;
      }
      return { element: {}, sync: () => synced.push(name) };
    },
  };

  registry.define(definition);
  assert.throws(() => registry.define(definition), /Duplicate control id/);

  const copy = registry.createInstance('ball.size', 'Ball size');
  notify();
  assert.deepEqual(synced, ['Ball size']);

  registry.release(copy);
  synced.length = 0;
  registry.syncAll();
  assert.deepEqual(synced, ['card']);
  assert.deepEqual([...registry.ids()], ['ball.size']);
});

test('control registry syncId syncs only the live copies of one control', () => {
  const registry = new ControlRegistry();
  const synced = [];
  const define = (id) => registry.define({
    id,
    card: id === 'preset.select' ? 'preset' : 'ball',
    kind: 'setting',
    panelLabel: id,
    create: (label) => ({ element: {}, sync: () => synced.push(`${id}:${label ?? 'card'}`) }),
  });

  define('preset.select');
  define('ball.size');
  registry.createInstance('preset.select', 'Preset');

  registry.syncId('preset.select');
  assert.deepEqual(synced, ['preset.select:card', 'preset.select:Preset']);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cleanPresetMessageText,
  createDotFontMessagePoints,
  createMessageTargetsFromPoints,
  dotFontLineWidth,
  effectivePresetMessageText,
  isDotFontLine,
  messageLineUnits,
  messageLines,
  messagePointBounds,
  presetDisplayLabel,
} from '../.test-build/app/messageFormation.js';

test('preset message text and display labels are normalized without changing names', () => {
  assert.equal(cleanPresetMessageText('User 03:  Blue Orbit  '), 'Blue Orbit');
  assert.equal(cleanPresetMessageText('12. Spark Field  '), 'Spark Field');
  assert.equal(cleanPresetMessageText('  '), 'Custom');
  assert.equal(cleanPresetMessageText(null), 'Custom');

  assert.equal(effectivePresetMessageText('aaaa', undefined), 'aaaa');
  assert.equal(effectivePresetMessageText('aaaa', 'aaaa1'), 'aaaa1');
  assert.equal(effectivePresetMessageText('12. Spark Field', null), 'Spark Field');

  assert.equal(presetDisplayLabel('Blue Orbit', 'Orbit'), 'Blue Orbit / Orbit');
  assert.equal(presetDisplayLabel('Blue Orbit', 'Blue Orbit'), 'Blue Orbit / Blue Orbit');
  assert.equal(presetDisplayLabel('Blue Orbit', '  '), 'Blue Orbit');
});

test('message line splitting preserves desktop text and balances mobile text', () => {
  assert.equal(messageLineUnits('ABC あ'), 6);
  assert.deepEqual(messageLines('  Hello    dotping  ', false), ['Hello dotping']);
  assert.deepEqual(messageLines('A B C D E F', true), ['A B C', 'D E F']);
  assert.deepEqual(messageLines('ABCDEFGHIJKLMNO', true), ['ABCDEFGH', 'IJKLMNO']);
});

test('dot font helpers measure and place supported glyph points', () => {
  assert.equal(isDotFontLine('A Z!?'), true);
  assert.equal(isDotFontLine('A あ'), false);
  assert.equal(dotFontLineWidth('A'), 5);
  assert.equal(dotFontLineWidth('A B'), 15);

  const points = createDotFontMessagePoints(['A'], 50, 70, 100, 100);
  assert.equal(points.length, 18);
  assert.deepEqual(messagePointBounds(points), {
    minX: 80,
    minY: 70,
    maxX: 120,
    maxY: 130,
  });
});

test('message target generation preserves text points and stashes surplus particles', () => {
  const textPoints = [
    { x: 40, y: 10 },
    { x: 50, y: 12 },
    { x: 60, y: 18 },
    { x: 70, y: 20 },
  ];
  const targets = createMessageTargetsFromPoints(textPoints, 6, 200, 100, 5);

  assert.equal(targets.length, 6);
  assert.deepEqual(targets.slice(0, 4), [
    { x: 40, y: 10, vx: 0, vy: 0 },
    { x: 50, y: 12, vx: 0, vy: 0 },
    { x: 60, y: 18, vx: 0, vy: 0 },
    { x: 70, y: 20, vx: 0, vy: 0 },
  ]);
  assert.equal(targets[4].vx, 0);
  assert.equal(targets[4].vy, 0);
  assert.ok(targets[4].y >= 40);
  assert.ok(targets[5].y >= 40);
});

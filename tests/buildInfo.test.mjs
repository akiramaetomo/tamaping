import test from 'node:test';
import assert from 'node:assert/strict';

import { buildInfoLines, currentBuildInfo } from '../.test-build/app/buildInfo.js';

test('the build lines name the code, the Rapier build, the secure context and the URL switches', () => {
  const info = { branch: 'feat/spin-pattern', commit: '3b9e83f', dirty: true, startedAt: '2026-11-19 15:03', kind: 'dev' };
  assert.deepEqual(buildInfoLines(info, '0.14.0', '?fx=spin', true), [
    'build=feat/spin-pattern@3b9e83f+dirty',
    'dev_started=2026-11-19_15:03',
    'rapier=0.14.0 secure=yes',
    'url=?fx=spin',
  ]);
  assert.deepEqual(buildInfoLines({ ...info, dirty: false, kind: 'build' }, '', '', false), [
    'build=feat/spin-pattern@3b9e83f',
    'build_started=2026-11-19_15:03',
    'rapier=unknown secure=no',
    'url=none',
  ]);
  // Outside Vite (Node tests) there is no build identity.
  assert.equal(currentBuildInfo(), null);
  assert.deepEqual(buildInfoLines(null, '0.14.0', '?'), ['build=unknown', 'rapier=0.14.0', 'url=none']);
});

test('every build line fits a phone-width overlay', () => {
  const info = { branch: 'feat/spin-pattern', commit: '3b9e83f', dirty: true, startedAt: '2026-11-19 15:03', kind: 'dev' };
  for (const line of buildInfoLines(info, '0.14.0', '?fx=spin&debug=1', true)) {
    assert.ok(line.length <= 40, line);
  }
});

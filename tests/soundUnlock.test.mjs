import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SOUND_UNLOCK_GRACE_MS,
  shouldShowSoundUnlock,
} from '../.test-build/app/soundUnlock.js';

const base = {
  soundEnabled: true,
  contextState: 'suspended',
  lastCanvasAttemptAt: 1000,
  now: 1000 + SOUND_UNLOCK_GRACE_MS,
};

test('sound unlock badge shows after a failed canvas unlock attempt', () => {
  assert.equal(shouldShowSoundUnlock(base), true);
  assert.equal(shouldShowSoundUnlock({ ...base, contextState: 'interrupted' }), true);
  assert.equal(shouldShowSoundUnlock({ ...base, contextState: 'none' }), true);
});

test('sound unlock badge stays hidden when audio runs or cannot be helped', () => {
  assert.equal(shouldShowSoundUnlock({ ...base, contextState: 'running' }), false);
  assert.equal(shouldShowSoundUnlock({ ...base, contextState: 'closed' }), false);
  assert.equal(shouldShowSoundUnlock({ ...base, soundEnabled: false }), false);
  assert.equal(shouldShowSoundUnlock({ ...base, lastCanvasAttemptAt: -1 }), false);
});

test('sound unlock badge waits for a resume to settle', () => {
  assert.equal(shouldShowSoundUnlock({ ...base, now: base.now - 1 }), false);
});

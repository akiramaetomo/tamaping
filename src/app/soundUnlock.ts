// iPad WebKit enables audio only after a short still tap or a DOM click, never
// after a canvas drag. The badge offers a tappable way out when a canvas
// interaction failed to start audio.

// Gives a successful resume() time to settle before the badge is shown.
export const SOUND_UNLOCK_GRACE_MS = 400;

export type SoundUnlockState = {
  soundEnabled: boolean;
  contextState: string;
  // performance.now() of the last canvas unlock attempt, or -1 if none yet.
  lastCanvasAttemptAt: number;
  now: number;
};

export function shouldShowSoundUnlock(state: SoundUnlockState) {
  if (!state.soundEnabled || state.lastCanvasAttemptAt < 0) {
    return false;
  }
  if (state.contextState === 'running' || state.contextState === 'closed') {
    return false;
  }
  return state.now - state.lastCanvasAttemptAt >= SOUND_UNLOCK_GRACE_MS;
}

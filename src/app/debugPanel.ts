import type { AudioDiagnostics } from '../audio/audioEngine';
import type { ParticleDiagnostics, StepMetrics } from '../sim/physicsWorld';
import type { CollisionMode, GravityMode } from '../sim/settings';
import type { ViewScale } from '../sim/viewScale';

export type DebugProfile = 'physics' | 'audio';

export type PhysicsDebugSnapshot = {
  profile: DebugProfile;
  deltaSeconds: number;
  collisionMode: CollisionMode;
  gravityMode: GravityMode;
  particleCount: number;
  particleDiagnostics: ParticleDiagnostics;
  fixedStepsLastFrame: number;
  averageStepMs: number;
  lastStepMetrics: StepMetrics;
  impactCount: number;
  activeVoiceCount: number;
  view?: ViewScale;
};

export const DEFAULT_DEBUG_PROFILE: DebugProfile = 'physics';
export const DEBUG_COPY_FALLBACK_TEXT = 'dotping_debug\nstatus=not_available';

export function debugProfileFromParams(params: URLSearchParams): DebugProfile {
  const profile = params.get('debugProfile') ?? params.get('dbg');
  if (profile === 'audio') {
    return 'audio';
  }
  if (profile === 'physics') {
    return 'physics';
  }
  if (params.get('debugAudio') === '1') {
    return 'audio';
  }
  return DEFAULT_DEBUG_PROFILE;
}

// Opens the debug overlay from the URL, so devices can be diagnosed without
// touching Settings (any Settings tap grants user activation on iPad).
export function debugVisibleFromParams(params: URLSearchParams) {
  return params.get('debug') === '1'
    || params.get('debugAudio') === '1'
    || params.has('debugProfile')
    || params.has('dbg');
}

export function debugProfileFromLocation(search: string): DebugProfile {
  return debugProfileFromParams(new URLSearchParams(search));
}

export function createPhysicsDebugLines(snapshot: PhysicsDebugSnapshot) {
  const particleDiagnostics = snapshot.particleDiagnostics;
  return [
    'dotping_debug',
    `debug_profile=${snapshot.profile}`,
    `fps=${Math.round(1 / Math.max(snapshot.deltaSeconds, 0.001))}`,
    `particle_model=${particleModelLabel(snapshot.collisionMode)}`,
    `gravity=${gravityLabel(snapshot.gravityMode)}`,
    `dots=${snapshot.particleCount}`,
    `visible_dots=${particleDiagnostics.visible}`,
    `out_of_bounds_dots=${particleDiagnostics.outOfBounds}`,
    `nonfinite_dots=${particleDiagnostics.nonFinite}`,
    `recovered_dots_last_step=${particleDiagnostics.recoveredLastStep}`,
    `max_dot_speed=${particleDiagnostics.maxSpeed.toFixed(1)}`,
    `max_out_distance=${particleDiagnostics.maxOutOfBoundsDistance.toFixed(1)}`,
    `fixed_steps=${snapshot.fixedStepsLastFrame}`,
    `ms_per_step=${snapshot.averageStepMs.toFixed(2)}`,
    `rapier_length_unit=${snapshot.lastStepMetrics.lengthUnit}`,
    `collider_layout=${snapshot.lastStepMetrics.colliderLayout}`,
    `colliders=${snapshot.lastStepMetrics.colliderCount}`,
    `hits=${snapshot.impactCount}`,
    `voices=${snapshot.activeVoiceCount}`,
    ...(snapshot.view ? viewScaleDebugLines(snapshot.view) : []),
  ];
}

function viewScaleDebugLines(view: ViewScale) {
  return [
    `view_scale=${view.mode} x${view.scale.toFixed(3)}`,
    `world=${Math.round(view.worldWidth)}x${Math.round(view.worldHeight)}`,
  ];
}

export function createAudioDebugLines(
  audio: AudioDiagnostics,
  profile: DebugProfile,
  deltaSeconds?: number,
) {
  return [
    'dotping_debug',
    `debug_profile=${profile}`,
    ...(deltaSeconds === undefined
      ? []
      : [`fps=${Math.round(1 / Math.max(deltaSeconds, 0.001))}`]),
    `audio_enabled=${audio.enabled}`,
    `audio_context=${audio.contextState}`,
    `audio_resume=${audio.lastResumeStatus}`,
    `audio_resume_attempts=${audio.resumeAttempts}`,
    `audio_resume_successes=${audio.resumeSuccesses}`,
    `audio_resume_failures=${audio.resumeFailures}`,
    `audio_voice_release_fallbacks=${audio.voiceReleaseFallbacks}`,
    `audio_stolen_voices=${audio.stolenVoices}`,
    `audio_stolen_per_sec=${audio.stolenVoicesPerSecond}`,
    `audio_steal_release_ms=${audio.stealReleaseMs.toFixed(1)}`,
    `audio_lookahead_ms=${audio.lookaheadMs.toFixed(1)}`,
    `audio_sample_rate=${audio.contextSampleRate}`,
    `audio_base_latency_ms=${formatDiagnosticNumber(audio.baseLatencyMs, 1)}`,
    `audio_output_latency_ms=${formatDiagnosticNumber(audio.outputLatencyMs, 1)}`,
    `audio_clock_step_ms=${formatDiagnosticNumber(audio.clockStepMs, 2)}`,
    `audio_clock_step_max_ms=${formatDiagnosticNumber(audio.clockStepMaxMs, 2)}`,
    `audio_active_voices=${audio.activeVoices}`,
    `audio_max_voices=${audio.maxVoices}`,
    `audio_active_ball_voices=${audio.activeBallVoices}`,
    `audio_max_ball_voices=${audio.maxBallVoices}`,
    `audio_active_particle_voices=${audio.activeParticleVoices}`,
    `audio_max_particle_voices=${audio.maxParticleVoices}`,
    `audio_trigger_test=${audio.triggerTestMode}`,
    `audio_trigger_shape=${audio.triggerShape}`,
    `audio_start_spread_ms=${audio.startSpreadMs.toFixed(1)}`,
    `audio_max_triggers_per_frame=${audio.maxTriggersPerFrame}`,
    `audio_reserved_ball_triggers=${audio.reservedBallTriggersPerFrame}`,
    `audio_max_ball_triggers_per_frame=${audio.maxBallTriggersPerFrame}`,
    `audio_max_particle_triggers_per_frame=${audio.maxParticleTriggersPerFrame}`,
    `audio_ball_wave=${audio.ballWaveform}`,
    `audio_ball_frequency_hz=${audio.ballFrequencyHz.toFixed(1)}`,
    `audio_ball_spread=${audio.ballFrequencySpread.toFixed(2)}`,
    `audio_ball_duration_ms=${audio.ballDurationMs.toFixed(1)}`,
    `audio_ball_frequency_cursor=${audio.ballFrequencyCursor}`,
    `audio_particle_wave=${audio.particleWaveform}`,
    `audio_particle_frequency_hz=${audio.particleFrequencyHz.toFixed(1)}`,
    `audio_particle_spread=${audio.particleFrequencySpread.toFixed(2)}`,
    `audio_particle_duration_ms=${audio.particleDurationMs.toFixed(1)}`,
    `audio_particle_frequency_cursor=${audio.particleFrequencyCursor}`,
    `audio_attack_ms=${audio.attackMs.toFixed(1)}`,
    `audio_attack_curve=${audio.attackCurve}`,
    `audio_raw_impacts=${audio.lastRawImpacts}`,
    `audio_selected_impacts=${audio.lastSelectedImpacts}`,
    `audio_selected_ball_voices=${audio.lastSelectedBallVoices}`,
    `audio_selected_particle_voices=${audio.lastSelectedParticleVoices}`,
    `audio_started_voices=${audio.lastStartedVoices}`,
    `audio_started_ball_voices=${audio.lastStartedBallVoices}`,
    `audio_started_particle_voices=${audio.lastStartedParticleVoices}`,
    `audio_stolen_ball_voices=${audio.lastStolenBallVoices}`,
    `audio_stolen_particle_voices=${audio.lastStolenParticleVoices}`,
    `audio_skipped_voice_cap=${audio.lastSkippedVoiceCap}`,
    `audio_gain_min=${formatDiagnosticNumber(audio.lastGainMin, 4)}`,
    `audio_gain_max=${formatDiagnosticNumber(audio.lastGainMax, 4)}`,
    `audio_gain_avg=${formatDiagnosticNumber(audio.lastGainAverage, 4)}`,
    `audio_active_gain_sum=${formatDiagnosticNumber(audio.activeGainUpperBound, 4)}`,
    `audio_active_gain_max=${formatDiagnosticNumber(audio.maxActiveGainUpperBound, 4)}`,
    `audio_possible_clip=${audio.activeGainUpperBound >= 1}`,
    `audio_possible_clip_frames=${audio.possibleClipFrames}`,
    `audio_energy_min=${formatDiagnosticNumber(audio.lastSelectedEnergyMin, 1)}`,
    `audio_energy_max=${formatDiagnosticNumber(audio.lastSelectedEnergyMax, 1)}`,
    `silent_sound_disabled=${audio.silentFramesSoundDisabled}`,
    `silent_context_not_running=${audio.silentFramesContextNotRunning}`,
    `silent_no_selected_impacts=${audio.silentFramesNoSelectedImpacts}`,
    `silent_voice_cap_full=${audio.silentFramesVoiceCapFull}`,
  ];
}

export function copyTextWithFallback(text: string) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);

  try {
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

export function particleModelLabel(mode: CollisionMode) {
  return mode === 'collision-physical'
    ? 'Physical collision'
    : 'Independent overlap';
}

export function gravityLabel(mode: GravityMode) {
  switch (mode) {
    case 'gravity':
      return 'Gravity';
    case 'antigravity':
      return 'Anti-gravity';
    case 'none':
    default:
      return 'Zero-G';
  }
}

export function formatDiagnosticNumber(value: number, digits: number) {
  return Number.isFinite(value) ? value.toFixed(digits) : 'n/a';
}

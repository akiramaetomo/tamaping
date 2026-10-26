import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_DEBUG_PROFILE,
  createAudioDebugLines,
  createPhysicsDebugLines,
  debugProfileFromLocation,
  debugProfileFromParams,
  formatDiagnosticNumber,
  gravityLabel,
  particleModelLabel,
} from '../.test-build/app/debugPanel.js';

test('debug profile query parsing preserves accepted aliases and fallback order', () => {
  assert.equal(DEFAULT_DEBUG_PROFILE, 'physics');
  assert.equal(debugProfileFromLocation('?debugProfile=audio'), 'audio');
  assert.equal(debugProfileFromLocation('?debugProfile=physics'), 'physics');
  assert.equal(debugProfileFromLocation('?dbg=audio'), 'audio');
  assert.equal(debugProfileFromLocation('?debugAudio=1'), 'audio');
  assert.equal(debugProfileFromLocation('?debugProfile=other&debugAudio=1'), 'audio');
  assert.equal(debugProfileFromLocation('?debugProfile=other'), 'physics');

  const params = new URLSearchParams();
  params.set('debugProfile', 'audio');
  params.set('dbg', 'physics');
  assert.equal(debugProfileFromParams(params), 'audio');
});

test('physics debug lines keep existing labels, order, and numeric formatting', () => {
  assert.equal(particleModelLabel('collision-physical'), 'Physical collision');
  assert.equal(particleModelLabel('independence-overlapping'), 'Independent overlap');
  assert.equal(gravityLabel('none'), 'Zero-G');
  assert.equal(gravityLabel('gravity'), 'Gravity');
  assert.equal(gravityLabel('antigravity'), 'Anti-gravity');

  assert.deepEqual(
    createPhysicsDebugLines({
      profile: 'physics',
      deltaSeconds: 1 / 60,
      collisionMode: 'collision-physical',
      gravityMode: 'antigravity',
      particleCount: 500,
      particleDiagnostics: {
        total: 500,
        visible: 490,
        outOfBounds: 3,
        nonFinite: 1,
        maxSpeed: 123.456,
        maxOutOfBoundsDistance: 9.876,
        recoveredLastStep: 2,
      },
      fixedStepsLastFrame: 2,
      averageStepMs: 0.9876,
      lastStepMetrics: {
        durationMs: 1.23,
        lengthUnit: 10,
        colliderLayout: 'split',
        colliderCount: 1004,
      },
      impactCount: 8,
      activeVoiceCount: 12,
    }),
    [
      'dotping_debug',
      'debug_profile=physics',
      'fps=60',
      'particle_model=Physical collision',
      'gravity=Anti-gravity',
      'dots=500',
      'visible_dots=490',
      'out_of_bounds_dots=3',
      'nonfinite_dots=1',
      'recovered_dots_last_step=2',
      'max_dot_speed=123.5',
      'max_out_distance=9.9',
      'fixed_steps=2',
      'ms_per_step=0.99',
      'rapier_length_unit=10',
      'collider_layout=split',
      'colliders=1004',
      'hits=8',
      'voices=12',
    ],
  );
});

test('audio debug lines keep current diagnostic keys and n/a number formatting', () => {
  assert.equal(formatDiagnosticNumber(Number.NaN, 4), 'n/a');
  assert.equal(formatDiagnosticNumber(0.123456, 4), '0.1235');

  const lines = createAudioDebugLines({
    enabled: true,
    contextState: 'running',
    lastResumeStatus: 'resolved',
    resumeAttempts: 2,
    resumeSuccesses: 1,
    resumeFailures: 1,
    voiceReleaseFallbacks: 3,
    stolenVoices: 4,
    stolenVoicesPerSecond: 3,
    stealReleaseMs: 2,
    lookaheadMs: 20,
    contextSampleRate: 44100,
    baseLatencyMs: 10,
    outputLatencyMs: Number.NaN,
    clockStepMs: 10.1587,
    clockStepMaxMs: 20.3,
    activeVoices: 18,
    maxVoices: 20,
    activeBallVoices: 2,
    maxBallVoices: 4,
    activeParticleVoices: 16,
    maxParticleVoices: 16,
    triggerTestMode: 'random-step',
    triggerShape: 'random',
    startSpreadMs: 8,
    maxTriggersPerFrame: 8,
    reservedBallTriggersPerFrame: 1,
    maxBallTriggersPerFrame: 1,
    maxParticleTriggersPerFrame: 7,
    ballWaveform: 'triangle',
    ballFrequencyHz: 440,
    ballFrequencySpread: 1.234,
    ballDurationMs: 150,
    ballFrequencyCursor: 5,
    particleWaveform: 'sine',
    particleFrequencyHz: 4000,
    particleFrequencySpread: 1,
    particleDurationMs: 12.34,
    particleFrequencyCursor: 7,
    attackMs: 2,
    attackCurve: 'linear',
    lastRawImpacts: 20,
    lastSelectedImpacts: 8,
    lastSelectedBallVoices: 1,
    lastSelectedParticleVoices: 7,
    lastStartedVoices: 6,
    lastStartedBallVoices: 1,
    lastStartedParticleVoices: 5,
    lastStolenBallVoices: 1,
    lastStolenParticleVoices: 4,
    lastSkippedVoiceCap: 2,
    lastGainMin: Number.NaN,
    lastGainMax: 0.05,
    lastGainAverage: 0.012345,
    lastSelectedEnergyMin: Number.POSITIVE_INFINITY,
    lastSelectedEnergyMax: 123.45,
    activeGainUpperBound: 1.01,
    maxActiveGainUpperBound: 1.23456,
    possibleClipFrames: 9,
    silentFramesSoundDisabled: 10,
    silentFramesContextNotRunning: 11,
    silentFramesNoSelectedImpacts: 12,
    silentFramesVoiceCapFull: 13,
  }, 'audio');

  assert.equal(lines[0], 'dotping_debug');
  assert.equal(lines[1], 'debug_profile=audio');
  assert.ok(lines.includes('audio_context=running'));
  assert.ok(lines.includes('audio_start_spread_ms=8.0'));
  assert.ok(lines.includes('audio_trigger_test=random-step'));
  assert.ok(lines.includes('audio_trigger_shape=random'));
  assert.ok(lines.includes('audio_attack_ms=2.0'));
  assert.ok(lines.includes('audio_attack_curve=linear'));
  assert.ok(lines.includes('audio_stolen_per_sec=3'));
  assert.ok(lines.includes('audio_steal_release_ms=2.0'));
  assert.ok(lines.includes('audio_lookahead_ms=20.0'));
  assert.ok(lines.includes('audio_sample_rate=44100'));
  assert.ok(lines.includes('audio_base_latency_ms=10.0'));
  assert.ok(lines.includes('audio_output_latency_ms=n/a'));
  assert.ok(lines.includes('audio_clock_step_ms=10.16'));
  assert.ok(lines.includes('audio_clock_step_max_ms=20.30'));
  assert.ok(!lines.some((line) => line.startsWith('fps=')));
  assert.ok(lines.includes('audio_max_ball_triggers_per_frame=1'));
  assert.ok(lines.includes('audio_max_particle_triggers_per_frame=7'));
  assert.ok(lines.includes('audio_ball_frequency_hz=440.0'));
  assert.ok(lines.includes('audio_ball_spread=1.23'));
  assert.ok(lines.includes('audio_particle_duration_ms=12.3'));
  assert.ok(lines.includes('audio_gain_min=n/a'));
  assert.ok(lines.includes('audio_started_ball_voices=1'));
  assert.ok(lines.includes('audio_stolen_particle_voices=4'));
  assert.ok(lines.includes('audio_energy_min=n/a'));
  assert.ok(lines.includes('audio_possible_clip=true'));
  assert.equal(lines.at(-1), 'silent_voice_cap_full=13');
});

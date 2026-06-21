import type { ImpactEvent } from '../sim/physicsWorld';
import type { AudioWaveform, DotpingSettings } from '../sim/settings';

type AudioTuning = Pick<
  DotpingSettings,
  | 'audioBallWaveform'
  | 'audioBallFrequencyHz'
  | 'audioBallFrequencySpread'
  | 'audioBallDurationMs'
  | 'audioParticleWaveform'
  | 'audioParticleFrequencyHz'
  | 'audioParticleFrequencySpread'
  | 'audioParticleDurationMs'
>;

export type AudioDiagnostics = {
  enabled: boolean;
  contextState: AudioContextState | 'none' | 'unavailable' | 'error';
  lastResumeStatus: 'not_requested' | 'pending' | 'resolved' | 'rejected' | 'skipped_disabled';
  resumeAttempts: number;
  resumeSuccesses: number;
  resumeFailures: number;
  voiceReleaseFallbacks: number;
  stolenVoices: number;
  stealReleaseMs: number;
  activeVoices: number;
  maxVoices: number;
  activeBallVoices: number;
  maxBallVoices: number;
  activeParticleVoices: number;
  maxParticleVoices: number;
  maxTriggersPerFrame: number;
  reservedBallTriggersPerFrame: number;
  ballWaveform: AudioWaveform;
  ballFrequencyHz: number;
  ballFrequencySpread: number;
  ballDurationMs: number;
  ballFrequencyCursor: number;
  particleWaveform: AudioWaveform;
  particleFrequencyHz: number;
  particleFrequencySpread: number;
  particleDurationMs: number;
  particleFrequencyCursor: number;
  attackMs: number;
  lastRawImpacts: number;
  lastSelectedImpacts: number;
  lastSelectedBallVoices: number;
  lastSelectedParticleVoices: number;
  lastStartedVoices: number;
  lastSkippedVoiceCap: number;
  lastGainMin: number;
  lastGainMax: number;
  lastGainAverage: number;
  lastSelectedEnergyMin: number;
  lastSelectedEnergyMax: number;
  activeGainUpperBound: number;
  maxActiveGainUpperBound: number;
  possibleClipFrames: number;
  silentFramesSoundDisabled: number;
  silentFramesContextNotRunning: number;
  silentFramesNoSelectedImpacts: number;
  silentFramesVoiceCapFull: number;
};

type FrameAudioDiagnostics = Pick<
  AudioDiagnostics,
  | 'lastRawImpacts'
  | 'lastSelectedImpacts'
  | 'lastSelectedBallVoices'
  | 'lastSelectedParticleVoices'
  | 'lastStartedVoices'
  | 'lastSkippedVoiceCap'
  | 'lastGainMin'
  | 'lastGainMax'
  | 'lastGainAverage'
  | 'lastSelectedEnergyMin'
  | 'lastSelectedEnergyMax'
>;

type ActiveVoice = {
  id: number;
  family: AudioFamily;
  oscillator: OscillatorNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  fallbackTimer: number;
  startedAt: number;
  durationSeconds: number;
  volume: number;
  released: boolean;
};

type AudioFamily = 'ball' | 'particle';

type VoiceRequest = {
  family: AudioFamily;
  impact: ImpactEvent;
};

type FamilyTuning = {
  waveform: AudioWaveform;
  frequencyHz: number;
  frequencySpread: number;
  durationSeconds: number;
  frequencyTable: number[];
  frequencyCursor: number;
};

const MIN_FREQUENCY_HZ = 30;
const MAX_FREQUENCY_HZ = 10000;
const MIN_FREQUENCY_SPREAD = 1;
const MAX_FREQUENCY_SPREAD = 2;
const MIN_DURATION_MS = 1;
const MAX_DURATION_MS = 1000;
const FREQUENCY_TABLE_SIZE = 18;
const SILENCE_GAIN = 0.0001;
const ATTACK_SECONDS = 0.001;
const VOICE_STEAL_RELEASE_SECONDS = 0;
const MIN_IMPACT_GAIN = 0.0001;
const MAX_IMPACT_GAIN = 0.05;
const TABLE_SHAPE = [
  0, 0.37, 0.74, 0.16, 0.53, 0.9, 0.29, 0.66, 1,
  0.08, 0.45, 0.82, 0.21, 0.58, 0.95, 0.34, 0.71, 0.5,
];

export class AudioEngine {
  private context: AudioContext | null = null;
  private enabled = true;
  private voices = 0;
  private activeVoices: ActiveVoice[] = [];
  private voiceId = 0;
  private ballTuning: FamilyTuning = createFamilyTuning('triangle', 4000, 1, 150);
  private particleTuning: FamilyTuning = createFamilyTuning('sine', 4000, 1, 150);
  private readonly maxBallVoices = 4;
  private readonly maxParticleVoices = 16;
  private readonly maxTriggersPerFrame = 8;
  private readonly maxBallTriggersPerFrame = 1;
  private lastResumeStatus: AudioDiagnostics['lastResumeStatus'] = 'not_requested';
  private resumeAttempts = 0;
  private resumeSuccesses = 0;
  private resumeFailures = 0;
  private voiceReleaseFallbacks = 0;
  private stolenVoices = 0;
  private maxActiveGainUpperBound = 0;
  private possibleClipFrames = 0;
  private silentFramesSoundDisabled = 0;
  private silentFramesContextNotRunning = 0;
  private silentFramesNoSelectedImpacts = 0;
  private silentFramesVoiceCapFull = 0;
  private lastFrame: FrameAudioDiagnostics = createEmptyFrameDiagnostics();

  get activeVoiceCount() {
    return this.voices;
  }

  private get maxVoices() {
    return this.maxBallVoices + this.maxParticleVoices;
  }

  getDiagnostics(): AudioDiagnostics {
    const activeGainUpperBound = this.estimateActiveGainUpperBound();
    this.maxActiveGainUpperBound = Math.max(this.maxActiveGainUpperBound, activeGainUpperBound);
    if (activeGainUpperBound >= 1) {
      this.possibleClipFrames += 1;
    }

    return {
      enabled: this.enabled,
      contextState: this.context?.state ?? 'none',
      lastResumeStatus: this.lastResumeStatus,
      resumeAttempts: this.resumeAttempts,
      resumeSuccesses: this.resumeSuccesses,
      resumeFailures: this.resumeFailures,
      voiceReleaseFallbacks: this.voiceReleaseFallbacks,
      stolenVoices: this.stolenVoices,
      stealReleaseMs: VOICE_STEAL_RELEASE_SECONDS * 1000,
      activeVoices: this.voices,
      maxVoices: this.maxVoices,
      activeBallVoices: this.activeVoiceCountByFamily('ball'),
      maxBallVoices: this.maxBallVoices,
      activeParticleVoices: this.activeVoiceCountByFamily('particle'),
      maxParticleVoices: this.maxParticleVoices,
      maxTriggersPerFrame: this.maxTriggersPerFrame,
      reservedBallTriggersPerFrame: this.maxBallTriggersPerFrame,
      ballWaveform: this.ballTuning.waveform,
      ballFrequencyHz: this.ballTuning.frequencyHz,
      ballFrequencySpread: this.ballTuning.frequencySpread,
      ballDurationMs: this.ballTuning.durationSeconds * 1000,
      ballFrequencyCursor: this.ballTuning.frequencyCursor,
      particleWaveform: this.particleTuning.waveform,
      particleFrequencyHz: this.particleTuning.frequencyHz,
      particleFrequencySpread: this.particleTuning.frequencySpread,
      particleDurationMs: this.particleTuning.durationSeconds * 1000,
      particleFrequencyCursor: this.particleTuning.frequencyCursor,
      attackMs: ATTACK_SECONDS * 1000,
      lastRawImpacts: this.lastFrame.lastRawImpacts,
      lastSelectedImpacts: this.lastFrame.lastSelectedImpacts,
      lastSelectedBallVoices: this.lastFrame.lastSelectedBallVoices,
      lastSelectedParticleVoices: this.lastFrame.lastSelectedParticleVoices,
      lastStartedVoices: this.lastFrame.lastStartedVoices,
      lastSkippedVoiceCap: this.lastFrame.lastSkippedVoiceCap,
      lastGainMin: this.lastFrame.lastGainMin,
      lastGainMax: this.lastFrame.lastGainMax,
      lastGainAverage: this.lastFrame.lastGainAverage,
      lastSelectedEnergyMin: this.lastFrame.lastSelectedEnergyMin,
      lastSelectedEnergyMax: this.lastFrame.lastSelectedEnergyMax,
      activeGainUpperBound,
      maxActiveGainUpperBound: this.maxActiveGainUpperBound,
      possibleClipFrames: this.possibleClipFrames,
      silentFramesSoundDisabled: this.silentFramesSoundDisabled,
      silentFramesContextNotRunning: this.silentFramesContextNotRunning,
      silentFramesNoSelectedImpacts: this.silentFramesNoSelectedImpacts,
      silentFramesVoiceCapFull: this.silentFramesVoiceCapFull,
    };
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  setTuning(settings: AudioTuning) {
    this.ballTuning = updateFamilyTuning(this.ballTuning, {
      waveform: settings.audioBallWaveform,
      frequencyHz: settings.audioBallFrequencyHz,
      frequencySpread: settings.audioBallFrequencySpread,
      durationMs: settings.audioBallDurationMs,
    });
    this.particleTuning = updateFamilyTuning(this.particleTuning, {
      waveform: settings.audioParticleWaveform,
      frequencyHz: settings.audioParticleFrequencyHz,
      frequencySpread: settings.audioParticleFrequencySpread,
      durationMs: settings.audioParticleDurationMs,
    });
  }

  unlock() {
    if (!this.enabled) {
      this.lastResumeStatus = 'skipped_disabled';
      return;
    }

    const context = this.ensureContext();
    if (context.state === 'suspended') {
      this.lastResumeStatus = 'pending';
      this.resumeAttempts += 1;
      context.resume()
        .then(() => {
          this.lastResumeStatus = 'resolved';
          this.resumeSuccesses += 1;
        })
        .catch(() => {
          this.lastResumeStatus = 'rejected';
          this.resumeFailures += 1;
        });
    }
  }

  playImpacts(impacts: ImpactEvent[]) {
    this.lastFrame = {
      ...createEmptyFrameDiagnostics(),
      lastRawImpacts: impacts.length,
    };

    if (!this.enabled) {
      if (impacts.length > 0) {
        this.silentFramesSoundDisabled += 1;
      }
      return;
    }

    if (impacts.length === 0) {
      return;
    }

    const context = this.ensureContext();
    if (context.state !== 'running') {
      this.silentFramesContextNotRunning += 1;
      return;
    }

    const selected = this.selectVoiceRequests(impacts);
    this.lastFrame.lastSelectedImpacts = selected.length;
    this.lastFrame.lastSelectedBallVoices = selected.filter(
      (request) => request.family === 'ball',
    ).length;
    this.lastFrame.lastSelectedParticleVoices = selected.length
      - this.lastFrame.lastSelectedBallVoices;
    this.recordSelectedEnergyDiagnostics(selected.map((request) => request.impact));

    if (selected.length === 0) {
      this.silentFramesNoSelectedImpacts += 1;
      return;
    }

    const gains: number[] = [];
    for (let index = 0; index < selected.length; index += 1) {
      const request = selected[index];
      if (this.activeVoiceCountByFamily(request.family) >= this.maxVoicesForFamily(request.family)) {
        const stoleVoice = this.stealVoiceForFamily(context, request.family);
        if (!stoleVoice) {
          this.lastFrame.lastSkippedVoiceCap = selected.length - index;
          this.recordGainDiagnostics(gains);
          if (this.lastFrame.lastStartedVoices === 0) {
            this.silentFramesVoiceCapFull += 1;
          }
          return;
        }
      }

      if (this.activeVoiceCountByFamily(request.family) >= this.maxVoicesForFamily(request.family)) {
        this.lastFrame.lastSkippedVoiceCap = selected.length - index;
        this.recordGainDiagnostics(gains);
        if (this.lastFrame.lastStartedVoices === 0) {
          this.silentFramesVoiceCapFull += 1;
        }
        return;
      }
      gains.push(this.playPing(context, request));
      this.lastFrame.lastStartedVoices += 1;
    }

    this.recordGainDiagnostics(gains);
  }

  private ensureContext() {
    this.context ??= new AudioContext();
    return this.context;
  }

  private selectVoiceRequests(impacts: ImpactEvent[]) {
    const entries = impacts
      .map((impact, index) => ({ impact, index }))
      .sort((a, b) => b.impact.energy - a.impact.energy);
    const selected: VoiceRequest[] = [];
    const selectedKeys = new Set<string>();

    const addRequest = (entry: (typeof entries)[number], family: AudioFamily) => {
      if (selected.length >= this.maxTriggersPerFrame) {
        return false;
      }
      if (this.selectedRequestCountByFamily(selected, family) >= this.maxTriggersForFamily(family)) {
        return false;
      }

      const key = `${entry.index}:${family}`;
      if (selectedKeys.has(key)) {
        return false;
      }

      selected.push({ family, impact: entry.impact });
      selectedKeys.add(key);
      return true;
    };

    for (const entry of entries) {
      if (this.selectedRequestCountByFamily(selected, 'ball') >= this.maxBallTriggersPerFrame) {
        break;
      }

      const ballFamily = ballFamilyForImpact(entry.impact);
      if (ballFamily) {
        addRequest(entry, ballFamily);
      }
    }

    for (const entry of entries) {
      for (const family of familiesForImpact(entry.impact)) {
        addRequest(entry, family);
      }
      if (selected.length >= this.maxTriggersPerFrame) {
        break;
      }
    }

    return selected;
  }

  private maxTriggersForFamily(family: AudioFamily) {
    return family === 'ball'
      ? this.maxBallTriggersPerFrame
      : Math.max(0, this.maxTriggersPerFrame - this.maxBallTriggersPerFrame);
  }

  private selectedRequestCountByFamily(requests: VoiceRequest[], family: AudioFamily) {
    return requests.filter((request) => request.family === family).length;
  }

  private playPing(context: AudioContext, request: VoiceRequest) {
    this.voices += 1;

    const now = context.currentTime;
    const { family, impact } = request;
    const tuning = this.tuningForFamily(family);
    const duration = tuning.durationSeconds;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();
    const voice: ActiveVoice = {
      id: this.voiceId,
      family,
      oscillator,
      filter,
      gain,
      fallbackTimer: 0,
      startedAt: now,
      durationSeconds: duration,
      volume: 0,
      released: false,
    };
    this.voiceId += 1;

    oscillator.type = tuning.waveform;
    oscillator.frequency.value = this.nextFrequency(family);
    filter.type = 'lowpass';
    filter.frequency.value = 9000;
    filter.Q.value = 0.35;

    const volume = impactVolume(impact.energy);
    voice.volume = volume;
    const attackEnd = now + Math.min(ATTACK_SECONDS, duration);
    gain.gain.setValueAtTime(SILENCE_GAIN, now);
    gain.gain.exponentialRampToValueAtTime(volume, attackEnd);
    if (attackEnd < now + duration) {
      gain.gain.exponentialRampToValueAtTime(SILENCE_GAIN, now + duration);
    }

    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(context.destination);

    oscillator.start(now);
    oscillator.stop(now + duration);
    this.activeVoices.push(voice);
    oscillator.addEventListener('ended', () => this.releaseVoice(voice, false));
    voice.fallbackTimer = window.setTimeout(
      () => this.releaseVoice(voice, true),
      Math.ceil(duration * 1000) + 250,
    );

    return volume;
  }

  private nextFrequency(family: AudioFamily) {
    const tuning = this.tuningForFamily(family);
    const multiplier = tuning.frequencyTable[tuning.frequencyCursor % tuning.frequencyTable.length]
      ?? 1;
    tuning.frequencyCursor = (tuning.frequencyCursor + 1) % tuning.frequencyTable.length;
    return clamp(tuning.frequencyHz * multiplier, MIN_FREQUENCY_HZ, MAX_FREQUENCY_HZ);
  }

  private tuningForFamily(family: AudioFamily) {
    return family === 'particle' ? this.particleTuning : this.ballTuning;
  }

  private maxVoicesForFamily(family: AudioFamily) {
    return family === 'ball' ? this.maxBallVoices : this.maxParticleVoices;
  }

  private activeVoiceCountByFamily(family: AudioFamily) {
    return this.activeVoices.filter((voice) => voice.family === family).length;
  }

  private recordSelectedEnergyDiagnostics(selected: ImpactEvent[]) {
    if (selected.length === 0) {
      return;
    }

    let min = Number.POSITIVE_INFINITY;
    let max = 0;
    for (const impact of selected) {
      min = Math.min(min, impact.energy);
      max = Math.max(max, impact.energy);
    }
    this.lastFrame.lastSelectedEnergyMin = min;
    this.lastFrame.lastSelectedEnergyMax = max;
  }

  private recordGainDiagnostics(gains: number[]) {
    if (gains.length === 0) {
      return;
    }

    let min = Number.POSITIVE_INFINITY;
    let max = 0;
    let total = 0;
    for (const gain of gains) {
      min = Math.min(min, gain);
      max = Math.max(max, gain);
      total += gain;
    }
    this.lastFrame.lastGainMin = min;
    this.lastFrame.lastGainMax = max;
    this.lastFrame.lastGainAverage = total / gains.length;
  }

  private stealVoiceForFamily(context: AudioContext, family: AudioFamily) {
    const voice = this.oldestVoiceByFamily(family);
    if (!voice) {
      return false;
    }

    this.stolenVoices += 1;
    const now = context.currentTime;
    const releaseEnd = now + Math.max(VOICE_STEAL_RELEASE_SECONDS, 0);
    try {
      voice.gain.gain.cancelScheduledValues(now);
      if (VOICE_STEAL_RELEASE_SECONDS <= 0) {
        voice.gain.gain.setValueAtTime(0, now);
      } else {
        voice.gain.gain.setValueAtTime(this.estimateVoiceGain(voice, now), now);
        voice.gain.gain.linearRampToValueAtTime(0, releaseEnd);
      }
      voice.oscillator.stop(releaseEnd);
    } catch {
      this.releaseVoice(voice, false);
    }
    this.releaseVoice(voice, false, Math.ceil(VOICE_STEAL_RELEASE_SECONDS * 1000) + 20);
    return true;
  }

  private oldestVoiceByFamily(family: AudioFamily) {
    return this.activeVoices.find((voice) => voice.family === family) ?? null;
  }

  private releaseVoice(voice: ActiveVoice, fromFallback: boolean, delayMs = 0) {
    if (voice.released) {
      return;
    }

    voice.released = true;
    window.clearTimeout(voice.fallbackTimer);
    this.activeVoices = this.activeVoices.filter((activeVoice) => activeVoice.id !== voice.id);
    if (fromFallback) {
      this.voiceReleaseFallbacks += 1;
    }
    this.voices = Math.max(0, this.voices - 1);

    if (delayMs > 0) {
      window.setTimeout(() => this.disconnectVoice(voice), delayMs);
      return;
    }

    this.disconnectVoice(voice);
  }

  private disconnectVoice(voice: ActiveVoice) {
    try {
      voice.oscillator.disconnect();
      voice.filter.disconnect();
      voice.gain.disconnect();
    } catch {
      // Some browsers may already have disconnected a node when a release path
      // races with the audio-ended callback.
    }
  }

  private estimateActiveGainUpperBound() {
    const now = this.context?.currentTime ?? 0;
    let total = 0;
    for (const voice of this.activeVoices) {
      total += this.estimateVoiceGain(voice, now);
    }
    return total;
  }

  private estimateVoiceGain(voice: ActiveVoice, now: number) {
    const elapsed = Math.max(0, now - voice.startedAt);
    if (elapsed >= voice.durationSeconds) {
      return 0;
    }
    const startGain = Math.max(voice.volume, SILENCE_GAIN);
    const progress = elapsed / Math.max(voice.durationSeconds, 0.001);
    return startGain * (SILENCE_GAIN / startGain) ** progress;
  }

}

function createEmptyFrameDiagnostics(): FrameAudioDiagnostics {
  return {
    lastRawImpacts: 0,
    lastSelectedImpacts: 0,
    lastSelectedBallVoices: 0,
    lastSelectedParticleVoices: 0,
    lastStartedVoices: 0,
    lastSkippedVoiceCap: 0,
    lastGainMin: 0,
    lastGainMax: 0,
    lastGainAverage: 0,
    lastSelectedEnergyMin: 0,
    lastSelectedEnergyMax: 0,
  };
}

function impactVolume(energy: number) {
  const normalized = Math.log1p(Math.max(energy, 0) / 55) / Math.log1p(1800 / 55);
  return Math.min(
    MIN_IMPACT_GAIN + normalized ** 1.25 * (MAX_IMPACT_GAIN - MIN_IMPACT_GAIN),
    MAX_IMPACT_GAIN,
  );
}

function createFrequencyTable(spread: number) {
  if (spread <= 1) {
    return Array.from({ length: FREQUENCY_TABLE_SIZE }, () => 1);
  }

  const logSpread = Math.log(spread);
  return TABLE_SHAPE.map((normalized) => Math.exp(logSpread * normalized));
}

function createFamilyTuning(
  waveform: AudioWaveform,
  frequencyHz: number,
  frequencySpread: number,
  durationMs: number,
): FamilyTuning {
  const spread = clamp(frequencySpread, MIN_FREQUENCY_SPREAD, MAX_FREQUENCY_SPREAD);
  return {
    waveform,
    frequencyHz: clamp(frequencyHz, MIN_FREQUENCY_HZ, MAX_FREQUENCY_HZ),
    frequencySpread: spread,
    durationSeconds: clamp(durationMs, MIN_DURATION_MS, MAX_DURATION_MS) / 1000,
    frequencyTable: createFrequencyTable(spread),
    frequencyCursor: 0,
  };
}

function updateFamilyTuning(
  current: FamilyTuning,
  next: {
    waveform: AudioWaveform;
    frequencyHz: number;
    frequencySpread: number;
    durationMs: number;
  },
): FamilyTuning {
  const frequencyHz = clamp(next.frequencyHz, MIN_FREQUENCY_HZ, MAX_FREQUENCY_HZ);
  const frequencySpread = clamp(next.frequencySpread, MIN_FREQUENCY_SPREAD, MAX_FREQUENCY_SPREAD);
  const durationSeconds = clamp(next.durationMs, MIN_DURATION_MS, MAX_DURATION_MS) / 1000;

  if (
    current.waveform === next.waveform &&
    current.frequencyHz === frequencyHz &&
    current.frequencySpread === frequencySpread &&
    current.durationSeconds === durationSeconds
  ) {
    return current;
  }

  return {
    waveform: next.waveform,
    frequencyHz,
    frequencySpread,
    durationSeconds,
    frequencyTable: frequencySpread === current.frequencySpread
      ? current.frequencyTable
      : createFrequencyTable(frequencySpread),
    frequencyCursor: frequencySpread === current.frequencySpread ? current.frequencyCursor : 0,
  };
}

function familiesForImpact(impact: ImpactEvent): AudioFamily[] {
  switch (impact.kind) {
    case 'ball-wall':
      return ['ball'];
    case 'ball-particle':
      return ['ball', 'particle'];
    case 'particle-wall':
    case 'particle-particle':
    default:
      return ['particle'];
  }
}

function ballFamilyForImpact(impact: ImpactEvent): AudioFamily | null {
  return impact.kind === 'ball-wall' || impact.kind === 'ball-particle' ? 'ball' : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

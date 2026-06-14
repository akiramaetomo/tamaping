import type { ImpactEvent } from '../sim/physicsWorld';
import type { DotpingSettings } from '../sim/settings';

type AudioTuning = Pick<
  DotpingSettings,
  'audioFrequencyHz' | 'audioFrequencySpread' | 'audioDurationMs'
>;

const MIN_FREQUENCY_HZ = 100;
const MAX_FREQUENCY_HZ = 10000;
const MIN_FREQUENCY_SPREAD = 1;
const MAX_FREQUENCY_SPREAD = 2;
const MIN_DURATION_MS = 1;
const MAX_DURATION_MS = 1000;
const FREQUENCY_TABLE_SIZE = 18;
const SILENCE_GAIN = 0.0001;
const TABLE_SHAPE = [
  0, 0.37, 0.74, 0.16, 0.53, 0.9, 0.29, 0.66, 1,
  0.08, 0.45, 0.82, 0.21, 0.58, 0.95, 0.34, 0.71, 0.5,
];

export class AudioEngine {
  private context: AudioContext | null = null;
  private enabled = true;
  private voices = 0;
  private audioFrequencyHz = 4000;
  private audioFrequencySpread = 1;
  private audioDurationSeconds = 0.15;
  private frequencyTable = createFrequencyTable(this.audioFrequencySpread);
  private frequencyCursor = 0;
  private readonly maxVoices = 18;
  private readonly maxTriggersPerFrame = 8;

  get activeVoiceCount() {
    return this.voices;
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  setTuning(settings: AudioTuning) {
    const frequencyHz = clamp(settings.audioFrequencyHz, MIN_FREQUENCY_HZ, MAX_FREQUENCY_HZ);
    const frequencySpread = clamp(
      settings.audioFrequencySpread,
      MIN_FREQUENCY_SPREAD,
      MAX_FREQUENCY_SPREAD,
    );
    const durationMs = clamp(settings.audioDurationMs, MIN_DURATION_MS, MAX_DURATION_MS);

    if (frequencySpread !== this.audioFrequencySpread) {
      this.frequencyTable = createFrequencyTable(frequencySpread);
      this.frequencyCursor = 0;
    }

    this.audioFrequencyHz = frequencyHz;
    this.audioFrequencySpread = frequencySpread;
    this.audioDurationSeconds = durationMs / 1000;
  }

  unlock() {
    if (!this.enabled) {
      return;
    }

    const context = this.ensureContext();
    if (context.state === 'suspended') {
      void context.resume();
    }
  }

  playImpacts(impacts: ImpactEvent[]) {
    if (!this.enabled || impacts.length === 0) {
      return;
    }

    const context = this.ensureContext();
    if (context.state !== 'running') {
      return;
    }

    const selected = [...impacts]
      .sort((a, b) => b.energy - a.energy)
      .slice(0, this.maxTriggersPerFrame);

    for (const impact of selected) {
      if (this.voices >= this.maxVoices) {
        return;
      }
      this.playPing(context, impact);
    }
  }

  private ensureContext() {
    this.context ??= new AudioContext();
    return this.context;
  }

  private playPing(context: AudioContext, impact: ImpactEvent) {
    this.voices += 1;

    const now = context.currentTime;
    const duration = this.audioDurationSeconds;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const filter = context.createBiquadFilter();

    oscillator.type = impact.kind === 'particle' ? 'triangle' : 'sine';
    oscillator.frequency.value = this.nextFrequency();
    filter.type = 'lowpass';
    filter.frequency.value = 9000;
    filter.Q.value = 0.35;

    const volume = impactVolume(impact.energy);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(SILENCE_GAIN, now + duration);

    oscillator.connect(filter);
    filter.connect(gain);
    gain.connect(context.destination);

    oscillator.start(now);
    oscillator.stop(now + duration);
    oscillator.addEventListener('ended', () => {
      this.voices = Math.max(0, this.voices - 1);
      oscillator.disconnect();
      filter.disconnect();
      gain.disconnect();
    });
  }

  private nextFrequency() {
    const multiplier = this.frequencyTable[this.frequencyCursor % this.frequencyTable.length] ?? 1;
    this.frequencyCursor = (this.frequencyCursor + 1) % this.frequencyTable.length;
    return clamp(this.audioFrequencyHz * multiplier, MIN_FREQUENCY_HZ, MAX_FREQUENCY_HZ);
  }
}

function impactVolume(energy: number) {
  const normalized = Math.log1p(Math.max(energy, 0) / 55) / Math.log1p(1800 / 55);
  return Math.min(0.004 + normalized ** 1.25 * 0.28, 0.34);
}

function createFrequencyTable(spread: number) {
  if (spread <= 1) {
    return Array.from({ length: FREQUENCY_TABLE_SIZE }, () => 1);
  }

  const logSpread = Math.log(spread);
  return TABLE_SHAPE.map((normalized) => Math.exp(logSpread * normalized));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

export type CollisionMode = 'independence-overlapping' | 'collision-physical';
export type ParticlePalette =
  | 'blue'
  | 'green'
  | 'yellow'
  | 'red'
  | 'pink'
  | 'orange'
  | 'white'
  | 'pastel'
  | 'colorful';
export type ParticleGlowMode =
  | 'gold'
  | 'white'
  | 'cyan'
  | 'pink'
  | 'red'
  | 'green'
  | 'rainbow';
export type BallPalette =
  | 'black'
  | 'blue'
  | 'green'
  | 'yellow'
  | 'red'
  | 'pink'
  | 'orange'
  | 'white';
export type ControlBallMode = 'persistent' | 'touch';
export type DotCombiMode = 'off' | 'velocity';
export type GravityMode = 'none' | 'gravity' | 'antigravity';
export type ColliderLayout = 'split' | 'single';
export type AudioWaveform = 'sine' | 'triangle' | 'sawtooth' | 'square';
export type AudioTriggerSpreadMs = 0 | 16;

export type DotpingSettings = {
  collisionMode: CollisionMode;
  particlePalette: ParticlePalette;
  dotCombiMode: DotCombiMode;
  gravityMode: GravityMode;
  gravityStrength: number;
  particleCount: number;
  particleRadius: number;
  particleMass: number;
  particleLeaderVisible: boolean;
  particleRimWidth: number;
  particleBrightnessResponse: number;
  particleGlowMode: ParticleGlowMode;
  particleGlowVividness: number;
  contactRestitution: number;
  particleFriction: number;
  particleLinearDamping: number;
  controlBallPalette: BallPalette;
  controlBallRimEnabled: boolean;
  controlBallMode: ControlBallMode;
  controlBallRadius: number;
  controlBallMass: number;
  controlBallFriction: number;
  controlBallLinearDamping: number;
  controlBallMaxSpeed: number;
  pointerVelocityScale: number;
  wallRestitution: number;
  rapierLengthUnit: number;
  colliderLayout: ColliderLayout;
  soundEnabled: boolean;
  audioBallWaveform: AudioWaveform;
  audioBallFrequencyHz: number;
  audioBallFrequencySpread: number;
  audioBallDurationMs: number;
  audioParticleWaveform: AudioWaveform;
  audioParticleFrequencyHz: number;
  audioParticleFrequencySpread: number;
  audioParticleDurationMs: number;
  audioTriggerSpreadMs: AudioTriggerSpreadMs;
  debug: boolean;
};

export const DEFAULT_SETTINGS: DotpingSettings = {
  collisionMode: 'collision-physical',
  particlePalette: 'blue',
  dotCombiMode: 'off',
  gravityMode: 'none',
  gravityStrength: 1,
  particleCount: 500,
  particleRadius: 8,
  particleMass: 0.15,
  particleLeaderVisible: false,
  particleRimWidth: 100,
  particleBrightnessResponse: 10,
  particleGlowMode: 'gold',
  particleGlowVividness: 0.85,
  contactRestitution: 0.3,
  particleFriction: 0.02,
  particleLinearDamping: 0.01,
  controlBallPalette: 'blue',
  controlBallRimEnabled: true,
  controlBallMode: 'persistent',
  controlBallRadius: 52,
  controlBallMass: 100,
  controlBallFriction: 0.02,
  controlBallLinearDamping: 0.04,
  controlBallMaxSpeed: 5200,
  pointerVelocityScale: 1,
  wallRestitution: 0.3,
  rapierLengthUnit: 1,
  colliderLayout: 'split',
  soundEnabled: true,
  audioBallWaveform: 'triangle',
  audioBallFrequencyHz: 4000,
  audioBallFrequencySpread: 1,
  audioBallDurationMs: 150,
  audioParticleWaveform: 'sine',
  audioParticleFrequencyHz: 4000,
  audioParticleFrequencySpread: 1,
  audioParticleDurationMs: 150,
  audioTriggerSpreadMs: 0,
  debug: false,
};

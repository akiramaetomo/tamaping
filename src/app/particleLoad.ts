export type ParticleLoadLevel = 'normal' | 'dense' | 'heavy' | 'extreme';

export type ParticleLoadEstimate = {
  level: ParticleLoadLevel;
  fillRatio: number;
};

export type ParticleLoadInput = {
  width: number;
  height: number;
  particleCount: number;
  particleRadius: number;
};

export const PARTICLE_LOAD_DENSE_FILL_RATIO = 1;
export const PARTICLE_LOAD_HEAVY_FILL_RATIO = 2;
export const PARTICLE_LOAD_EXTREME_FILL_RATIO = 4;
export const PARTICLE_LOAD_HEAVY_COUNT = 2000;
export const PARTICLE_LOAD_EXTREME_COUNT = 5000;
export const PARTICLE_LOAD_EXTREME_RADIUS = 10;
export const PARTICLE_LOAD_VALUE_CLASSES = [
  'hud__value--load-dense',
  'hud__value--load-heavy',
  'hud__value--load-extreme',
] as const;

export function estimateParticleLoad(input: ParticleLoadInput): ParticleLoadEstimate {
  const area = Math.max(Math.max(input.width, 0) * Math.max(input.height, 0), 1);
  const particleCount = Math.max(input.particleCount, 0);
  const radius = Math.max(input.particleRadius, 0);
  const fillRatio = particleCount <= 0
    ? 0
    : (particleCount * Math.PI * radius * radius) / area;

  if (
    fillRatio >= PARTICLE_LOAD_EXTREME_FILL_RATIO ||
    (particleCount >= PARTICLE_LOAD_EXTREME_COUNT && radius >= PARTICLE_LOAD_EXTREME_RADIUS)
  ) {
    return { level: 'extreme', fillRatio };
  }

  if (fillRatio >= PARTICLE_LOAD_HEAVY_FILL_RATIO || particleCount >= PARTICLE_LOAD_HEAVY_COUNT) {
    return { level: 'heavy', fillRatio };
  }

  if (fillRatio >= PARTICLE_LOAD_DENSE_FILL_RATIO) {
    return { level: 'dense', fillRatio };
  }

  return { level: 'normal', fillRatio };
}

export function particleLoadLabel(level: ParticleLoadLevel) {
  switch (level) {
    case 'dense':
      return 'Dense';
    case 'heavy':
      return 'Heavy';
    case 'extreme':
      return 'Extreme';
    case 'normal':
    default:
      return 'Normal';
  }
}

export function particleLoadTitle(load: ParticleLoadEstimate) {
  return `Particle load: ${particleLoadLabel(load.level)} (${load.fillRatio.toFixed(2)}x fill)`;
}

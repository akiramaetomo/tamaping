// What a preset shows at its first moment: where the particles and the Ball
// start, and how fast they move off. Spec: `Proposed Preset Start State`.
// Each value changes one thing only. The speed sliders set how fast; the
// formation sets the direction as part of its shape.

export type StartFormation = 'random' | 'spiral' | 'name';

export type PresetStart = {
  formation: StartFormation;
  // Ball start position, as 0..100 % of the playfield width and height.
  ballX: number;
  ballY: number;
  // Start speeds in world px/s. Direction is random, except along the spiral.
  ballSpeed: number;
  particleSpeed: number;
};

// The factory-data field the start replaces.
export type LegacyInitialFormation = 'random' | 'flash' | 'name';

export const START_FORMATIONS: ReadonlyArray<[StartFormation, string]> = [
  ['random', 'Random'],
  ['spiral', 'Spiral'],
  ['name', 'Name'],
];

export const START_POSITION_MAX = 100;
export const START_BALL_SPEED_MAX = 1000;
export const START_BALL_SPEED_STEP = 10;
export const START_PARTICLE_SPEED_MAX = 300;
export const START_PARTICLE_SPEED_STEP = 1;
// About the average speed of the old fresh-scene scatter (+-30 px/s per axis).
export const START_SCATTER_SPEED = 25;
// Average of the old Flash spin, 36 px/s times 0.65..0.93.
export const START_SPIRAL_SPEED = 28;

// Used for presets and files without a start, and when nothing was applied.
// It matches a freshly built scene: scatter, Ball at its usual spot.
export const DEFAULT_PRESET_START: PresetStart = {
  formation: 'random',
  ballX: 50,
  ballY: 68,
  ballSpeed: 0,
  particleSpeed: START_SCATTER_SPEED,
};

export function startFromInitialFormation(
  initialFormation: LegacyInitialFormation | null | undefined,
): PresetStart {
  if (initialFormation === 'name') {
    return { ...DEFAULT_PRESET_START, formation: 'name', particleSpeed: 0 };
  }
  if (initialFormation === 'flash') {
    return { ...DEFAULT_PRESET_START, formation: 'spiral', particleSpeed: START_SPIRAL_SPEED };
  }
  return { ...DEFAULT_PRESET_START };
}

export function normalizePresetStart(value: unknown): PresetStart {
  const source = value && typeof value === 'object' ? (value as Partial<PresetStart>) : {};
  const base = DEFAULT_PRESET_START;
  return {
    formation: START_FORMATIONS.some(([id]) => id === source.formation)
      ? (source.formation as StartFormation)
      : base.formation,
    ballX: numberInRange(source.ballX, base.ballX, 0, START_POSITION_MAX),
    ballY: numberInRange(source.ballY, base.ballY, 0, START_POSITION_MAX),
    ballSpeed: numberInRange(source.ballSpeed, base.ballSpeed, 0, START_BALL_SPEED_MAX),
    particleSpeed: numberInRange(source.particleSpeed, base.particleSpeed, 0, START_PARTICLE_SPEED_MAX),
  };
}

export function presetStartsEqual(a: PresetStart, b: PresetStart) {
  return a.formation === b.formation
    && a.ballX === b.ballX
    && a.ballY === b.ballY
    && a.ballSpeed === b.ballSpeed
    && a.particleSpeed === b.particleSpeed;
}

// Ball centre for a start, kept one radius inside the walls.
export function startBallPosition(
  start: Pick<PresetStart, 'ballX' | 'ballY'>,
  width: number,
  height: number,
  radius: number,
) {
  return {
    x: clampInside((start.ballX / START_POSITION_MAX) * width, radius, width),
    y: clampInside((start.ballY / START_POSITION_MAX) * height, radius, height),
  };
}

export function randomDirectionVelocity(speed: number, random: () => number = Math.random) {
  if (speed <= 0) {
    return { vx: 0, vy: 0 };
  }
  const angle = random() * Math.PI * 2;
  return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
}

// The old Flash spin gave particle i a speed of 0.65 + (i % 5) * 0.07 times
// 36 px/s, and none to No. 1. Dividing by the mean (0.79) keeps those small
// differences while the slider value stays the average speed.
const SPIRAL_SPEED_MEAN = 0.79;

export function spiralSpeedFactor(index: number) {
  if (index === 0) {
    return 0;
  }
  return (0.65 + (index % 5) * 0.07) / SPIRAL_SPEED_MEAN;
}

function numberInRange(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function clampInside(value: number, radius: number, size: number) {
  if (size <= radius * 2) {
    return size / 2;
  }
  return Math.min(size - radius, Math.max(radius, value));
}

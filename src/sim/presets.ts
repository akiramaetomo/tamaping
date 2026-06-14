import { DEFAULT_SETTINGS, type BallPalette, type DotpingSettings } from './settings';

export const FACTORY_PRESET_COUNT = 10;
export const USER_PRESET_COUNT = 20;
export const PRESET_EXPORT_SCHEMA_VERSION = 1;

const USER_PRESET_STORAGE_KEY = 'dotping.userPresets.v1';
const EXPORT_KIND = 'dotping-presets';
const BALL_PALETTES: readonly BallPalette[] = [
  'black-hole',
  'calm-blue',
  'solar-yellow',
  'red-core',
  'pink-glow',
  'white-star',
];
const CONTROL_BALL_RADIUS_MIN = 2;
const CONTROL_BALL_RADIUS_MAX = 200;

export type PresetSettings = Pick<
  DotpingSettings,
  | 'collisionMode'
  | 'particlePalette'
  | 'dotCombiMode'
  | 'gravityMode'
  | 'gravityStrength'
  | 'particleCount'
  | 'particleRadius'
  | 'particleLeaderVisible'
  | 'particleBrightnessResponse'
  | 'particleGlowMode'
  | 'particleGlowVividness'
  | 'contactRestitution'
  | 'particleFriction'
  | 'particleLinearDamping'
  | 'controlBallPalette'
  | 'controlBallRimEnabled'
  | 'controlBallMode'
  | 'controlBallRadius'
  | 'controlBallMass'
  | 'controlBallFriction'
  | 'controlBallLinearDamping'
  | 'wallRestitution'
  | 'audioFrequencyHz'
  | 'audioFrequencySpread'
  | 'audioDurationMs'
>;

export type FactoryPreset = {
  id: string;
  name: string;
  settings: PresetSettings;
};

export type UserPreset = {
  name: string;
  settings: PresetSettings;
};

export type PresetExportFile = {
  kind: typeof EXPORT_KIND;
  schemaVersion: typeof PRESET_EXPORT_SCHEMA_VERSION;
  exportedAt: string;
  source: 'current' | 'user-presets';
  presets: UserPreset[];
};

const DEFAULT_PRESET = presetFromSettings(DEFAULT_SETTINGS);

const FACTORY_PRESET_DEFINITIONS: FactoryPreset[] = [
  {
    id: 'factory-1',
    name: '1. Hello Ping',
    settings: {
      ...DEFAULT_PRESET,
      particlePalette: 'colorful',
      particleCount: 100,
      particleRadius: 12,
      controlBallRadius: 64,
      controlBallMass: 200.0000000000001,
      controlBallLinearDamping: 0.45630000000000004,
      wallRestitution: 0.96,
    },
  },
  {
    id: 'factory-2',
    name: '2. Blue Ball',
    settings: {
      ...DEFAULT_PRESET,
      particleCount: 30,
      particleRadius: 25,
      controlBallRadius: 60,
    },
  },
  {
    id: 'factory-3',
    name: '3. Blue Sand Chaser',
    settings: {
      ...DEFAULT_PRESET,
      gravityMode: 'gravity',
      particleCount: 1000,
      particleRadius: 2,
      controlBallRadius: 60,
    },
  },
  {
    id: 'factory-4',
    name: '4. Pink Sand Chaser',
    settings: {
      ...DEFAULT_PRESET,
      particlePalette: 'pink',
      gravityMode: 'gravity',
      particleCount: 1000,
      particleRadius: 2,
      controlBallRadius: 50,
      controlBallMass: 16.783951546061342,
      wallRestitution: 0,
    },
  },
  {
    id: 'factory-5',
    name: '5. Red Space',
    settings: {
      ...DEFAULT_PRESET,
      particlePalette: 'red',
      gravityMode: 'antigravity',
      particleCount: 500,
      particleRadius: 8,
      contactRestitution: 0.84,
      controlBallRadius: 50,
      controlBallMass: 16.783951546061342,
      wallRestitution: 0,
    },
  },
  {
    id: 'factory-6',
    name: '6. Colorful Space',
    settings: {
      ...DEFAULT_PRESET,
      particlePalette: 'colorful',
      gravityMode: 'antigravity',
      gravityStrength: 0.15,
      particleCount: 1000,
      particleRadius: 5,
      contactRestitution: 0.84,
      controlBallRadius: 30,
      controlBallMass: 0.7552208629864727,
      wallRestitution: 1,
    },
  },
  {
    id: 'factory-7',
    name: '7. Colorful Strange Power',
    settings: {
      ...DEFAULT_PRESET,
      particlePalette: 'colorful',
      gravityMode: 'gravity',
      gravityStrength: 1.95,
      particleCount: 500,
      particleRadius: 7,
      contactRestitution: 0,
      particleFriction: 0,
      particleLinearDamping: 3,
      controlBallRadius: 50,
      controlBallMass: 2.188860974544065,
      controlBallFriction: 0,
      controlBallLinearDamping: 0,
      wallRestitution: 1,
    },
  },
  {
    id: 'factory-8',
    name: '8. Playing with snakes',
    settings: {
      ...DEFAULT_PRESET,
      collisionMode: 'independence-overlapping',
      particlePalette: 'colorful',
      dotCombiMode: 'velocity',
      gravityStrength: 1.75,
      particleCount: 100,
      particleRadius: 18,
      contactRestitution: 1,
      particleFriction: 0,
      particleLinearDamping: 0,
      controlBallRadius: 88,
      controlBallMass: 0.6687403049764221,
      controlBallFriction: 0,
      controlBallLinearDamping: 0,
      wallRestitution: 0.91,
    },
  },
  {
    id: 'factory-9',
    name: '9. Snakes playing',
    settings: {
      ...DEFAULT_PRESET,
      collisionMode: 'independence-overlapping',
      particlePalette: 'colorful',
      dotCombiMode: 'velocity',
      gravityMode: 'gravity',
      gravityStrength: 1.1,
      particleCount: 100,
      particleRadius: 26,
      contactRestitution: 1,
      particleFriction: 0,
      particleLinearDamping: 0,
      controlBallRadius: 72,
      controlBallMass: 0.10000000000000002,
      controlBallFriction: 0,
      controlBallLinearDamping: 0,
      wallRestitution: 1,
    },
  },
  {
    id: 'factory-10',
    name: '10. Sparse Bounce',
    settings: {
      ...DEFAULT_PRESET,
      particlePalette: 'pastel',
      particleCount: 100,
      particleRadius: 14,
      contactRestitution: 0.88,
      particleFriction: 0,
      particleLinearDamping: 0,
      controlBallRadius: 58,
      controlBallMass: 120,
      controlBallFriction: 0,
      controlBallLinearDamping: 0,
      wallRestitution: 0.92,
    },
  },
];

export const FACTORY_PRESETS = FACTORY_PRESET_DEFINITIONS.slice(0, FACTORY_PRESET_COUNT);

export function presetFromSettings(settings: DotpingSettings): PresetSettings {
  return {
    collisionMode: settings.collisionMode,
    particlePalette: settings.particlePalette,
    dotCombiMode: settings.dotCombiMode,
    gravityMode: settings.gravityMode,
    gravityStrength: settings.gravityStrength,
    particleCount: settings.particleCount,
    particleRadius: settings.particleRadius,
    particleLeaderVisible: settings.particleLeaderVisible,
    particleBrightnessResponse: settings.particleBrightnessResponse,
    particleGlowMode: settings.particleGlowMode,
    particleGlowVividness: settings.particleGlowVividness,
    contactRestitution: settings.contactRestitution,
    particleFriction: settings.particleFriction,
    particleLinearDamping: settings.particleLinearDamping,
    controlBallPalette: settings.controlBallPalette,
    controlBallRimEnabled: settings.controlBallRimEnabled,
    controlBallMode: settings.controlBallMode,
    controlBallRadius: settings.controlBallRadius,
    controlBallMass: settings.controlBallMass,
    controlBallFriction: settings.controlBallFriction,
    controlBallLinearDamping: settings.controlBallLinearDamping,
    wallRestitution: settings.wallRestitution,
    audioFrequencyHz: settings.audioFrequencyHz,
    audioFrequencySpread: settings.audioFrequencySpread,
    audioDurationMs: settings.audioDurationMs,
  };
}

export function loadUserPresets(): Array<UserPreset | null> {
  const empty = emptyUserPresetSlots();
  const raw = readUserPresetStorage();
  if (!raw) {
    return empty;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return empty;
    }

    return empty.map((_, index) => normalizeUserPreset(parsed[index]));
  } catch {
    return empty;
  }
}

export function saveUserPreset(
  presets: Array<UserPreset | null>,
  index: number,
  name: string,
  settings: PresetSettings,
) {
  const next = copyUserPresetSlots(presets);
  next[index] = {
    name: sanitizePresetName(name, index),
    settings: normalizePresetSettings(settings),
  };
  writeUserPresetStorage(next);
  return next;
}

export function importUserPresets(
  current: Array<UserPreset | null>,
  incoming: UserPreset[],
  overwriteStartIndex: number | null,
) {
  const next = copyUserPresetSlots(current);
  let imported = 0;
  let overwriteOffset = 0;

  for (const preset of incoming) {
    const emptySlot = firstEmptySlot(next);
    const target = emptySlot ?? nextOverwriteSlot(overwriteStartIndex, overwriteOffset);
    if (target === null || target >= USER_PRESET_COUNT) {
      break;
    }

    if (emptySlot === null) {
      overwriteOffset += 1;
    }

    next[target] = {
      name: sanitizePresetName(preset.name, target),
      settings: normalizePresetSettings(preset.settings),
    };
    imported += 1;
  }

  writeUserPresetStorage(next);
  return { presets: next, imported };
}

export function parsePresetExport(jsonText: string): UserPreset[] {
  const parsed = JSON.parse(jsonText);
  const sourcePresets = Array.isArray(parsed)
    ? parsed
    : isPresetExportLike(parsed)
      ? parsed.presets
      : [];

  return sourcePresets
    .map((preset, index) => normalizeUserPreset(preset, index))
    .filter((preset): preset is UserPreset => Boolean(preset));
}

export function createCurrentPresetExport(
  name: string,
  settings: DotpingSettings,
): PresetExportFile {
  return createPresetExport('current', [
    {
      name: name.trim() || 'Current',
      settings: presetFromSettings(settings),
    },
  ]);
}

export function createUserPresetExport(
  presets: Array<UserPreset | null>,
): PresetExportFile {
  return createPresetExport(
    'user-presets',
    presets.filter((preset): preset is UserPreset => Boolean(preset)),
  );
}

function createPresetExport(
  source: PresetExportFile['source'],
  presets: UserPreset[],
): PresetExportFile {
  return {
    kind: EXPORT_KIND,
    schemaVersion: PRESET_EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    source,
    presets: presets.map((preset, index) => ({
      name: sanitizePresetName(preset.name, index),
      settings: normalizePresetSettings(preset.settings),
    })),
  };
}

function readUserPresetStorage() {
  try {
    return window.localStorage.getItem(USER_PRESET_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeUserPresetStorage(presets: Array<UserPreset | null>) {
  try {
    window.localStorage.setItem(USER_PRESET_STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // Keep in-memory presets for the current session even if storage fails.
  }
}

function emptyUserPresetSlots(): Array<UserPreset | null> {
  return Array.from({ length: USER_PRESET_COUNT }, () => null);
}

function copyUserPresetSlots(presets: Array<UserPreset | null>) {
  const next = emptyUserPresetSlots();
  for (let i = 0; i < next.length; i += 1) {
    next[i] = presets[i] ?? null;
  }
  return next;
}

function firstEmptySlot(presets: Array<UserPreset | null>) {
  const index = presets.findIndex((preset) => preset === null);
  return index >= 0 ? index : null;
}

function nextOverwriteSlot(start: number | null, offset: number) {
  if (start === null) {
    return null;
  }
  return start + offset;
}

function normalizeUserPreset(value: unknown, index = 0): UserPreset | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<UserPreset>;
  if (!candidate.settings || typeof candidate.settings !== 'object') {
    return null;
  }

  const settings = normalizePresetSettings(candidate.settings);
  return {
    name: sanitizePresetName(candidate.name, index),
    settings,
  };
}

function normalizePresetSettings(value: unknown): PresetSettings {
  const source = value && typeof value === 'object' ? (value as Partial<PresetSettings>) : {};
  const base = DEFAULT_PRESET;

  return {
    collisionMode: source.collisionMode === 'independence-overlapping'
      ? 'independence-overlapping'
      : source.collisionMode === 'collision-physical'
        ? 'collision-physical'
        : base.collisionMode,
    particlePalette: oneOf(source.particlePalette, ['blue', 'red', 'pastel', 'colorful', 'pink'])
      ?? base.particlePalette,
    dotCombiMode: oneOf(source.dotCombiMode, ['off', 'velocity']) ?? base.dotCombiMode,
    gravityMode: oneOf(source.gravityMode, ['none', 'gravity', 'antigravity'])
      ?? base.gravityMode,
    gravityStrength: finiteNumber(source.gravityStrength, base.gravityStrength),
    particleCount: finiteNumber(source.particleCount, base.particleCount),
    particleRadius: finiteNumber(source.particleRadius, base.particleRadius),
    particleLeaderVisible: booleanValue(
      source.particleLeaderVisible,
      base.particleLeaderVisible,
    ),
    particleBrightnessResponse: finiteNumberInRange(
      source.particleBrightnessResponse,
      base.particleBrightnessResponse,
      0,
      100,
    ),
    particleGlowMode: oneOf(source.particleGlowMode, [
      'gold',
      'white',
      'cyan',
      'pink',
      'red',
      'green',
      'rainbow',
    ]) ?? base.particleGlowMode,
    particleGlowVividness: finiteNumberInRange(
      source.particleGlowVividness,
      base.particleGlowVividness,
      0,
      2,
    ),
    contactRestitution: finiteNumber(source.contactRestitution, base.contactRestitution),
    particleFriction: finiteNumber(source.particleFriction, base.particleFriction),
    particleLinearDamping: finiteNumber(
      source.particleLinearDamping,
      base.particleLinearDamping,
    ),
    controlBallPalette: oneOf(source.controlBallPalette, BALL_PALETTES)
      ?? base.controlBallPalette,
    controlBallRimEnabled: booleanValue(
      source.controlBallRimEnabled,
      base.controlBallRimEnabled,
    ),
    controlBallMode: oneOf(source.controlBallMode, ['persistent', 'touch'])
      ?? base.controlBallMode,
    controlBallRadius: finiteNumberInRange(
      source.controlBallRadius,
      base.controlBallRadius,
      CONTROL_BALL_RADIUS_MIN,
      CONTROL_BALL_RADIUS_MAX,
    ),
    controlBallMass: finiteNumber(source.controlBallMass, base.controlBallMass),
    controlBallFriction: finiteNumber(source.controlBallFriction, base.controlBallFriction),
    controlBallLinearDamping: finiteNumber(
      source.controlBallLinearDamping,
      base.controlBallLinearDamping,
    ),
    wallRestitution: finiteNumber(source.wallRestitution, base.wallRestitution),
    audioFrequencyHz: finiteNumber(source.audioFrequencyHz, base.audioFrequencyHz),
    audioFrequencySpread: finiteNumber(source.audioFrequencySpread, base.audioFrequencySpread),
    audioDurationMs: finiteNumber(source.audioDurationMs, base.audioDurationMs),
  };
}

function sanitizePresetName(name: unknown, index: number) {
  if (typeof name !== 'string') {
    return `User ${index + 1}`;
  }

  const trimmed = name.trim();
  return trimmed ? trimmed.slice(0, 40) : `User ${index + 1}`;
}

function oneOf<T extends string>(value: unknown, choices: readonly T[]) {
  return choices.includes(value as T) ? (value as T) : null;
}

function booleanValue(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

function finiteNumber(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function finiteNumberInRange(value: unknown, fallback: number, min: number, max: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(min, Math.min(value, max));
}

function isPresetExportLike(value: unknown): value is { presets: unknown[] } {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<PresetExportFile>;
  return candidate.kind === EXPORT_KIND && Array.isArray(candidate.presets);
}

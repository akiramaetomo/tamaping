import {
  DEFAULT_SETTINGS,
  type AudioWaveform,
  type BallPalette,
  type DotpingSettings,
  type ParticlePalette,
} from './settings';
import {
  FACTORY_PRESET_DEFINITION_DATA,
  type FactoryPresetInitialFormation,
} from './factoryPresetData';

export type { FactoryPresetInitialFormation } from './factoryPresetData';

export const FACTORY_PRESET_COUNT = 30;
export const USER_PRESET_COUNT = 30;
export const PRESET_EXPORT_SCHEMA_VERSION = 7;

const USER_PRESET_STORAGE_KEY = 'dotping.userPresets.v1';
const EXPORT_KIND = 'dotping-presets';
const BALL_PALETTES: readonly BallPalette[] = [
  'black',
  'blue',
  'green',
  'yellow',
  'red',
  'pink',
  'orange',
  'white',
];
const PARTICLE_PALETTES: readonly ParticlePalette[] = [
  'blue',
  'green',
  'yellow',
  'red',
  'pink',
  'orange',
  'white',
  'pastel',
  'colorful',
];
const CONTROL_BALL_RADIUS_MIN = 2;
const CONTROL_BALL_RADIUS_MAX = 200;
const PARTICLE_RADIUS_MIN = 2;
const PARTICLE_RADIUS_MAX = 100;
const PARTICLE_COUNT_MIN = 0;
const PARTICLE_COUNT_MAX = 10000;
const PARTICLE_RIM_WIDTH_MIN = 5;
const PARTICLE_RIM_WIDTH_MAX = 100;
const LINEAR_DAMPING_MIN = 0;
const LINEAR_DAMPING_MAX = 100;
const GRAVITY_STRENGTH_MIN = 0.01;
const GRAVITY_STRENGTH_MAX = 100;
const CONTROL_BALL_MASS_MIN = 0.1;
const CONTROL_BALL_MASS_MAX = 1000;
const PARTICLE_MASS_MIN = 0.01;
const PARTICLE_MASS_MAX = 100;
const AUDIO_FREQUENCY_MIN = 30;
const AUDIO_FREQUENCY_MAX = 10000;
const AUDIO_WAVEFORMS: readonly AudioWaveform[] = ['sine', 'triangle', 'sawtooth', 'square'];
const PINNED_GROUPS = ['mode', 'ball', 'particles', 'interaction', 'audio'] as const;

export type PresetPinnedGroup = (typeof PINNED_GROUPS)[number] | null;

type PresetTuningSettings = Pick<
  DotpingSettings,
  | 'collisionMode'
  | 'particlePalette'
  | 'dotCombiMode'
  | 'gravityMode'
  | 'gravityStrength'
  | 'particleCount'
  | 'particleRadius'
  | 'particleMass'
  | 'particleLeaderVisible'
  | 'particleRimWidth'
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
  | 'audioBallWaveform'
  | 'audioBallFrequencyHz'
  | 'audioBallFrequencySpread'
  | 'audioBallDurationMs'
  | 'audioParticleWaveform'
  | 'audioParticleFrequencyHz'
  | 'audioParticleFrequencySpread'
  | 'audioParticleDurationMs'
>;

type LegacySharedAudioPresetSettings = {
  audioFrequencyHz?: unknown;
  audioFrequencySpread?: unknown;
  audioDurationMs?: unknown;
};

export type PresetSettings = PresetTuningSettings & {
  pinnedGroup?: PresetPinnedGroup;
};

export type FactoryPreset = {
  id: string;
  name: string;
  formationLabel?: string;
  initialFormation?: FactoryPresetInitialFormation;
  settings: PresetSettings;
};

export type UserPreset = {
  name: string;
  formationLabel?: string;
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

function factoryPreset(
  id: number,
  name: string,
  formationLabel: string | null,
  initialFormation: FactoryPresetInitialFormation | null,
  settings: Partial<PresetSettings>,
): FactoryPreset {
  return {
    id: `factory-${id}`,
    name,
    ...(formationLabel ? { formationLabel } : {}),
    ...(initialFormation ? { initialFormation } : {}),
    settings: {
      ...DEFAULT_PRESET,
      ...settings,
    },
  };
}

const FACTORY_PRESET_DEFINITIONS: FactoryPreset[] = FACTORY_PRESET_DEFINITION_DATA.map(
  (preset, index) => factoryPreset(
    index + 1,
    preset.name,
    preset.formationLabel ?? null,
    preset.initialFormation ?? null,
    preset.settings,
  ),
);

export const FACTORY_PRESETS = FACTORY_PRESET_DEFINITIONS.slice(0, FACTORY_PRESET_COUNT);

export function presetFromSettings(
  settings: DotpingSettings,
  pinnedGroup: PresetPinnedGroup = null,
): PresetSettings {
  return {
    pinnedGroup,
    collisionMode: settings.collisionMode,
    particlePalette: settings.particlePalette,
    dotCombiMode: settings.dotCombiMode,
    gravityMode: settings.gravityMode,
    gravityStrength: settings.gravityStrength,
    particleCount: settings.particleCount,
    particleRadius: settings.particleRadius,
    particleMass: settings.particleMass,
    particleLeaderVisible: settings.particleLeaderVisible,
    particleRimWidth: settings.particleRimWidth,
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
    audioBallWaveform: settings.audioBallWaveform,
    audioBallFrequencyHz: settings.audioBallFrequencyHz,
    audioBallFrequencySpread: settings.audioBallFrequencySpread,
    audioBallDurationMs: settings.audioBallDurationMs,
    audioParticleWaveform: settings.audioParticleWaveform,
    audioParticleFrequencyHz: settings.audioParticleFrequencyHz,
    audioParticleFrequencySpread: settings.audioParticleFrequencySpread,
    audioParticleDurationMs: settings.audioParticleDurationMs,
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
  formationLabel?: string | null,
) {
  const next = copyUserPresetSlots(presets);
  const label = sanitizeFormationLabel(formationLabel);
  next[index] = {
    name: sanitizePresetName(name, index),
    ...(label ? { formationLabel: label } : {}),
    settings: normalizePresetSettings(settings),
  };
  writeUserPresetStorage(next);
  return next;
}

export function deleteUserPreset(
  presets: Array<UserPreset | null>,
  index: number,
) {
  const next = copyUserPresetSlots(presets);
  next[index] = null;
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

    const formationLabel = sanitizeFormationLabel(preset.formationLabel);
    next[target] = {
      name: sanitizePresetName(preset.name, target),
      ...(formationLabel ? { formationLabel } : {}),
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
  pinnedGroup: PresetPinnedGroup = null,
  formationLabel?: string | null,
): PresetExportFile {
  const label = sanitizeFormationLabel(formationLabel);
  return createPresetExport('current', [
    {
      name: name.trim() || 'Current',
      ...(label ? { formationLabel: label } : {}),
      settings: presetFromSettings(settings, pinnedGroup),
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
    presets: presets.map((preset, index) => {
      const formationLabel = sanitizeFormationLabel(preset.formationLabel);
      return {
        name: sanitizePresetName(preset.name, index),
        ...(formationLabel ? { formationLabel } : {}),
        settings: normalizePresetSettings(preset.settings),
      };
    }),
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
  const formationLabel = sanitizeFormationLabel(candidate.formationLabel);
  return {
    name: sanitizePresetName(candidate.name, index),
    ...(formationLabel ? { formationLabel } : {}),
    settings,
  };
}

function normalizePresetSettings(value: unknown): PresetSettings {
  const source = value && typeof value === 'object'
    ? (value as Partial<PresetSettings> & LegacySharedAudioPresetSettings)
    : {};
  const base = DEFAULT_PRESET;
  const legacyFrequencyHz = finiteNumberInRange(
    source.audioFrequencyHz,
    base.audioBallFrequencyHz,
    AUDIO_FREQUENCY_MIN,
    AUDIO_FREQUENCY_MAX,
  );
  const legacyFrequencySpread = finiteNumberInRange(
    source.audioFrequencySpread,
    base.audioBallFrequencySpread,
    1,
    2,
  );
  const legacyDurationMs = finiteNumberInRange(
    source.audioDurationMs,
    base.audioBallDurationMs,
    1,
    1000,
  );

  const normalized: PresetSettings = {
    collisionMode: source.collisionMode === 'independence-overlapping'
      ? 'independence-overlapping'
      : source.collisionMode === 'collision-physical'
        ? 'collision-physical'
        : base.collisionMode,
    particlePalette: oneOf(source.particlePalette, PARTICLE_PALETTES)
      ?? base.particlePalette,
    dotCombiMode: oneOf(source.dotCombiMode, ['off', 'velocity']) ?? base.dotCombiMode,
    gravityMode: oneOf(source.gravityMode, ['none', 'gravity', 'antigravity'])
      ?? base.gravityMode,
    gravityStrength: finiteNumberInRange(
      source.gravityStrength,
      base.gravityStrength,
      GRAVITY_STRENGTH_MIN,
      GRAVITY_STRENGTH_MAX,
    ),
    particleCount: finiteNumberInRange(
      source.particleCount,
      base.particleCount,
      PARTICLE_COUNT_MIN,
      PARTICLE_COUNT_MAX,
    ),
    particleRadius: finiteNumberInRange(
      source.particleRadius,
      base.particleRadius,
      PARTICLE_RADIUS_MIN,
      PARTICLE_RADIUS_MAX,
    ),
    particleMass: finiteNumberInRange(
      source.particleMass,
      base.particleMass,
      PARTICLE_MASS_MIN,
      PARTICLE_MASS_MAX,
    ),
    particleLeaderVisible: booleanValue(
      source.particleLeaderVisible,
      base.particleLeaderVisible,
    ),
    particleRimWidth: finiteNumberInRange(
      source.particleRimWidth,
      base.particleRimWidth,
      PARTICLE_RIM_WIDTH_MIN,
      PARTICLE_RIM_WIDTH_MAX,
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
    particleLinearDamping: finiteNumberInRange(
      source.particleLinearDamping,
      base.particleLinearDamping,
      LINEAR_DAMPING_MIN,
      LINEAR_DAMPING_MAX,
    ),
    controlBallPalette: normalizeBallPalette(source.controlBallPalette)
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
    controlBallMass: finiteNumberInRange(
      source.controlBallMass,
      base.controlBallMass,
      CONTROL_BALL_MASS_MIN,
      CONTROL_BALL_MASS_MAX,
    ),
    controlBallFriction: finiteNumber(source.controlBallFriction, base.controlBallFriction),
    controlBallLinearDamping: finiteNumberInRange(
      source.controlBallLinearDamping,
      base.controlBallLinearDamping,
      LINEAR_DAMPING_MIN,
      LINEAR_DAMPING_MAX,
    ),
    wallRestitution: finiteNumber(source.wallRestitution, base.wallRestitution),
    audioBallWaveform: oneOf(source.audioBallWaveform, AUDIO_WAVEFORMS)
      ?? base.audioBallWaveform,
    audioBallFrequencyHz: finiteNumberInRange(
      source.audioBallFrequencyHz,
      legacyFrequencyHz,
      AUDIO_FREQUENCY_MIN,
      AUDIO_FREQUENCY_MAX,
    ),
    audioBallFrequencySpread: finiteNumberInRange(
      source.audioBallFrequencySpread,
      legacyFrequencySpread,
      1,
      2,
    ),
    audioBallDurationMs: finiteNumberInRange(
      source.audioBallDurationMs,
      legacyDurationMs,
      1,
      1000,
    ),
    audioParticleWaveform: oneOf(source.audioParticleWaveform, AUDIO_WAVEFORMS)
      ?? base.audioParticleWaveform,
    audioParticleFrequencyHz: finiteNumberInRange(
      source.audioParticleFrequencyHz,
      legacyFrequencyHz,
      AUDIO_FREQUENCY_MIN,
      AUDIO_FREQUENCY_MAX,
    ),
    audioParticleFrequencySpread: finiteNumberInRange(
      source.audioParticleFrequencySpread,
      legacyFrequencySpread,
      1,
      2,
    ),
    audioParticleDurationMs: finiteNumberInRange(
      source.audioParticleDurationMs,
      legacyDurationMs,
      1,
      1000,
    ),
  };

  if (Object.prototype.hasOwnProperty.call(source, 'pinnedGroup')) {
    normalized.pinnedGroup = pinnedGroupValue(source.pinnedGroup);
  }

  return normalized;
}

function sanitizePresetName(name: unknown, index: number) {
  if (typeof name !== 'string') {
    return `User ${index + 1}`;
  }

  const trimmed = name.trim();
  return trimmed ? trimmed.slice(0, 40) : `User ${index + 1}`;
}

function sanitizeFormationLabel(label: unknown) {
  if (typeof label !== 'string') {
    return null;
  }

  const trimmed = label.trim();
  return trimmed ? trimmed.slice(0, 40) : null;
}

function oneOf<T extends string>(value: unknown, choices: readonly T[]) {
  return choices.includes(value as T) ? (value as T) : null;
}

function normalizeBallPalette(value: unknown): BallPalette | null {
  const direct = oneOf(value, BALL_PALETTES);
  if (direct) {
    return direct;
  }

  switch (value) {
    case 'black-hole':
      return 'black';
    case 'calm-blue':
      return 'blue';
    case 'solar-yellow':
      return 'yellow';
    case 'red-core':
      return 'red';
    case 'pink-glow':
      return 'pink';
    case 'white-star':
      return 'white';
    default:
      return null;
  }
}

function booleanValue(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

function pinnedGroupValue(value: unknown): PresetPinnedGroup {
  return value === null || PINNED_GROUPS.includes(value as (typeof PINNED_GROUPS)[number])
    ? (value as PresetPinnedGroup)
    : null;
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

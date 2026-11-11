import {
  DEFAULT_SETTINGS,
  type AudioWaveform,
  BODY_SHAPES,
  FX_RANGES,
  type BallPalette,
  type BodyShape,
  type DotpingSettings,
  type ParticlePalette,
} from './settings';
import { FACTORY_PRESET_DEFINITION_DATA } from './factoryPresetData';
import {
  normalizePresetStart,
  startFromInitialFormation,
  type PresetStart,
} from './presetStart';
import { normalizeDesignViewport, type Viewport } from './viewScale';

export const FACTORY_PRESET_COUNT = 30;
export const USER_PRESET_COUNT = 60;
export const PRESET_EXPORT_SCHEMA_VERSION = 14;
export const PRESET_NAME_MAX_LENGTH = 40;
export const AUTOSAVE_WORKING_PRESET_NAME = 'Autosave working';
export const PRESET_MY_PANEL_MAX_ITEMS = 10;

// v2 holds 60 slots. v1 is the 30-slot key of 0.2.7 and earlier: it is read
// once to fill v2 and never written again, so an old tab left open after an
// update cannot cut the list, and v1 stays as a copy from before the update.
export const USER_PRESET_STORAGE_KEY = 'dotping.userPresets.v2';
export const LEGACY_USER_PRESET_STORAGE_KEY = 'dotping.userPresets.v1';
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
const PINNED_GROUPS = ['my', 'mode', 'ball', 'particles', 'interaction', 'audio'] as const;

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
  | 'ballWeave'
  | 'ballWeaveAgility'
  | 'ballWeaveSight'
  | 'ballWeaveWalls'
  | 'wallRestitution'
  | 'audioBallWaveform'
  | 'audioBallFrequencyHz'
  | 'audioBallFrequencySpread'
  | 'audioBallDurationMs'
  | 'audioParticleWaveform'
  | 'audioParticleFrequencyHz'
  | 'audioParticleFrequencySpread'
  | 'audioParticleDurationMs'
  | 'audioTriggerSpreadMs'
  | 'particleShape'
  | 'particleShapeTurn'
  | 'particleShapeCurve'
  | 'particleShapeOpacity'
  | 'particleFxRays'
  | 'particleFxRaysTurn'
  | 'particleFxRaysCurve'
  | 'particleFxTrail'
  | 'particleFxTrailOpacity'
  | 'particleFxTrailLength'
  | 'particleFxAfterglow'
  | 'particleFxAfterglowStrength'
  | 'particleFxAfterglowLength'
  | 'ballShape'
  | 'ballShapeTurn'
  | 'ballShapeCurve'
  | 'ballShapeOpacity'
  | 'ballFxRays'
  | 'ballFxRaysTurn'
  | 'ballFxRaysCurve'
  | 'ballFxTrail'
  | 'ballFxTrailOpacity'
  | 'ballFxTrailLength'
  | 'ballFxAfterglow'
  | 'ballFxAfterglowStrength'
  | 'ballFxAfterglowLength'
>;

type LegacySharedAudioPresetSettings = {
  audioFrequencyHz?: unknown;
  audioFrequencySpread?: unknown;
  audioDurationMs?: unknown;
};

export type PresetSettings = PresetTuningSettings & {
  pinnedGroup?: PresetPinnedGroup;
  // The preset's own My Panel rows, in order. Missing means the preset has no
  // rows and shows the browser's own My Panel; empty means an empty panel.
  myPanelItems?: string[];
};

export type FactoryPreset = {
  id: string;
  name: string;
  formationLabel?: string;
  // What the preset shows at its first moment.
  start: PresetStart;
  settings: PresetSettings;
};

export type UserPreset = {
  name: string;
  formationLabel?: string;
  // Screen the preset was tuned on (world size at save). Missing means the
  // default phone design screen. Not part of the Modified comparison.
  designViewport?: Viewport;
  // Start state. Missing means the default start. Not part of the Modified
  // comparison either: it is metadata, like `formationLabel`.
  start?: PresetStart;
  settings: PresetSettings;
};

export type PresetExportFile = {
  kind: typeof EXPORT_KIND;
  schemaVersion: typeof PRESET_EXPORT_SCHEMA_VERSION;
  exportedAt: string;
  source: 'current' | 'user-presets' | 'autosave';
  presets: UserPreset[];
  // Autosave only: the tuning in progress when the file was written.
  working?: UserPreset;
};

const DEFAULT_PRESET = presetFromSettings(DEFAULT_SETTINGS);

function factoryPreset(
  id: number,
  name: string,
  formationLabel: string | null,
  start: PresetStart,
  settings: Partial<PresetSettings>,
): FactoryPreset {
  return {
    id: `factory-${id}`,
    name,
    ...(formationLabel ? { formationLabel } : {}),
    start,
    settings: {
      ...DEFAULT_PRESET,
      ...settings,
      audioTriggerSpreadMs: 16,
    },
  };
}

const FACTORY_PRESET_DEFINITIONS: FactoryPreset[] = FACTORY_PRESET_DEFINITION_DATA.map(
  (preset, index) => factoryPreset(
    index + 1,
    preset.name,
    preset.formationLabel ?? null,
    startFromInitialFormation(preset.initialFormation),
    preset.settings,
  ),
);

export const FACTORY_PRESETS = FACTORY_PRESET_DEFINITIONS.slice(0, FACTORY_PRESET_COUNT);

export function presetFromSettings(
  settings: DotpingSettings,
  pinnedGroup: PresetPinnedGroup = null,
  myPanelItems?: readonly string[],
): PresetSettings {
  return {
    pinnedGroup,
    ...(myPanelItems ? { myPanelItems: [...myPanelItems] } : {}),
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
    ballWeave: settings.ballWeave,
    ballWeaveAgility: settings.ballWeaveAgility,
    ballWeaveSight: settings.ballWeaveSight,
    ballWeaveWalls: settings.ballWeaveWalls,
    wallRestitution: settings.wallRestitution,
    audioBallWaveform: settings.audioBallWaveform,
    audioBallFrequencyHz: settings.audioBallFrequencyHz,
    audioBallFrequencySpread: settings.audioBallFrequencySpread,
    audioBallDurationMs: settings.audioBallDurationMs,
    audioParticleWaveform: settings.audioParticleWaveform,
    audioParticleFrequencyHz: settings.audioParticleFrequencyHz,
    audioParticleFrequencySpread: settings.audioParticleFrequencySpread,
    audioParticleDurationMs: settings.audioParticleDurationMs,
    audioTriggerSpreadMs: settings.audioTriggerSpreadMs,
    particleShape: settings.particleShape,
    particleShapeTurn: settings.particleShapeTurn,
    particleShapeCurve: settings.particleShapeCurve,
    particleShapeOpacity: settings.particleShapeOpacity,
    particleFxRays: settings.particleFxRays,
    particleFxRaysTurn: settings.particleFxRaysTurn,
    particleFxRaysCurve: settings.particleFxRaysCurve,
    particleFxTrail: settings.particleFxTrail,
    particleFxTrailOpacity: settings.particleFxTrailOpacity,
    particleFxTrailLength: settings.particleFxTrailLength,
    particleFxAfterglow: settings.particleFxAfterglow,
    particleFxAfterglowStrength: settings.particleFxAfterglowStrength,
    particleFxAfterglowLength: settings.particleFxAfterglowLength,
    ballShape: settings.ballShape,
    ballShapeTurn: settings.ballShapeTurn,
    ballShapeCurve: settings.ballShapeCurve,
    ballShapeOpacity: settings.ballShapeOpacity,
    ballFxRays: settings.ballFxRays,
    ballFxRaysTurn: settings.ballFxRaysTurn,
    ballFxRaysCurve: settings.ballFxRaysCurve,
    ballFxTrail: settings.ballFxTrail,
    ballFxTrailOpacity: settings.ballFxTrailOpacity,
    ballFxTrailLength: settings.ballFxTrailLength,
    ballFxAfterglow: settings.ballFxAfterglow,
    ballFxAfterglowStrength: settings.ballFxAfterglowStrength,
    ballFxAfterglowLength: settings.ballFxAfterglowLength,
  };
}

export type PresetStorage = Pick<Storage, 'getItem' | 'setItem'>;

export function loadUserPresets(storage: PresetStorage | null = browserStorage()): Array<UserPreset | null> {
  const empty = emptyUserPresetSlots();
  const raw = readStorage(storage, USER_PRESET_STORAGE_KEY);
  const migrating = raw === null;
  const source = migrating ? readStorage(storage, LEGACY_USER_PRESET_STORAGE_KEY) : raw;
  if (!source) {
    return empty;
  }

  let presets = empty;
  try {
    const parsed = JSON.parse(source);
    if (Array.isArray(parsed)) {
      presets = empty.map((_, index) => normalizeUserPreset(parsed[index], index));
    }
  } catch {
    return empty;
  }

  if (migrating) {
    writeUserPresetStorage(presets, storage);
  }
  return presets;
}

export function saveUserPreset(
  presets: Array<UserPreset | null>,
  index: number,
  name: string,
  settings: PresetSettings,
  formationLabel?: string | null,
  designViewport?: Viewport | null,
  start?: PresetStart | null,
) {
  const next = copyUserPresetSlots(presets);
  const label = sanitizeFormationLabel(formationLabel);
  const design = normalizeDesignViewport(designViewport);
  next[index] = {
    name: sanitizePresetName(name, index),
    ...(label ? { formationLabel: label } : {}),
    ...(design ? { designViewport: design } : {}),
    ...startField(start),
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

export function parsePresetExport(jsonText: string): UserPreset[] {
  const parsed = JSON.parse(jsonText);
  const sourcePresets = Array.isArray(parsed)
    ? parsed
    : isPresetExportLike(parsed)
      ? [...parsed.presets, ...(parsed.working ? [parsed.working] : [])]
      : [];

  return sourcePresets
    .map((preset, index) => normalizeUserPreset(preset, index))
    .filter((preset): preset is UserPreset => Boolean(preset));
}

// Import keeps the work in progress of an `Auto Backup` file apart, so it can
// be offered separately instead of being added like a saved preset.
export function parsePresetImportFile(jsonText: string): {
  presets: UserPreset[];
  working: UserPreset | null;
} {
  const parsed = JSON.parse(jsonText);
  const sourcePresets = Array.isArray(parsed)
    ? parsed
    : isPresetExportLike(parsed)
      ? parsed.presets
      : [];
  const working = !Array.isArray(parsed) && isPresetExportLike(parsed) && parsed.working
    ? normalizeUserPreset(parsed.working, sourcePresets.length)
    : null;

  return {
    presets: sourcePresets
      .map((preset, index) => normalizeUserPreset(preset, index))
      .filter((preset): preset is UserPreset => Boolean(preset)),
    working,
  };
}

export function createCurrentPresetExport(
  name: string,
  settings: DotpingSettings,
  pinnedGroup: PresetPinnedGroup = null,
  formationLabel?: string | null,
  designViewport?: Viewport | null,
  myPanelItems?: readonly string[],
  start?: PresetStart | null,
): PresetExportFile {
  const label = sanitizeFormationLabel(formationLabel);
  const design = normalizeDesignViewport(designViewport);
  return createPresetExport('current', [
    {
      name: name.trim() || 'Current',
      ...(label ? { formationLabel: label } : {}),
      ...(design ? { designViewport: design } : {}),
      ...startField(start),
      settings: presetFromSettings(settings, pinnedGroup, myPanelItems),
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

export function createAutosaveExport(
  presets: Array<UserPreset | null>,
  settings: PresetSettings,
  formationLabel?: string | null,
  designViewport?: Viewport | null,
  start?: PresetStart | null,
): PresetExportFile {
  const label = sanitizeFormationLabel(formationLabel);
  const design = normalizeDesignViewport(designViewport);
  return {
    ...createPresetExport(
      'autosave',
      presets.filter((preset): preset is UserPreset => Boolean(preset)),
    ),
    working: {
      name: AUTOSAVE_WORKING_PRESET_NAME,
      ...(label ? { formationLabel: label } : {}),
      ...(design ? { designViewport: design } : {}),
      ...startField(start),
      settings: normalizePresetSettings(settings),
    },
  };
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
      const design = normalizeDesignViewport(preset.designViewport);
      return {
        name: sanitizePresetName(preset.name, index),
        ...(formationLabel ? { formationLabel } : {}),
        ...(design ? { designViewport: design } : {}),
        ...startField(preset.start),
        settings: normalizePresetSettings(preset.settings),
      };
    }),
  };
}

function browserStorage(): PresetStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readStorage(storage: PresetStorage | null, key: string) {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeUserPresetStorage(
  presets: Array<UserPreset | null>,
  storage: PresetStorage | null = browserStorage(),
) {
  try {
    storage?.setItem(USER_PRESET_STORAGE_KEY, JSON.stringify(presets));
  } catch {
    // Keep in-memory presets for the current session even if storage fails.
  }
}

// Writes a whole slot list, as an import does after its review.
export function storeUserPresets(presets: Array<UserPreset | null>) {
  const next = copyUserPresetSlots(presets);
  writeUserPresetStorage(next);
  return next;
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

export function normalizeUserPreset(value: unknown, index = 0): UserPreset | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<UserPreset>;
  if (!candidate.settings || typeof candidate.settings !== 'object') {
    return null;
  }

  const settings = normalizePresetSettings(candidate.settings);
  const formationLabel = sanitizeFormationLabel(candidate.formationLabel);
  const design = normalizeDesignViewport(candidate.designViewport);
  return {
    name: sanitizePresetName(candidate.name, index),
    ...(formationLabel ? { formationLabel } : {}),
    ...(design ? { designViewport: design } : {}),
    ...startField(candidate.start),
    settings,
  };
}

// A start is stored only when present, so older presets keep reading as the
// default start.
function startField(start: unknown): { start?: PresetStart } {
  return start && typeof start === 'object' ? { start: normalizePresetStart(start) } : {};
}

export function normalizePresetSettings(value: unknown): PresetSettings {
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
    ballWeave: booleanValue(source.ballWeave, base.ballWeave),
    ballWeaveAgility: finiteNumberInRange(source.ballWeaveAgility, base.ballWeaveAgility, 0, 100),
    ballWeaveSight: finiteNumberInRange(source.ballWeaveSight, base.ballWeaveSight, 0, 100),
    ballWeaveWalls: booleanValue(source.ballWeaveWalls, base.ballWeaveWalls),
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
    audioTriggerSpreadMs: audioTriggerSpreadValue(
      source.audioTriggerSpreadMs,
      base.audioTriggerSpreadMs,
    ),
    // Shapes and effects (round 10). Missing keys take the defaults, so a
    // preset saved before them always looks the same.
    particleShape: normalizeShape(source.particleShape) ?? base.particleShape,
    particleShapeTurn: booleanValue(source.particleShapeTurn, base.particleShapeTurn),
    particleShapeCurve: rangeValue(source.particleShapeCurve, base.particleShapeCurve, FX_RANGES.curve),
    particleShapeOpacity: rangeValue(source.particleShapeOpacity, base.particleShapeOpacity, FX_RANGES.particleShapeOpacity),
    particleFxRays: booleanValue(source.particleFxRays, base.particleFxRays),
    particleFxRaysTurn: booleanValue(source.particleFxRaysTurn, base.particleFxRaysTurn),
    particleFxRaysCurve: rangeValue(source.particleFxRaysCurve, base.particleFxRaysCurve, FX_RANGES.curve),
    particleFxTrail: booleanValue(source.particleFxTrail, base.particleFxTrail),
    particleFxTrailOpacity: rangeValue(
      source.particleFxTrailOpacity,
      base.particleFxTrailOpacity,
      FX_RANGES.trailOpacity,
    ),
    particleFxTrailLength: rangeValue(
      source.particleFxTrailLength,
      base.particleFxTrailLength,
      FX_RANGES.trailLength,
    ),
    particleFxAfterglow: booleanValue(source.particleFxAfterglow, base.particleFxAfterglow),
    particleFxAfterglowStrength: rangeValue(
      source.particleFxAfterglowStrength,
      base.particleFxAfterglowStrength,
      FX_RANGES.afterglowStrength,
    ),
    particleFxAfterglowLength: rangeValue(
      source.particleFxAfterglowLength,
      base.particleFxAfterglowLength,
      FX_RANGES.afterglowLength,
    ),
    ballShape: normalizeShape(source.ballShape) ?? base.ballShape,
    ballShapeTurn: booleanValue(source.ballShapeTurn, base.ballShapeTurn),
    ballShapeCurve: rangeValue(source.ballShapeCurve, base.ballShapeCurve, FX_RANGES.curve),
    ballShapeOpacity: rangeValue(source.ballShapeOpacity, base.ballShapeOpacity, FX_RANGES.ballShapeOpacity),
    ballFxRays: booleanValue(source.ballFxRays, base.ballFxRays),
    ballFxRaysTurn: booleanValue(source.ballFxRaysTurn, base.ballFxRaysTurn),
    ballFxRaysCurve: rangeValue(source.ballFxRaysCurve, base.ballFxRaysCurve, FX_RANGES.curve),
    ballFxTrail: booleanValue(source.ballFxTrail, base.ballFxTrail),
    ballFxTrailOpacity: rangeValue(
      source.ballFxTrailOpacity,
      base.ballFxTrailOpacity,
      FX_RANGES.trailOpacity,
    ),
    ballFxTrailLength: rangeValue(
      source.ballFxTrailLength,
      base.ballFxTrailLength,
      FX_RANGES.trailLength,
    ),
    ballFxAfterglow: booleanValue(source.ballFxAfterglow, base.ballFxAfterglow),
    ballFxAfterglowStrength: rangeValue(
      source.ballFxAfterglowStrength,
      base.ballFxAfterglowStrength,
      FX_RANGES.afterglowStrength,
    ),
    ballFxAfterglowLength: rangeValue(
      source.ballFxAfterglowLength,
      base.ballFxAfterglowLength,
      FX_RANGES.afterglowLength,
    ),
  };

  if (Object.prototype.hasOwnProperty.call(source, 'pinnedGroup')) {
    normalized.pinnedGroup = pinnedGroupValue(source.pinnedGroup);
  }

  if (Array.isArray(source.myPanelItems)) {
    normalized.myPanelItems = myPanelItemsValue(source.myPanelItems);
  }

  return normalized;
}

// Only the list's shape is checked here. Which ids exist is known to the app,
// which skips unknown rows when the preset is applied.
function myPanelItemsValue(values: readonly unknown[]) {
  const items: string[] = [];
  for (const value of values) {
    if (
      typeof value === 'string'
      && !items.includes(value)
      && items.length < PRESET_MY_PANEL_MAX_ITEMS
    ) {
      items.push(value);
    }
  }
  return items;
}

export function sanitizePresetName(name: unknown, index: number) {
  if (typeof name !== 'string') {
    return `User ${index + 1}`;
  }

  const trimmed = name.trim();
  return trimmed ? trimmed.slice(0, PRESET_NAME_MAX_LENGTH) : `User ${index + 1}`;
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

// `none` (removed in round 10) and unknown shapes fall back to the default.
function normalizeShape(value: unknown): BodyShape | null {
  return oneOf(value, BODY_SHAPES);
}

function rangeValue(value: unknown, fallback: number, range: readonly [number, number]) {
  return finiteNumberInRange(value, fallback, range[0], range[1]);
}

function booleanValue(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

function pinnedGroupValue(value: unknown): PresetPinnedGroup {
  return value === null || PINNED_GROUPS.includes(value as (typeof PINNED_GROUPS)[number])
    ? (value as PresetPinnedGroup)
    : null;
}

function audioTriggerSpreadValue(value: unknown, fallback: 0 | 16) {
  return value === 0 || value === 16 ? value : fallback;
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

function isPresetExportLike(value: unknown): value is { presets: unknown[]; working?: unknown } {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<PresetExportFile>;
  return candidate.kind === EXPORT_KIND && Array.isArray(candidate.presets);
}

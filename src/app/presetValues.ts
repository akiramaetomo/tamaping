import {
  FACTORY_PRESETS,
  type PresetSettings,
  type UserPreset,
} from '../sim/presets';
import { DEFAULT_PRESET_START, type PresetStart } from '../sim/presetStart';
import { BENCH_DESIGN_VIEWPORT, benchPresetForValue } from '../sim/benchPresets';
import { DEFAULT_DESIGN_VIEWPORT, type Viewport } from '../sim/viewScale';
import { effectivePresetMessageText } from './messageFormation';

// Resolves a preset select value (`custom`, `factory:<id>`, `user:<index>` or
// the perf-only `bench:<id>`) against the preset lists. No DOM access.

type UserPresetSlots = ReadonlyArray<UserPreset | null>;

export type PresetEditOutcome = 'applied' | 'modified' | 'custom';

function factoryPresetFor(value: string) {
  if (!value.startsWith('factory:')) {
    return undefined;
  }
  const id = value.slice('factory:'.length);
  return FACTORY_PRESETS.find((preset) => preset.id === id);
}

function userPresetFor(value: string, userPresets: UserPresetSlots) {
  if (!value.startsWith('user:')) {
    return undefined;
  }
  const index = Number(value.slice('user:'.length));
  return userPresets[index] ?? undefined;
}

// Formation label for the name formation and Save/Export; `null` for Custom.
export function presetFormationLabel(value: string, userPresets: UserPresetSlots) {
  const bench = benchPresetForValue(value);
  if (bench) {
    return effectivePresetMessageText(bench.name, null);
  }
  if (!value.startsWith('factory:') && !value.startsWith('user:')) {
    return null;
  }
  const preset = factoryPresetFor(value) ?? userPresetFor(value, userPresets);
  return effectivePresetMessageText(preset?.name, preset?.formationLabel);
}

export function presetMessageText(value: string, userPresets: UserPresetSlots) {
  return presetFormationLabel(value, userPresets) ?? 'Custom';
}

export function presetExportName(value: string, userPresets: UserPresetSlots) {
  const preset = factoryPresetFor(value) ?? userPresetFor(value, userPresets) ?? benchPresetForValue(value);
  return preset?.name ?? 'Current';
}

// `dotping-user-presets` becomes `dotping-user-presets-2026-11-05.json`, in the
// viewer's local date.
export function presetExportFilename(base: string, date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${base}-${date.getFullYear()}-${month}-${day}.json`;
}

export function presetSettingsForValue(
  value: string,
  userPresets: UserPresetSlots,
): PresetSettings | null {
  const preset = factoryPresetFor(value) ?? userPresetFor(value, userPresets) ?? benchPresetForValue(value);
  return preset?.settings ?? null;
}

// Factory presets and user presets without a record use the default screen;
// bench presets pin their own so every device runs the same world.
export function designViewportForPresetValue(
  value: string,
  userPresets: UserPresetSlots,
): Viewport {
  if (benchPresetForValue(value)) {
    return BENCH_DESIGN_VIEWPORT;
  }
  return userPresetFor(value, userPresets)?.designViewport ?? DEFAULT_DESIGN_VIEWPORT;
}

// The start a preset shows at its first moment. Bench presets and presets
// without a stored start use the default; `null` when no preset matches.
export function presetStartForValue(
  value: string,
  userPresets: UserPresetSlots,
): PresetStart | null {
  const preset = factoryPresetFor(value) ?? userPresetFor(value, userPresets) ?? benchPresetForValue(value);
  if (!preset) {
    return null;
  }
  return { ...('start' in preset && preset.start ? preset.start : DEFAULT_PRESET_START) };
}

export function presetSettingsEqual(a: PresetSettings, b: PresetSettings) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// What the preset selection shows after a setting or pin change: back to the
// applied preset, a modified preset, or Custom when nothing was applied.
export function presetEditOutcome(
  current: PresetSettings,
  snapshot: PresetSettings | null,
  activeValue: string,
): PresetEditOutcome {
  if (snapshot && presetSettingsEqual(current, snapshot)) {
    return 'applied';
  }
  if (snapshot && activeValue !== 'custom') {
    return 'modified';
  }
  return 'custom';
}

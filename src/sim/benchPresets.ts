import { presetFromSettings, type PresetSettings } from './presets';
import { DEFAULT_SETTINGS } from './settings';
import type { Viewport } from './viewScale';

// Fixed scenes for the `?dbg=perf` profile. They are not factory presets: they
// appear only in perf runs and never reach the front preset bar or the
// public preset list. See `Proposed Performance Bench Presets` in the spec.

export type BenchId = 'A' | 'B' | 'C' | 'D';

export type BenchPreset = {
  id: BenchId;
  name: string;
  settings: PresetSettings;
};

// Every device runs the same world, so physics numbers compare across devices.
export const BENCH_DESIGN_VIEWPORT: Viewport = { width: 360, height: 800 };

const BENCH_BASE = presetFromSettings(DEFAULT_SETTINGS, null);

function benchPreset(id: BenchId, name: string, settings: Partial<PresetSettings>): BenchPreset {
  return { id, name, settings: { ...BENCH_BASE, ...settings } };
}

export const BENCH_PRESETS: readonly BenchPreset[] = [
  benchPreset('A', '⏱ A Render spread', {
    collisionMode: 'collision-physical',
    gravityMode: 'none',
    particleCount: 1000,
    particleRadius: 4,
    particleRimWidth: 100,
  }),
  benchPreset('B', '⏱ B Physics gathered', {
    collisionMode: 'independence-overlapping',
    gravityMode: 'gravity',
    gravityStrength: 3,
    particleCount: 1000,
    particleRadius: 8,
    particleRimWidth: 100,
  }),
  benchPreset('C', '⏱ C Stroke render', {
    collisionMode: 'independence-overlapping',
    gravityMode: 'none',
    particleCount: 1000,
    particleRadius: 16,
    particleRimWidth: 50,
  }),
  benchPreset('D', '⏱ D Physical gathered', {
    collisionMode: 'collision-physical',
    gravityMode: 'gravity',
    gravityStrength: 1,
    particleCount: 1000,
    particleRadius: 4,
    particleRimWidth: 100,
  }),
];

export function benchPresetFor(id: string) {
  return BENCH_PRESETS.find((preset) => preset.id === id);
}

export function benchPresetValue(id: BenchId) {
  return `bench:${id}`;
}

// `bench:<id>` select values; undefined for everything else.
export function benchPresetForValue(value: string) {
  return value.startsWith('bench:') ? benchPresetFor(value.slice('bench:'.length)) : undefined;
}

// `?bench=B` (case-insensitive); null when missing or unknown.
export function benchIdFromParams(params: URLSearchParams): BenchId | null {
  const id = params.get('bench')?.trim().toUpperCase() ?? '';
  return benchPresetFor(id)?.id ?? null;
}

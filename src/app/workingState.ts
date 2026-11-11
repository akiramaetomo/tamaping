import { normalizePresetSettings, type PresetSettings } from '../sim/presets';
import { DEFAULT_PRESET_START, normalizePresetStart, type PresetStart } from '../sim/presetStart';
import { DEFAULT_DESIGN_VIEWPORT, normalizeDesignViewport, type Viewport } from '../sim/viewScale';

// Keeps unsaved tuning across reloads and tab kills, inside the browser only.
// Dot positions are not part of it; a restored scene starts from a new layout.

export const WORKING_STATE_STORAGE_KEY = 'dotping.workingState.v1';
export const WORKING_STATE_BOOT_KEY = 'dotping.workingState.booting.v1';
export const WORKING_STATE_SAVE_DELAY_MS = 500;
// A start that survives this long did not die because of the restored state.
export const WORKING_STATE_STABLE_MS = 10000;

export type WorkingState = {
  settings: PresetSettings;
  presetValue: string;
  // The state the selected preset was applied with; `null` for custom tuning.
  snapshot: PresetSettings | null;
  lastAppliedValue: string | null;
  designViewport: Viewport;
  // The start shown in the Start block. A reload restores it but does not
  // replay it.
  start: PresetStart;
};

type WorkingStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

// Diagnostic URLs stay repeatable: they neither restore nor save.
export function workingStateAllowed(search: string) {
  const params = new URLSearchParams(search);
  return !params.has('fx') && !params.has('bench') && params.get('dbg') !== 'perf';
}

export function parseWorkingState(json: string | null): WorkingState | null {
  if (!json) {
    return null;
  }

  try {
    const parsed = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object' || !parsed.settings || typeof parsed.settings !== 'object') {
      return null;
    }

    return {
      settings: normalizePresetSettings(parsed.settings),
      presetValue: typeof parsed.presetValue === 'string' ? parsed.presetValue : 'custom',
      snapshot: parsed.snapshot && typeof parsed.snapshot === 'object'
        ? normalizePresetSettings(parsed.snapshot)
        : null,
      lastAppliedValue: typeof parsed.lastAppliedValue === 'string' ? parsed.lastAppliedValue : null,
      designViewport: normalizeDesignViewport(parsed.designViewport) ?? DEFAULT_DESIGN_VIEWPORT,
      start: parsed.start && typeof parsed.start === 'object'
        ? normalizePresetStart(parsed.start)
        : { ...DEFAULT_PRESET_START },
    };
  } catch {
    return null;
  }
}

// The stored state to restore on this start. A marker left by the previous
// start means it died within the stable time, so this start skips the restore
// once and keeps the stored state.
export function beginWorkingStateBoot(storage: WorkingStorage): WorkingState | null {
  if (storage.getItem(WORKING_STATE_BOOT_KEY) !== null) {
    storage.removeItem(WORKING_STATE_BOOT_KEY);
    return null;
  }

  const state = parseWorkingState(storage.getItem(WORKING_STATE_STORAGE_KEY));
  if (state) {
    storage.setItem(WORKING_STATE_BOOT_KEY, '1');
  }
  return state;
}

export function finishWorkingStateBoot(storage: WorkingStorage) {
  storage.removeItem(WORKING_STATE_BOOT_KEY);
}

// Writes the state only when it differs from what the store already holds or
// from the state the app started with.
export class WorkingStateSaver {
  private lastJson: string;

  constructor(
    private readonly storage: WorkingStorage,
    private readonly read: () => WorkingState,
  ) {
    this.lastJson = JSON.stringify(read());
  }

  flush() {
    const json = JSON.stringify(this.read());
    if (json === this.lastJson) {
      return false;
    }

    this.storage.setItem(WORKING_STATE_STORAGE_KEY, json);
    this.lastJson = json;
    return true;
  }
}

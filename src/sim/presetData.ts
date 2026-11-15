import type { PresetSettings } from './presets';
import type { PresetStart } from './presetStart';
import type { Viewport } from './viewScale';

// A preset written into the code, in the same shape as a user preset in an
// export file, so a Preset Workbench export can be pasted in as it is.
// Used for the factory list and for the starter user presets.
// Missing `start` means the default start; missing `designViewport` means the
// default design screen; missing settings take the defaults.
export type PresetDataEntry = {
  name: string;
  formationLabel?: string;
  designViewport?: Viewport;
  start?: PresetStart;
  settings: Partial<PresetSettings>;
};

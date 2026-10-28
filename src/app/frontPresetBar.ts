import { FACTORY_PRESETS, type UserPreset } from '../sim/presets';
import { fillPresetOptions, syncPresetSelectValue } from './presetPanel';

export const FRONT_PRESET_BAR_STORAGE_KEY = 'dotping.frontPresetBar.v1';

export type PresetStep = 1 | -1;

// Factory presets first, then saved user slots; empty slots are skipped.
export function presetBrowseOrder(userPresets: ReadonlyArray<UserPreset | null>): string[] {
  return [
    ...FACTORY_PRESETS.map((preset) => `factory:${preset.id}`),
    ...userPresets.flatMap((preset, index) => (preset ? [`user:${index}`] : [])),
  ];
}

// From Custom tuning the step starts at the last applied preset. Without one,
// next goes to the first entry and previous to the last. Both ends wrap.
export function stepPresetValue(
  order: readonly string[],
  activeValue: string,
  lastAppliedValue: string | null,
  step: PresetStep,
): string | null {
  if (order.length === 0) {
    return null;
  }

  const anchor = activeValue === 'custom' ? lastAppliedValue : activeValue;
  const index = anchor === null ? -1 : order.indexOf(anchor);
  if (index < 0) {
    return step > 0 ? order[0] : order[order.length - 1];
  }

  return order[(index + step + order.length) % order.length];
}

// Shown unless the player turned off Front menu; a fresh browser sees it.
export function parseFrontPresetBarVisible(value: string | null) {
  return value !== '0';
}

export function loadFrontPresetBarVisible() {
  try {
    return parseFrontPresetBarVisible(window.localStorage.getItem(FRONT_PRESET_BAR_STORAGE_KEY));
  } catch {
    return true;
  }
}

export function saveFrontPresetBarVisible(visible: boolean) {
  try {
    window.localStorage.setItem(FRONT_PRESET_BAR_STORAGE_KEY, visible ? '1' : '0');
  } catch {
    // Storage can be unavailable in private windows; the choice lasts for the session.
  }
}

type FrontPresetBarCallbacks = {
  onPresetChange(value: string): void;
  onStep(step: PresetStep): void;
};

export class FrontPresetBar {
  readonly element: HTMLDivElement;

  private readonly select: HTMLSelectElement;
  private optionsVersion = -1;

  constructor(callbacks: FrontPresetBarCallbacks) {
    const bar = document.createElement('div');
    bar.className = 'front-preset-bar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Preset browser');

    const previous = createBarButton('front-preset-bar__step', '‹', 'Previous preset');
    previous.addEventListener('click', () => {
      callbacks.onStep(-1);
    });

    const next = createBarButton('front-preset-bar__step', '›', 'Next preset');
    next.addEventListener('click', () => {
      callbacks.onStep(1);
    });

    this.select = document.createElement('select');
    this.select.className = 'front-preset-bar__select';
    this.select.setAttribute('aria-label', 'Preset');
    this.select.addEventListener('change', () => {
      callbacks.onPresetChange(this.select.value);
    });

    const name = document.createElement('span');
    name.className = 'front-preset-bar__name';
    name.append(this.select);

    bar.append(previous, name, next);
    this.element = bar;
  }

  set visible(visible: boolean) {
    this.element.hidden = !visible;
  }

  // Refills the options only when the preset list changed.
  sync(activeValue: string, userPresets: Array<UserPreset | null>, optionsVersion: number) {
    if (this.optionsVersion !== optionsVersion) {
      fillPresetOptions(this.select, userPresets);
      this.optionsVersion = optionsVersion;
    }
    syncPresetSelectValue(this.select, activeValue);
    this.select.title = this.select.selectedOptions[0]?.textContent ?? '';
  }
}

function createBarButton(className: string, text: string, label: string) {
  const button = document.createElement('button');
  button.className = `front-preset-bar__button ${className}`;
  button.type = 'button';
  button.textContent = text;
  button.title = label;
  button.setAttribute('aria-label', label);
  return button;
}

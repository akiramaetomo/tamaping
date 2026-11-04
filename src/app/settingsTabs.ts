export type SettingsCardId =
  | 'my'
  | 'preset'
  | 'mode'
  | 'ball'
  | 'particles'
  | 'interaction'
  | 'audio'
  | 'utility';

export type SettingsTabId = SettingsCardId;

export const SETTINGS_TABS: ReadonlyArray<readonly [SettingsTabId, string]> = [
  ['my', 'My'],
  ['preset', 'Preset'],
  ['mode', 'Mode'],
  ['ball', 'Ball'],
  ['particles', 'Particles'],
  ['interaction', 'Interaction'],
  ['audio', 'Audio'],
  ['utility', 'Utility'],
];

export const SETTINGS_TAB_STORAGE_KEY = 'dotping.settingsTab.v1';

export function isSettingsTabId(value: unknown): value is SettingsTabId {
  return SETTINGS_TABS.some(([id]) => id === value);
}

// A saved tab that no longer exists, such as the removed `all`, opens My.
export function resolveInitialSettingsTab(saved: unknown): SettingsTabId {
  return isSettingsTabId(saved) ? saved : 'my';
}

export function loadSettingsTab(): string | null {
  try {
    return window.localStorage.getItem(SETTINGS_TAB_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveSettingsTab(tab: SettingsTabId) {
  try {
    window.localStorage.setItem(SETTINGS_TAB_STORAGE_KEY, tab);
  } catch {
    // Storage can be unavailable in private windows; the tab still works.
  }
}

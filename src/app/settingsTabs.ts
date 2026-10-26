export type SettingsCardId =
  | 'my'
  | 'preset'
  | 'mode'
  | 'ball'
  | 'particles'
  | 'interaction'
  | 'audio'
  | 'utility';

export type SettingsTabId = 'all' | SettingsCardId;

export const SETTINGS_TABS: ReadonlyArray<readonly [SettingsTabId, string]> = [
  ['my', 'My'],
  ['preset', 'Preset'],
  ['mode', 'Mode'],
  ['ball', 'Ball'],
  ['particles', 'Particles'],
  ['interaction', 'Interaction'],
  ['audio', 'Audio'],
  ['utility', 'Utility'],
  ['all', 'All'],
];

export const SETTINGS_TAB_STORAGE_KEY = 'dotping.settingsTab.v1';

export function isSettingsTabId(value: unknown): value is SettingsTabId {
  return SETTINGS_TABS.some(([id]) => id === value);
}

export function resolveInitialSettingsTab(saved: unknown, mobile: boolean): SettingsTabId {
  if (isSettingsTabId(saved)) {
    return saved;
  }

  return mobile ? 'preset' : 'all';
}

export function isCardVisibleInTab(
  card: SettingsCardId,
  tab: SettingsTabId,
  myPanelItemCount: number,
) {
  if (tab === 'all') {
    // An empty My Panel would only add a hint card to the familiar overview.
    return card !== 'my' || myPanelItemCount > 0;
  }

  return card === tab;
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

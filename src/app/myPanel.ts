export const MY_PANEL_MAX_ITEMS = 10;
export const MY_PANEL_STORAGE_KEY = 'dotping.myPanel.v1';

// Pinning My Panel uses the shared pin slot, so only the items are saved.
// An old saved `pinned` field is ignored.
export type MyPanelState = {
  items: string[];
};

export const EMPTY_MY_PANEL: MyPanelState = { items: [] };

// Starting items for a browser that has never saved My Panel.
// Sound comes first as a stopgap: toggling it restores silent first-touch audio on iPad.
export const DEFAULT_MY_PANEL_ITEMS: readonly string[] = [
  'audio.sound',
  'mode.random',
  'mode.flash',
  'mode.gravityStrength',
  'audio.particle.pitch',
  'audio.particle.spread',
  'audio.particle.length',
];

export function normalizeMyPanelState(
  raw: unknown,
  knownIds: ReadonlySet<string>,
  maxItems = MY_PANEL_MAX_ITEMS,
): MyPanelState {
  if (!raw || typeof raw !== 'object') {
    return { items: [] };
  }

  const record = raw as Record<string, unknown>;
  const items: string[] = [];
  if (Array.isArray(record.items)) {
    for (const item of record.items) {
      if (
        typeof item === 'string' &&
        knownIds.has(item) &&
        !items.includes(item) &&
        items.length < maxItems
      ) {
        items.push(item);
      }
    }
  }

  return { items };
}

export function parseMyPanelState(
  json: string | null,
  knownIds: ReadonlySet<string>,
  maxItems = MY_PANEL_MAX_ITEMS,
): MyPanelState {
  if (json === null) {
    return normalizeMyPanelState(
      { items: DEFAULT_MY_PANEL_ITEMS },
      knownIds,
      maxItems,
    );
  }

  if (!json) {
    return normalizeMyPanelState(null, knownIds, maxItems);
  }

  try {
    return normalizeMyPanelState(JSON.parse(json), knownIds, maxItems);
  } catch {
    return normalizeMyPanelState(null, knownIds, maxItems);
  }
}

export function restoreDefaultMyPanelItems(knownIds: ReadonlySet<string>): MyPanelState {
  return normalizeMyPanelState({ items: DEFAULT_MY_PANEL_ITEMS }, knownIds);
}

export function toggleMyPanelItem(
  state: MyPanelState,
  id: string,
  maxItems = MY_PANEL_MAX_ITEMS,
): MyPanelState {
  if (state.items.includes(id)) {
    return { ...state, items: state.items.filter((item) => item !== id) };
  }

  if (state.items.length >= maxItems) {
    return state;
  }

  return { ...state, items: [...state.items, id] };
}

export function loadMyPanelState(knownIds: ReadonlySet<string>): MyPanelState {
  let json: string | null = null;
  try {
    json = window.localStorage.getItem(MY_PANEL_STORAGE_KEY);
  } catch {
    json = null;
  }
  return parseMyPanelState(json, knownIds);
}

export function saveMyPanelState(state: MyPanelState) {
  try {
    window.localStorage.setItem(MY_PANEL_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage can be unavailable in private windows; My Panel lasts for the session.
  }
}

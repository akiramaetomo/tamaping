import {
  PRESET_NAME_MAX_LENGTH,
  normalizeUserPreset,
  type UserPreset,
} from './presets';

// How one preset of an import file relates to what is saved.
// - `saved`: an identical preset is saved, or came earlier in the file. Skipped.
// - `new`: no saved preset has its name. Added.
// - `conflict`: a saved preset, or an earlier one in the file, has the same
//   name but differs. The user chooses.
// - `working`: the work in progress of an `Auto Backup` file. The user chooses.
export type PresetImportKind = 'saved' | 'new' | 'conflict' | 'working';
export type PresetImportChoice = 'add' | 'overwrite' | 'skip';

export type PresetImportRow = {
  preset: UserPreset;
  kind: PresetImportKind;
  // `presetContentKey` of the preset.
  content: string;
};

export type PresetImportPlan = {
  rows: PresetImportRow[];
  counts: Record<PresetImportKind, number>;
};

// What one row did: the slot it went to and the name it got there.
export type PresetImportOutcome =
  | { action: 'added' | 'overwritten'; slot: number; name: string }
  | { action: 'skipped' }
  | { action: 'no-slot' };

export type PresetImportResult = {
  // False when the rows to add need more slots than are free.
  ok: boolean;
  presets: Array<UserPreset | null>;
  added: number;
  overwritten: number;
  skipped: number;
  needsSlots: number;
  outcomes: PresetImportOutcome[];
};

type Entry = { name: string; content: string };

export function planPresetImport(
  current: ReadonlyArray<UserPreset | null>,
  incoming: readonly UserPreset[],
  working: UserPreset | null = null,
): PresetImportPlan {
  const seen: Entry[] = current.flatMap((preset) => (preset ? [entryOf(preset)] : []));
  const rows: PresetImportRow[] = [];
  const classify = (preset: UserPreset, isWorking: boolean) => {
    const entry = entryOf(preset);
    const kind: PresetImportKind = holdsCopy(seen, entry)
      ? 'saved'
      : isWorking
        ? 'working'
        : seen.some((item) => item.name === entry.name)
          ? 'conflict'
          : 'new';
    seen.push(entry);
    rows.push({ preset, kind, content: entry.content });
  };

  for (const preset of incoming) {
    classify(preset, false);
  }
  if (working) {
    classify(working, true);
  }

  const counts = { saved: 0, new: 0, conflict: 0, working: 0 };
  for (const row of rows) {
    counts[row.kind] += 1;
  }
  return { rows, counts };
}

export function defaultImportChoice(kind: PresetImportKind): PresetImportChoice {
  return kind === 'new' || kind === 'conflict' ? 'add' : 'skip';
}

export function defaultImportChoices(plan: PresetImportPlan) {
  return plan.rows.map((row) => defaultImportChoice(row.kind));
}

// Rows are applied in file order against the slots as they become, so a later
// row sees what an earlier one added. Nothing is written here.
export function applyPresetImport(
  current: ReadonlyArray<UserPreset | null>,
  plan: PresetImportPlan,
  choices: readonly PresetImportChoice[],
): PresetImportResult {
  const presets = [...current];
  // What each slot holds, kept in step with `presets`.
  const entries = presets.map((preset) => (preset ? entryOf(preset) : null));
  const outcomes: PresetImportOutcome[] = [];
  let added = 0;
  let overwritten = 0;
  let skipped = 0;
  let needsSlots = 0;

  plan.rows.forEach((row, index) => {
    const choice = row.kind === 'saved' ? 'skip' : choices[index] ?? defaultImportChoice(row.kind);
    const entry = { name: row.preset.name, content: row.content };
    if (choice === 'skip' || holdsCopy(entries, entry)) {
      skipped += 1;
      outcomes.push({ action: 'skipped' });
      return;
    }

    if (choice === 'overwrite') {
      const target = presets.findIndex((preset) => preset?.name === row.preset.name);
      if (target >= 0) {
        presets[target] = row.preset;
        entries[target] = entry;
        overwritten += 1;
        outcomes.push({ action: 'overwritten', slot: target, name: row.preset.name });
        return;
      }
    }

    const slot = presets.findIndex((preset) => !preset);
    if (slot < 0) {
      needsSlots += 1;
      outcomes.push({ action: 'no-slot' });
      return;
    }
    const taken = new Set(presets.flatMap((preset) => (preset ? [preset.name] : [])));
    const name = taken.has(row.preset.name)
      ? uniquePresetName(row.preset.name, taken)
      : row.preset.name;
    presets[slot] = { ...row.preset, name };
    entries[slot] = { name, content: row.content };
    added += 1;
    outcomes.push({ action: 'added', slot, name });
  });

  return {
    ok: needsSlots === 0,
    presets,
    added,
    overwritten,
    skipped,
    needsSlots,
    outcomes,
  };
}

// `Wave` -> `Wave (2)`, `Wave (2)` -> `Wave (3)`. The part before ` (n)` is
// shortened so the name keeps within the preset name limit.
export function uniquePresetName(name: string, taken: ReadonlySet<string>) {
  const base = name.replace(/ \(\d+\)$/, '') || name;
  for (let n = 2; ; n += 1) {
    const suffix = ` (${n})`;
    const candidate = `${base.slice(0, PRESET_NAME_MAX_LENGTH - suffix.length).trimEnd()}${suffix}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
}

// True when `savedName` is `name` itself, or a name Import may have given a
// copy of it: `name (n)`, with `name` shortened to keep within the limit.
export function isSameWorkName(savedName: string, name: string) {
  if (savedName === name) {
    return true;
  }
  const match = / \((\d+)\)$/.exec(savedName);
  if (!match || Number(match[1]) < 2) {
    return false;
  }
  const base = savedName.slice(0, match.index);
  const nameBase = name.replace(/ \(\d+\)$/, '') || name;
  return base === nameBase
    || (savedName.length === PRESET_NAME_MAX_LENGTH && nameBase.startsWith(base));
}

// Identical means every stored part is equal after both presets are
// normalised, except that a copy Import renamed still counts as the same.
// Keys are sorted, so the order they were written in does not count.
export function presetIdentityKey(preset: UserPreset) {
  return stableStringify(normalizeUserPreset(preset) ?? preset);
}

export function presetContentKey(preset: UserPreset) {
  const { name: _name, ...rest } = normalizeUserPreset(preset) ?? preset;
  return stableStringify(rest);
}

function entryOf(preset: UserPreset): Entry {
  return { name: preset.name, content: presetContentKey(preset) };
}

function holdsCopy(entries: ReadonlyArray<Entry | null>, entry: Entry) {
  return entries.some((item) => item
    && item.content === entry.content
    && (isSameWorkName(item.name, entry.name) || isSameWorkName(entry.name, item.name)));
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

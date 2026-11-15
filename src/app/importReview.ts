import {
  applyPresetImport,
  applyPresetReplace,
  defaultImportChoices,
  type PresetImportChoice,
  type PresetImportOutcome,
  type PresetImportPlan,
  type PresetImportResult,
} from '../sim/presetImport';
import type { UserPreset } from '../sim/presets';

export type ImportReviewMode = 'merge' | 'replace';

// What the panel decided: the slots to store and the status line to show.
export type ImportReviewResult = {
  presets: Array<UserPreset | null>;
  status: string;
};

// The import review panel: shows what a file would add, lets the user decide
// same-name presets and the work in progress, or replace every user preset
// with the file's, and writes nothing until the confirm button. Resolves with
// the slots to store, or null when cancelled.
export function openImportReview(
  host: HTMLElement,
  fileName: string,
  current: ReadonlyArray<UserPreset | null>,
  plan: PresetImportPlan,
  incoming: readonly UserPreset[],
): Promise<ImportReviewResult | null> {
  return new Promise((resolve) => {
    let mode: ImportReviewMode = 'merge';
    const replaceResult = applyPresetReplace(current, incoming);
    const choices = defaultImportChoices(plan);
    const freeSlots = current.filter((preset) => !preset).length;

    const dialog = document.createElement('dialog');
    dialog.className = 'import-review';
    dialog.setAttribute('aria-label', 'Import review');

    const title = document.createElement('h2');
    title.className = 'import-review__title';
    title.textContent = 'Import';
    const file = document.createElement('p');
    file.className = 'import-review__file';
    file.textContent = fileName;

    const summary = document.createElement('p');
    summary.className = 'import-review__summary';
    summary.textContent = importSummaryText(plan);
    const free = document.createElement('p');
    free.className = 'import-review__free';
    free.textContent = `Free slots: ${freeSlots}`;

    const modeLabel = document.createElement('label');
    modeLabel.className = 'import-review__mode';
    const modeText = document.createElement('span');
    modeText.textContent = 'Mode:';
    const modeSelect = document.createElement('select');
    modeSelect.className = 'hud__select import-review__choice import-review__mode-select';
    modeSelect.setAttribute('aria-label', 'Import mode');
    for (const [value, label] of [['merge', 'Merge'], ['replace', 'Replace all']]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      modeSelect.appendChild(option);
    }
    modeSelect.value = mode;
    modeSelect.addEventListener('change', () => {
      mode = modeSelect.value as ImportReviewMode;
      refresh();
    });
    modeLabel.append(modeText, modeSelect);

    const replaceNote = document.createElement('div');
    replaceNote.className = 'import-review__replace';
    const replaceSummary = document.createElement('p');
    replaceSummary.className = 'import-review__replace-summary';
    replaceSummary.textContent = replaceSummaryText(replaceResult.replaced, incoming.length);
    const replaceWarning = document.createElement('p');
    replaceWarning.className = 'import-review__warning';
    replaceWarning.textContent = 'Saved presets that are not in the file are lost. Export them first to keep them.';
    replaceNote.append(replaceSummary, replaceWarning);
    if (plan.counts.working > 0) {
      const workingNote = document.createElement('p');
      workingNote.className = 'import-review__free';
      workingNote.textContent = 'The work in progress is not used. Import it with Merge.';
      replaceNote.append(workingNote);
    }

    const list = document.createElement('div');
    list.className = 'import-review__list';

    const rowViews: Array<{ outcome: HTMLSpanElement; select: HTMLSelectElement | null }> = [];
    const conflictSelects: HTMLSelectElement[] = [];
    plan.rows.forEach((row, index) => {
      rowViews.push({ outcome: document.createElement('span'), select: null });
      if (row.kind === 'saved') {
        return;
      }

      const item = document.createElement('div');
      item.className = `import-review__row import-review__row--${row.kind}`;
      item.dataset.kind = row.kind;

      const name = document.createElement('span');
      name.className = 'import-review__name';
      name.textContent = row.preset.name;
      const tag = document.createElement('span');
      tag.className = 'import-review__tag';
      tag.textContent = row.kind === 'new'
        ? 'New'
        : row.kind === 'conflict'
          ? 'Same name, different'
          : 'Work in progress';

      const outcome = rowViews[index].outcome;
      outcome.className = 'import-review__outcome';
      item.append(name, tag);

      if (row.kind !== 'new') {
        const select = document.createElement('select');
        select.className = 'hud__select import-review__choice';
        select.setAttribute('aria-label', `Import choice for ${row.preset.name}`);
        const options: Array<[PresetImportChoice, string]> = row.kind === 'conflict'
          ? [['add', 'Add as new name'], ['overwrite', 'Overwrite'], ['skip', 'Skip']]
          : [['add', 'Add'], ['skip', 'Skip']];
        for (const [value, label] of options) {
          const option = document.createElement('option');
          option.value = value;
          option.textContent = label;
          select.appendChild(option);
        }
        select.value = choices[index];
        select.addEventListener('change', () => {
          choices[index] = select.value as PresetImportChoice;
          refresh();
        });
        rowViews[index].select = select;
        if (row.kind === 'conflict') {
          conflictSelects.push(select);
        }
        item.append(select);
      }
      item.append(outcome);
      list.appendChild(item);
    });

    const bulk = document.createElement('label');
    bulk.className = 'import-review__bulk';
    const hasBulk = conflictSelects.length >= 2;
    bulk.hidden = !hasBulk;
    const bulkText = document.createElement('span');
    bulkText.textContent = 'All same-name:';
    const bulkSelect = document.createElement('select');
    bulkSelect.className = 'hud__select import-review__choice';
    bulkSelect.setAttribute('aria-label', 'Choice for all same-name presets');
    for (const [value, label] of [
      ['', 'Choose...'],
      ['add', 'Add as new name'],
      ['overwrite', 'Overwrite'],
      ['skip', 'Skip'],
    ]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      bulkSelect.appendChild(option);
    }
    bulkSelect.addEventListener('change', () => {
      const value = bulkSelect.value as PresetImportChoice | '';
      if (!value) {
        return;
      }
      plan.rows.forEach((row, index) => {
        if (row.kind === 'conflict') {
          choices[index] = value;
          const select = rowViews[index].select;
          if (select) {
            select.value = value;
          }
        }
      });
      bulkSelect.value = '';
      refresh();
    });
    bulk.append(bulkText, bulkSelect);

    const message = document.createElement('p');
    message.className = 'import-review__message';
    message.setAttribute('role', 'status');

    const actions = document.createElement('div');
    actions.className = 'import-review__actions';
    const cancel = document.createElement('button');
    cancel.className = 'hud__button import-review__cancel';
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    const confirm = document.createElement('button');
    confirm.className = 'hud__button import-review__confirm';
    confirm.type = 'button';
    confirm.textContent = 'Import';
    actions.append(cancel, confirm);

    dialog.append(title, file, modeLabel, summary, free, replaceNote, bulk, list, message, actions);

    let result = applyPresetImport(current, plan, choices);
    const refresh = () => {
      const replacing = mode === 'replace';
      summary.hidden = replacing;
      free.hidden = replacing;
      bulk.hidden = replacing || !hasBulk;
      list.hidden = replacing;
      replaceNote.hidden = !replacing;
      confirm.textContent = replacing ? 'Replace' : 'Import';
      dialog.classList.toggle('import-review--replace', replacing);

      if (replacing) {
        confirm.disabled = !replaceResult.ok || !replaceResult.changes;
        message.textContent = !replaceResult.ok
          ? `The file holds ${incoming.length} presets, more than ${current.length} slots`
          : replaceResult.changes
            ? ''
            : 'The slots already hold these presets';
        message.classList.toggle('import-review__message--blocked', !replaceResult.ok);
        return;
      }

      result = applyPresetImport(current, plan, choices);
      result.outcomes.forEach((outcome, index) => {
        rowViews[index].outcome.textContent = outcomeText(outcome);
      });
      const nothing = result.added + result.overwritten === 0;
      confirm.disabled = !result.ok || nothing;
      message.textContent = !result.ok
        ? `Needs ${result.needsSlots} more ${result.needsSlots === 1 ? 'slot' : 'slots'}`
        : importNeedsReview(plan)
          ? `Adds ${result.added}, overwrites ${result.overwritten}, skips ${result.skipped}`
          : `Nothing new (${plan.counts.saved} already saved)`;
      message.classList.toggle('import-review__message--blocked', !result.ok);
    };
    refresh();

    let settled = false;
    const finish = (value: ImportReviewResult | null) => {
      if (settled) {
        return;
      }
      settled = true;
      if (dialog.open) {
        dialog.close();
      }
      dialog.remove();
      resolve(value);
    };
    cancel.addEventListener('click', () => finish(null));
    confirm.addEventListener('click', () => {
      if (confirm.disabled) {
        return;
      }
      if (mode === 'replace') {
        finish({
          presets: replaceResult.presets,
          status: `Replaced ${replaceResult.replaced} with ${replaceResult.added}`,
        });
      } else if (result.ok) {
        finish({ presets: result.presets, status: importStatusText(result) });
      }
    });
    // Escape closes a modal dialog without a click.
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      finish(null);
    });
    // Keys inside the panel must not reach the app's own shortcuts.
    dialog.addEventListener('keydown', (event) => {
      event.stopPropagation();
    });

    host.appendChild(dialog);
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  });
}

export function importSummaryText(plan: PresetImportPlan) {
  const { counts } = plan;
  const parts = [`${counts.new} new`, `${counts.saved} already saved`];
  if (counts.conflict > 0) {
    parts.push(`${counts.conflict} same name, different`);
  }
  if (counts.working > 0) {
    parts.push('work in progress');
  }
  return parts.join(' · ');
}

// The panel opens only when the file has something to decide or add.
export function importNeedsReview(plan: PresetImportPlan) {
  return plan.counts.new + plan.counts.conflict + plan.counts.working > 0;
}

// The panel opens when Merge has something to decide or add, or when
// `Replace all` would change the slots.
export function importNeedsPanel(
  plan: PresetImportPlan,
  current: ReadonlyArray<UserPreset | null>,
  incoming: readonly UserPreset[],
) {
  return importNeedsReview(plan) || applyPresetReplace(current, incoming).changes;
}

export function replaceSummaryText(saved: number, fromFile: number) {
  return `Replaces ${saved} saved ${saved === 1 ? 'preset' : 'presets'} with ${fromFile} from the file`;
}

export function importStatusText(result: PresetImportResult) {
  return `Added ${result.added} · Overwrote ${result.overwritten} · Skipped ${result.skipped}`;
}

function outcomeText(outcome: PresetImportOutcome) {
  switch (outcome.action) {
    case 'added':
      return `→ ${slotName(outcome.slot)}: ${outcome.name}`;
    case 'overwritten':
      return `→ overwrites ${slotName(outcome.slot)}`;
    case 'skipped':
      return 'Not imported';
    case 'no-slot':
      return 'No free slot';
  }
}

function slotName(index: number) {
  return `U${String(index + 1).padStart(2, '0')}`;
}

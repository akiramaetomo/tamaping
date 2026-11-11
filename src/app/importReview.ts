import {
  applyPresetImport,
  defaultImportChoices,
  type PresetImportChoice,
  type PresetImportOutcome,
  type PresetImportPlan,
  type PresetImportResult,
} from '../sim/presetImport';
import type { UserPreset } from '../sim/presets';

// The import review panel: shows what a file would add, lets the user decide
// same-name presets and the work in progress, and writes nothing until
// `Import`. Resolves with the result to store, or null when cancelled.
export function openImportReview(
  host: HTMLElement,
  fileName: string,
  current: ReadonlyArray<UserPreset | null>,
  plan: PresetImportPlan,
): Promise<PresetImportResult | null> {
  return new Promise((resolve) => {
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
    bulk.hidden = conflictSelects.length < 2;
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

    dialog.append(title, file, summary, free, bulk, list, message, actions);

    let result = applyPresetImport(current, plan, choices);
    const refresh = () => {
      result = applyPresetImport(current, plan, choices);
      result.outcomes.forEach((outcome, index) => {
        rowViews[index].outcome.textContent = outcomeText(outcome);
      });
      confirm.disabled = !result.ok || result.added + result.overwritten === 0;
      message.textContent = result.ok
        ? `Adds ${result.added}, overwrites ${result.overwritten}, skips ${result.skipped}`
        : `Needs ${result.needsSlots} more ${result.needsSlots === 1 ? 'slot' : 'slots'}`;
      message.classList.toggle('import-review__message--blocked', !result.ok);
    };
    refresh();

    let settled = false;
    const finish = (value: PresetImportResult | null) => {
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
      if (result.ok) {
        finish(result);
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

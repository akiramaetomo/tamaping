import {
  FACTORY_PRESETS,
  USER_PRESET_COUNT,
  type UserPreset,
} from '../sim/presets';
import { createToggle } from './controls';
import { effectivePresetMessageText, presetDisplayLabel } from './messageFormation';

type PresetPanelCallbacks = {
  onPresetChange(value: string): void;
  onSaveCurrent(): void;
  onDeleteSelected(): void;
  onExportCurrent(): void;
  onExportUsers(): void;
  onImportFile(input: HTMLInputElement): void;
  getCurrentFormationLabel(): string | null;
  onFrontMenuChange(visible: boolean): void;
};

export class PresetPanel {
  readonly element: HTMLDivElement;
  // Hosts the My Panel pick marker, which cannot be nested inside the select.
  readonly selectRow: HTMLSpanElement;
  // Bumped whenever the preset list changes, so My Panel copies refill only then.
  optionsVersion = 0;

  private readonly presetSelect: HTMLSelectElement;
  private readonly saveSlotSelect: HTMLSelectElement;
  private readonly saveNameInput: HTMLInputElement;
  private readonly saveFormationLabelInput: HTMLInputElement;
  private readonly saveButton: HTMLButtonElement;
  private readonly deleteButton: HTMLButtonElement;
  private readonly statusEl: HTMLSpanElement;
  private readonly frontMenuInput: HTMLInputElement;
  private userPresets: Array<UserPreset | null>;

  constructor(
    callbacks: PresetPanelCallbacks,
    userPresets: Array<UserPreset | null>,
    selectedValue: string,
    frontMenuVisible: boolean,
  ) {
    this.userPresets = userPresets;

    const wrap = document.createElement('div');
    wrap.className = 'hud__preset';

    const title = document.createElement('span');
    title.className = 'hud__preset-title';
    title.textContent = 'Preset';

    const frontMenu = createToggle('Front menu', frontMenuVisible);
    frontMenu.wrap.classList.add('hud__preset-front-menu');
    frontMenu.wrap.title = 'Show the preset bar at the top of the stage';
    frontMenu.input.addEventListener('change', () => {
      callbacks.onFrontMenuChange(frontMenu.input.checked);
    });
    this.frontMenuInput = frontMenu.input;

    this.presetSelect = document.createElement('select');
    this.presetSelect.className = 'hud__select hud__preset-select';
    this.presetSelect.setAttribute('aria-label', 'Preset');
    this.presetSelect.addEventListener('change', () => {
      callbacks.onPresetChange(this.presetSelect.value);
    });
    this.selectRow = document.createElement('span');
    this.selectRow.className = 'hud__preset-select-row';
    this.selectRow.append(this.presetSelect);

    const saveLabel = document.createElement('span');
    saveLabel.className = 'hud__preset-save-label';
    saveLabel.textContent = 'Save to';

    this.saveSlotSelect = document.createElement('select');
    this.saveSlotSelect.className = 'hud__select hud__preset-save-select';
    this.saveSlotSelect.setAttribute('aria-label', 'Save preset destination');
    this.saveSlotSelect.addEventListener('change', () => {
      this.syncSaveDestination(callbacks.getCurrentFormationLabel());
    });

    this.saveNameInput = document.createElement('input');
    this.saveNameInput.className = 'hud__preset-name';
    this.saveNameInput.type = 'text';
    this.saveNameInput.maxLength = 40;
    this.saveNameInput.placeholder = 'Preset name';
    this.saveNameInput.setAttribute('aria-label', 'Preset name');

    this.saveFormationLabelInput = document.createElement('input');
    this.saveFormationLabelInput.className = 'hud__preset-name';
    this.saveFormationLabelInput.type = 'text';
    this.saveFormationLabelInput.maxLength = 40;
    this.saveFormationLabelInput.placeholder = 'Name text';
    this.saveFormationLabelInput.setAttribute('aria-label', 'Name particle text');

    this.saveButton = document.createElement('button');
    this.saveButton.className = 'hud__button hud__preset-save';
    this.saveButton.type = 'button';
    this.saveButton.textContent = 'Save Current';
    this.saveButton.disabled = true;
    this.saveButton.addEventListener('click', () => {
      callbacks.onSaveCurrent();
    });

    this.deleteButton = document.createElement('button');
    this.deleteButton.className = 'hud__button hud__preset-delete';
    this.deleteButton.type = 'button';
    this.deleteButton.textContent = 'Delete';
    this.deleteButton.disabled = true;
    this.deleteButton.addEventListener('click', () => {
      callbacks.onDeleteSelected();
    });

    const exportCurrent = document.createElement('button');
    exportCurrent.className = 'hud__button hud__preset-export';
    exportCurrent.type = 'button';
    exportCurrent.textContent = 'Export Current';
    exportCurrent.addEventListener('click', () => {
      callbacks.onExportCurrent();
    });

    const exportUsers = document.createElement('button');
    exportUsers.className = 'hud__button hud__preset-export';
    exportUsers.type = 'button';
    exportUsers.textContent = 'Export Users';
    exportUsers.addEventListener('click', () => {
      callbacks.onExportUsers();
    });

    const importInput = document.createElement('input');
    importInput.type = 'file';
    importInput.accept = 'application/json,.json';
    importInput.hidden = true;
    importInput.addEventListener('change', () => {
      callbacks.onImportFile(importInput);
    });

    const importButton = document.createElement('button');
    importButton.className = 'hud__button hud__preset-export';
    importButton.type = 'button';
    importButton.textContent = 'Import';
    importButton.addEventListener('click', () => {
      importInput.click();
    });

    this.statusEl = document.createElement('span');
    this.statusEl.className = 'hud__preset-status';
    this.statusEl.textContent = 'Ready';

    wrap.append(
      title,
      frontMenu.wrap,
      this.selectRow,
      saveLabel,
      this.saveSlotSelect,
      this.saveNameInput,
      this.saveFormationLabelInput,
      this.saveButton,
      this.deleteButton,
      exportCurrent,
      exportUsers,
      importButton,
      importInput,
      this.statusEl,
    );

    this.element = wrap;
    this.renderPresetOptions(selectedValue, userPresets);
    this.renderSaveDestinationOptions('', userPresets, callbacks.getCurrentFormationLabel());
  }

  get saveName() {
    return this.saveNameInput.value;
  }

  get formationLabel() {
    return this.saveFormationLabelInput.value;
  }

  selectedUserPresetSlot() {
    return selectedUserPresetSlot(this.saveSlotSelect);
  }

  renderPresetOptions(selectedValue: string, userPresets: Array<UserPreset | null>) {
    this.userPresets = userPresets;
    fillPresetOptions(this.presetSelect, userPresets);
    this.optionsVersion += 1;
    this.syncPresetSelectSelection(selectedValue);
  }

  renderSaveDestinationOptions(
    selectedValue: string,
    userPresets: Array<UserPreset | null>,
    currentFormationLabel: string | null,
  ) {
    this.userPresets = userPresets;
    this.saveSlotSelect.replaceChildren();

    const noDestination = document.createElement('option');
    noDestination.value = '';
    noDestination.textContent = 'Not selected';
    this.saveSlotSelect.appendChild(noDestination);

    for (let index = 0; index < USER_PRESET_COUNT; index += 1) {
      const option = document.createElement('option');
      option.value = `${index}`;
      option.textContent = userSlotLabel(index, userPresets[index]);
      this.saveSlotSelect.appendChild(option);
    }

    this.saveSlotSelect.value = selectedValue;
    this.syncSaveDestination(currentFormationLabel);
  }

  syncSaveDestination(currentFormationLabel: string | null) {
    const index = this.selectedUserPresetSlot();
    const hasDestination = index !== null;

    this.saveButton.disabled = !hasDestination;
    this.deleteButton.disabled = index === null || !this.userPresets[index];

    if (!hasDestination) {
      this.saveNameInput.value = '';
      this.saveFormationLabelInput.value = '';
      return;
    }

    const destinationPreset = this.userPresets[index];
    this.saveNameInput.value = destinationPreset?.name ?? `User ${index + 1}`;
    this.saveFormationLabelInput.value =
      effectivePresetFormationLabel(destinationPreset) ?? currentFormationLabel ?? '';
  }

  syncPresetSelectSelection(activePresetValue: string) {
    this.presetSelect.value = activePresetValue;
    if (this.presetSelect.value !== activePresetValue) {
      this.presetSelect.value = 'custom';
      return 'custom';
    }

    return activePresetValue;
  }

  set frontMenuVisible(visible: boolean) {
    this.frontMenuInput.checked = visible;
  }

  setStatus(status: string) {
    this.statusEl.textContent = status;
    this.statusEl.classList.toggle(
      'hud__preset-status--modified',
      status === 'Modified',
    );
  }
}

export function fillPresetOptions(
  select: HTMLSelectElement,
  userPresets: Array<UserPreset | null>,
) {
  select.replaceChildren();

  const custom = document.createElement('option');
  custom.value = 'custom';
  custom.textContent = 'Custom tuning';
  custom.disabled = true;
  select.appendChild(custom);

  const factoryGroup = document.createElement('optgroup');
  factoryGroup.label = 'Factory Presets';
  for (const [index, preset] of FACTORY_PRESETS.entries()) {
    const option = document.createElement('option');
    option.value = `factory:${preset.id}`;
    option.textContent = factorySlotLabel(index, preset.name, preset.formationLabel);
    factoryGroup.appendChild(option);
  }
  select.appendChild(factoryGroup);

  const userGroup = document.createElement('optgroup');
  userGroup.label = 'User Presets';
  for (let index = 0; index < USER_PRESET_COUNT; index += 1) {
    const preset = userPresets[index];
    const option = document.createElement('option');
    option.value = `user:${index}`;
    option.textContent = preset ? userSlotLabel(index, preset) : `${userSlotPrefix(index)} (empty)`;
    option.disabled = !preset;
    userGroup.appendChild(option);
  }
  select.appendChild(userGroup);
}

// Mirrors PresetPanel.syncPresetSelectSelection for selects outside the Preset card.
export function syncPresetSelectValue(select: HTMLSelectElement, activePresetValue: string) {
  select.value = activePresetValue;
  if (select.value !== activePresetValue) {
    select.value = 'custom';
  }
}

function userSlotLabel(index: number, preset: UserPreset | null | undefined) {
  const slot = userSlotPrefix(index);
  return preset ? `${slot}: ${presetDisplayLabel(preset.name, preset.formationLabel)}` : slot;
}

function userSlotPrefix(index: number) {
  return `U${String(index + 1).padStart(2, '0')}`;
}

function factorySlotLabel(
  index: number,
  name: string,
  formationLabel: string | null | undefined,
) {
  const slot = `F${String(index + 1).padStart(2, '0')}`;
  return `${slot}: ${presetDisplayLabel(factoryDisplayName(name), formationLabel)}`;
}

function factoryDisplayName(name: string) {
  return name
    .replace(/^\d+\.\s*/, '')
    .replace(/^✦(\d+)\s*/, '✦ ')
    .trim();
}

function effectivePresetFormationLabel(preset: UserPreset | null | undefined) {
  if (!preset) {
    return null;
  }

  return effectivePresetMessageText(preset.name, preset.formationLabel);
}

function selectedUserPresetSlot(select: HTMLSelectElement | null) {
  if (!select || select.value === '') {
    return null;
  }

  const index = Number(select.value);
  return Number.isInteger(index) && index >= 0 && index < USER_PRESET_COUNT
    ? index
    : null;
}

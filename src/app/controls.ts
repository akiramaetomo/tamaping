export type RangeControl = {
  wrap: HTMLLabelElement;
  input: HTMLInputElement;
  value: HTMLSpanElement;
};

export type SelectControl = {
  wrap: HTMLLabelElement;
  input: HTMLSelectElement;
};

export type ToggleControl = {
  wrap: HTMLLabelElement;
  input: HTMLInputElement;
};

export function createRange(
  labelText: string,
  min: number,
  max: number,
  step: number,
  initial: number,
): RangeControl {
  const wrap = document.createElement('label');
  wrap.className = 'hud__control';

  const label = document.createElement('span');
  label.textContent = labelText;

  const input = document.createElement('input');
  input.type = 'range';
  input.min = `${min}`;
  input.max = `${max}`;
  input.step = `${step}`;
  input.value = `${initial}`;

  const value = document.createElement('span');
  value.className = 'hud__value';
  value.textContent = `${initial}`;

  wrap.append(label, input, value);
  return { wrap, input, value };
}

export function createSelect(labelText: string, values: number[], initial: number): SelectControl {
  const wrap = document.createElement('label');
  wrap.className = 'hud__control hud__control--select';

  const label = document.createElement('span');
  label.textContent = labelText;

  const input = document.createElement('select');
  input.className = 'hud__select';
  for (const value of values) {
    const option = document.createElement('option');
    option.value = `${value}`;
    option.textContent = `${value}`;
    input.appendChild(option);
  }
  input.value = `${initial}`;

  wrap.append(label, input);
  return { wrap, input };
}

export function createTextSelect<T extends string | number>(
  labelText: string,
  values: Array<[T, string]>,
  initial: T,
): SelectControl {
  const wrap = document.createElement('label');
  wrap.className = 'hud__control hud__control--select';

  const label = document.createElement('span');
  label.textContent = labelText;

  const input = document.createElement('select');
  input.className = 'hud__select';
  for (const [value, text] of values) {
    const option = document.createElement('option');
    option.value = `${value}`;
    option.textContent = text;
    input.appendChild(option);
  }
  input.value = `${initial}`;

  wrap.append(label, input);
  return { wrap, input };
}

export function createToggle(labelText: string, initial: boolean): ToggleControl {
  const wrap = document.createElement('label');
  wrap.className = 'hud__toggle';

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = initial;

  const label = document.createElement('span');
  label.textContent = labelText;

  wrap.append(input, label);
  return { wrap, input };
}

export function createSettingsGroup(
  titleText: string,
  accent: string,
  controls: HTMLElement[],
  titleAction?: HTMLElement | HTMLElement[],
) {
  const group = document.createElement('div');
  group.className = `hud__group hud__group--${accent}`;

  const header = document.createElement('div');
  header.className = 'hud__group-header';

  const title = document.createElement('span');
  title.className = 'hud__group-title';
  title.textContent = titleText;

  header.append(title);
  if (titleAction) {
    const actionWrap = document.createElement('div');
    actionWrap.className = 'hud__group-actions';
    const actions = Array.isArray(titleAction) ? titleAction : [titleAction];
    for (const action of actions) {
      action.classList.add('hud__group-title-action');
      actionWrap.append(action);
    }
    header.append(actionWrap);
  }

  group.append(header, ...controls);
  return group;
}

const SECTION_STORAGE_KEY = 'dotping.settingsSections.v1';

function readSectionState(): Record<string, boolean> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SECTION_STORAGE_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeSectionOpen(id: string, open: boolean) {
  try {
    const state = readSectionState();
    state[id] = open;
    window.localStorage.setItem(SECTION_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // A per-viewer convenience only; the section still works without storage.
  }
}

// A foldable section inside a settings card. `id` keys the viewer's
// open/closed state in local storage; without a stored state it is closed.
export function createSettingsSection(id: string, titleText: string, controls: HTMLElement[]) {
  const section = document.createElement('details');
  section.className = 'hud__section';
  section.dataset.section = id;
  section.open = readSectionState()[id] === true;

  const summary = document.createElement('summary');
  summary.className = 'hud__section-title';
  summary.textContent = titleText;

  const body = document.createElement('div');
  body.className = 'hud__section-body';
  body.append(...controls);

  section.append(summary, body);
  section.addEventListener('toggle', () => writeSectionOpen(id, section.open));
  return section;
}

// A headed group of detail rows inside a foldable section. `header` is a title
// or a control such as an effect's on/off toggle. With `hideDisabled`, rows that
// do not currently apply are hidden, keeping only what can be adjusted.
export function createSettingsSubgroup(
  header: string | HTMLElement,
  rows: HTMLElement[],
  hideDisabled = false,
) {
  const group = document.createElement('div');
  group.className = 'hud__subgroup';
  group.classList.toggle('hud__subgroup--hide-disabled', hideDisabled);

  let headerEl: HTMLElement;
  if (typeof header === 'string') {
    headerEl = document.createElement('div');
    headerEl.textContent = header;
  } else {
    headerEl = header;
  }
  headerEl.classList.add('hud__subgroup-title');

  const body = document.createElement('div');
  body.className = 'hud__subgroup-body';
  body.append(...rows);

  group.append(headerEl, body);
  return group;
}

// One row of short on/off toggles, such as a card's effects.
export function createEffectToggleRow(toggles: HTMLElement[]) {
  const row = document.createElement('div');
  row.className = 'hud__effect-toggles';
  row.append(...toggles);
  return row;
}

// Absolutely positioned in the host's left padding so the host layout does not change.
export function attachPickButton(host: HTMLElement, label: string, onClick: () => void) {
  const button = document.createElement('button');
  button.className = 'hud__pick';
  button.type = 'button';
  button.setAttribute('aria-pressed', 'false');
  button.dataset.label = label;
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  host.classList.add('hud__pickable');
  host.append(button);
  return button;
}

export function createSettingsTabs<T extends string>(
  tabs: ReadonlyArray<readonly [T, string]>,
  onSelect: (id: T) => void,
) {
  const element = document.createElement('div');
  element.className = 'hud__tabs';
  element.setAttribute('role', 'tablist');
  element.setAttribute('aria-label', 'Settings sections');
  const buttons = new Map<T, HTMLButtonElement>();
  for (const [id, text] of tabs) {
    const button = document.createElement('button');
    button.className = 'hud__tab';
    button.type = 'button';
    button.textContent = text;
    button.dataset.tab = id;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', 'false');
    button.addEventListener('click', () => onSelect(id));
    buttons.set(id, button);
    element.append(button);
  }

  const select = (id: T) => {
    for (const [buttonId, button] of buttons) {
      button.setAttribute('aria-selected', `${buttonId === id}`);
    }
    // Scroll only the tab strip; scrollIntoView could also move the settings panel.
    const button = buttons.get(id);
    if (!button) {
      return;
    }
    const start = button.offsetLeft;
    const end = start + button.offsetWidth;
    if (start < element.scrollLeft) {
      element.scrollLeft = start;
    } else if (end > element.scrollLeft + element.clientWidth) {
      element.scrollLeft = end - element.clientWidth;
    }
  };

  return { element, select };
}

export function createPinButton<T extends string>(
  id: T,
  title: string,
  onClick: (id: T) => void,
) {
  const button = document.createElement('button');
  button.className = 'hud__button hud__pin-button';
  button.type = 'button';
  button.textContent = 'Pin';
  button.title = `Pin ${title} settings to front`;
  button.setAttribute('aria-label', `Pin ${title} settings to front`);
  button.setAttribute('aria-pressed', 'false');
  button.addEventListener('click', () => onClick(id));
  return button;
}

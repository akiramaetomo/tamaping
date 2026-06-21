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

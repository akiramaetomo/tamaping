import type { ControlDefinition } from './controlRegistry';
import {
  createRange,
  createTextSelect,
  createToggle,
  type RangeControl,
} from './controls';

// Builders that turn a declarative setting spec into a ControlDefinition. The
// same definition creates the source card control and any My Panel copy.

type ControlCardId = ControlDefinition['card'];

type ControlSpecBase = {
  id: string;
  card: ControlCardId;
  label: string;
  panelLabel: string;
};

export type RangeSettingSpec = ControlSpecBase & {
  min: number;
  max: number;
  step: number;
  slider: () => number;
  format: () => string;
  onInput: (value: number) => void;
  enabled?: () => boolean;
  // Returns an optional cleanup for when a My Panel copy is removed.
  decorate?: (control: RangeControl) => (() => void) | void;
};

export type SelectSettingSpec<T extends string | number> = ControlSpecBase & {
  options: Array<[T, string]>;
  read: () => T;
  onChange: (value: string) => void;
  title?: string;
};

export type ToggleSettingSpec = ControlSpecBase & {
  read: () => boolean;
  onChange: (checked: boolean) => void;
  enabled?: () => boolean;
  // Layout class used only inside the source card, not in My Panel.
  primaryClassName?: string;
};

export type ActionControlSpec = ControlSpecBase & {
  title: string;
  onClick: (button: HTMLButtonElement) => void;
  primaryClassName?: string;
};

export function rangeSetting(spec: RangeSettingSpec): ControlDefinition {
  return {
    id: spec.id,
    card: spec.card,
    kind: 'setting',
    panelLabel: spec.panelLabel,
    create: (label, changed) => {
      const control = createRange(label ?? spec.label, spec.min, spec.max, spec.step, spec.slider());
      control.value.textContent = spec.format();
      control.input.addEventListener('input', () => {
        spec.onInput(Number(control.input.value));
        control.value.textContent = spec.format();
        changed();
      });
      const dispose = spec.decorate?.(control) ?? undefined;
      const syncEnabled = () => {
        if (spec.enabled) {
          const enabled = spec.enabled();
          control.input.disabled = !enabled;
          control.wrap.classList.toggle('is-disabled', !enabled);
        }
      };
      syncEnabled();
      return {
        element: control.wrap,
        sync: () => {
          control.input.value = `${spec.slider()}`;
          control.value.textContent = spec.format();
          syncEnabled();
        },
        dispose,
      };
    },
  };
}

export function selectSetting<T extends string | number>(spec: SelectSettingSpec<T>): ControlDefinition {
  return {
    id: spec.id,
    card: spec.card,
    kind: 'setting',
    panelLabel: spec.panelLabel,
    create: (label, changed) => {
      const control = createTextSelect<T>(label ?? spec.label, spec.options, spec.read());
      syncSelectValue(control.input, spec.read());
      if (spec.title) {
        control.input.title = spec.title;
      }
      control.input.addEventListener('change', () => {
        spec.onChange(control.input.value);
        changed();
      });
      return {
        element: control.wrap,
        sync: () => syncSelectValue(control.input, spec.read()),
      };
    },
  };
}

export function toggleSetting(spec: ToggleSettingSpec): ControlDefinition {
  return {
    id: spec.id,
    card: spec.card,
    kind: 'setting',
    panelLabel: spec.panelLabel,
    create: (label, changed) => {
      const control = createToggle(label ?? spec.label, spec.read());
      if (label === null && spec.primaryClassName) {
        control.wrap.classList.add(spec.primaryClassName);
      }
      const sync = () => {
        control.input.checked = spec.read();
        if (spec.enabled) {
          const enabled = spec.enabled();
          control.input.disabled = !enabled;
          control.wrap.classList.toggle('is-disabled', !enabled);
        }
      };
      control.input.addEventListener('change', () => {
        spec.onChange(control.input.checked);
        changed();
      });
      sync();
      return { element: control.wrap, sync };
    },
  };
}

export function actionControl(spec: ActionControlSpec): ControlDefinition {
  return {
    id: spec.id,
    card: spec.card,
    kind: 'action',
    panelLabel: spec.panelLabel,
    create: (label) => {
      // The wrapper hosts the pick marker, which cannot be nested inside a button.
      const wrap = document.createElement('span');
      wrap.className = 'hud__action';
      if (label === null && spec.primaryClassName) {
        wrap.classList.add(spec.primaryClassName);
      }
      const button = document.createElement('button');
      button.className = 'hud__button';
      button.type = 'button';
      button.textContent = label ?? spec.label;
      button.title = spec.title;
      button.setAttribute('aria-label', spec.title);
      button.addEventListener('click', () => spec.onClick(button));
      wrap.append(button);
      return { element: wrap, sync: () => {} };
    },
  };
}

// Selects `value`, adding a generated option when the list lacks it. Earlier
// generated options are removed so non-standard preset values do not pile up.
export function syncSelectValue(select: HTMLSelectElement, value: string | number) {
  const nextValue = `${value}`;
  for (const option of Array.from(select.options)) {
    if (option.dataset.generated === 'true' && option.value !== nextValue) {
      option.remove();
    }
  }
  if (!Array.from(select.options).some((option) => option.value === nextValue)) {
    const option = document.createElement('option');
    option.value = nextValue;
    option.textContent = nextValue;
    option.dataset.generated = 'true';
    select.appendChild(option);
  }
  select.value = nextValue;
}

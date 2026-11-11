import {
  START_BALL_SPEED_MAX,
  START_BALL_SPEED_STEP,
  START_FORMATIONS,
  START_PARTICLE_SPEED_MAX,
  START_PARTICLE_SPEED_STEP,
  START_POSITION_MAX,
  normalizePresetStart,
  type PresetStart,
  type StartFormation,
} from '../sim/presetStart';
import { createRange, createTextSelect, type RangeControl } from './controls';

// The `Start` block in the Preset card: how the current work begins. A value
// takes effect when it is committed (a select change, or releasing a slider),
// which replays the start so the author sees it.

type NumberKey = 'ballX' | 'ballY' | 'ballSpeed' | 'particleSpeed';

export class StartControls {
  readonly element: HTMLDivElement;

  private readonly formation: HTMLSelectElement;
  private readonly ranges = new Map<NumberKey, RangeControl>();
  private value: PresetStart;

  constructor(initial: PresetStart, onCommit: (start: PresetStart) => void) {
    this.value = normalizePresetStart(initial);

    const block = document.createElement('div');
    block.className = 'hud__preset-start';

    const title = document.createElement('span');
    title.className = 'hud__preset-start-title';
    title.textContent = 'Start';
    title.title = 'How this work begins when it is selected, restarted or reset';

    const formation = createTextSelect<StartFormation>(
      'Formation',
      [...START_FORMATIONS],
      this.value.formation,
    );
    formation.wrap.title = 'Where the particles start';
    formation.input.addEventListener('change', () => {
      this.value = normalizePresetStart({ ...this.value, formation: formation.input.value });
      onCommit(this.get());
    });
    this.formation = formation.input;

    const rows: Array<[NumberKey, string, number, number, string, string]> = [
      ['ballX', 'Ball X', START_POSITION_MAX, 1, '%', 'Ball start position across the stage'],
      ['ballY', 'Ball Y', START_POSITION_MAX, 1, '%', 'Ball start position down the stage'],
      ['ballSpeed', 'Ball speed', START_BALL_SPEED_MAX, START_BALL_SPEED_STEP, '', 'Ball start speed in px/s, random direction'],
      ['particleSpeed', 'Particle speed', START_PARTICLE_SPEED_MAX, START_PARTICLE_SPEED_STEP, '', 'Particle start speed in px/s; along the spiral for Spiral, otherwise random'],
    ];

    block.append(title, formation.wrap);
    for (const [key, label, max, step, unit, hint] of rows) {
      const range = createRange(label, 0, max, step, this.value[key]);
      range.wrap.title = hint;
      range.input.addEventListener('input', () => {
        range.value.textContent = formatValue(Number(range.input.value), unit);
      });
      range.input.addEventListener('change', () => {
        this.value = normalizePresetStart({ ...this.value, [key]: Number(range.input.value) });
        onCommit(this.get());
      });
      range.value.dataset.unit = unit;
      this.ranges.set(key, range);
      block.append(range.wrap);
    }

    this.element = block;
    this.set(this.value);
  }

  get(): PresetStart {
    return { ...this.value };
  }

  set(start: PresetStart) {
    this.value = normalizePresetStart(start);
    this.formation.value = this.value.formation;
    for (const [key, range] of this.ranges) {
      range.input.value = `${this.value[key]}`;
      range.value.textContent = formatValue(this.value[key], range.value.dataset.unit ?? '');
    }
  }
}

function formatValue(value: number, unit: string) {
  return `${Math.round(value)}${unit}`;
}

import type { SettingsCardId } from './settingsTabs';

export type ControlKind = 'setting' | 'action';

export type ControlInstance = {
  element: HTMLElement;
  sync: () => void;
  dispose?: () => void;
};

export type ControlDefinition = {
  id: string;
  card: Exclude<SettingsCardId, 'my'>;
  kind: ControlKind;
  // Label used inside My Panel, where the source card is not visible.
  panelLabel: string;
  // `changed` re-syncs every other live copy after this copy edits settings.
  create: (label: string | null, changed: () => void) => ControlInstance;
};

type LiveInstance = ControlInstance & { id: string };

export class ControlRegistry {
  private readonly definitions = new Map<string, ControlDefinition>();
  private readonly instances: LiveInstance[] = [];

  define(definition: ControlDefinition) {
    if (this.definitions.has(definition.id)) {
      throw new Error(`Duplicate control id: ${definition.id}`);
    }
    this.definitions.set(definition.id, definition);
    return this.createInstance(definition.id, null);
  }

  createInstance(id: string, label: string | null): LiveInstance {
    const definition = this.definitions.get(id);
    if (!definition) {
      throw new Error(`Unknown control id: ${id}`);
    }

    let live: LiveInstance | null = null;
    const instance = definition.create(label, () => {
      if (live) {
        this.syncAll(live);
      }
    });
    live = { ...instance, id };
    this.instances.push(live);
    return live;
  }

  release(instance: LiveInstance) {
    const index = this.instances.indexOf(instance);
    if (index >= 0) {
      this.instances.splice(index, 1);
      instance.dispose?.();
    }
  }

  definition(id: string) {
    return this.definitions.get(id) ?? null;
  }

  ids() {
    return new Set(this.definitions.keys());
  }

  syncId(id: string) {
    for (const instance of this.instances) {
      if (instance.id === id) {
        instance.sync();
      }
    }
  }

  syncAll(except: LiveInstance | null = null) {
    for (const instance of this.instances) {
      if (instance !== except) {
        instance.sync();
      }
    }
  }
}

export type { LiveInstance as LiveControlInstance };

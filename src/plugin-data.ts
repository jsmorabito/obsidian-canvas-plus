import { Plugin, debounce } from 'obsidian';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * The plugin's `data.json`, shared by everything that keeps something in it (settings, tab panels).
 * One object holds it all, so each part's save writes the others' keys back as they are.
 */
export class PluginData {
  /** Mutated in place, never replaced: the parts hold on to it. Call `save` after changing it. */
  readonly root: Record<string, unknown> = {};
  readonly ready: Promise<void>;
  readonly save = debounce(() => { void this.plugin.saveData(this.root); }, 500, true);

  constructor(private plugin: Plugin) {
    this.ready = this.load();
  }

  /** What was loaded goes under anything already written, one level deep (panels and held lists are keyed by canvas path). */
  private async load(): Promise<void> {
    const loaded = (await this.plugin.loadData()) as unknown;
    if (!isRecord(loaded)) return;
    for (const [key, value] of Object.entries(loaded)) {
      const current = this.root[key];
      this.root[key] = isRecord(value) && isRecord(current) ? { ...value, ...current } : current ?? value;
    }
  }

  flush(): void {
    this.save.run();
  }
}

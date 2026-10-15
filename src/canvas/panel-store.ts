import { Plugin, TAbstractFile, ViewState, debounce } from 'obsidian';

/** A tab panel's position in pixels over its canvas pane, and what it shows. */
export interface PanelRecord {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  state?: ViewState;
}

interface StoredData {
  /** By canvas path. */
  panels?: Record<string, PanelRecord[]>;
  /** Panels put in a canvas's tray, by canvas path. */
  held?: Record<string, PanelRecord[]>;
}

type ListKey = 'panels' | 'held';

/** Shared, so a canvas with nothing held always gets the same list back. */
const NONE: PanelRecord[] = [];

/** Tab panels, and those put in a tray, persisted in the plugin's data. Writes are debounced; `flush` writes them now. */
export class PanelStore {
  private data: StoredData = {};
  readonly ready: Promise<void>;
  private save = debounce(() => { void this.plugin.saveData(this.data); }, 500, true);

  constructor(private plugin: Plugin) {
    this.ready = this.load();
    plugin.registerEvent(plugin.app.vault.on('rename', (file, oldPath) => this.onRename(file, oldPath)));
    plugin.registerEvent(plugin.app.vault.on('delete', (file) => this.onDelete(file)));
  }

  private async load(): Promise<void> {
    const loaded = (await this.plugin.loadData()) as StoredData | null;
    this.data = { ...loaded, panels: { ...loaded?.panels, ...this.data.panels }, held: { ...loaded?.held, ...this.data.held } };
  }

  get(path: string): PanelRecord[] {
    return this.data.panels?.[path] ?? [];
  }

  /** The panels in a canvas's tray. The same list until it changes. */
  getHeld(path: string): PanelRecord[] {
    return this.data.held?.[path] ?? NONE;
  }

  hold(path: string, record: PanelRecord): void {
    this.write(path, [...this.getHeld(path), { ...record }], 'held');
  }

  unhold(path: string, id: string): void {
    this.write(path, this.getHeld(path).filter((r) => r.id !== id), 'held');
  }

  add(path: string, record: PanelRecord): void {
    this.write(path, [...this.get(path), { ...record }]);
  }

  /** Skips unchanged records, and ones already removed (closed in another view of the same canvas). */
  update(path: string, record: PanelRecord): void {
    const list = this.get(path);
    const index = list.findIndex((r) => r.id === record.id);
    if (index < 0 || JSON.stringify(list[index]) === JSON.stringify(record)) return;
    this.write(path, list.map((r, i) => (i === index ? { ...record } : r)));
  }

  remove(path: string, id: string): void {
    this.write(path, this.get(path).filter((r) => r.id !== id));
  }

  flush(): void {
    this.save.run();
  }

  private write(path: string, list: PanelRecord[], key: ListKey = 'panels'): void {
    const lists = this.data[key] ??= {};
    if (list.length > 0) lists[path] = list;
    else delete lists[path];
    this.save();
  }

  private onRename(file: TAbstractFile, oldPath: string): void {
    let changed = false;
    for (const lists of [this.data.panels, this.data.held]) {
      if (!lists) continue;
      // A renamed folder moves every canvas in it.
      for (const path of Object.keys(lists)) {
        const moved = path === oldPath ? file.path : path.startsWith(`${oldPath}/`) ? file.path + path.slice(oldPath.length) : null;
        if (!moved) continue;
        lists[moved] = lists[path]!;
        delete lists[path];
        changed = true;
      }
    }
    if (changed) this.save();
  }

  private onDelete(file: TAbstractFile): void {
    if (this.data.panels?.[file.path]) this.write(file.path, []);
    if (this.data.held?.[file.path]) this.write(file.path, [], 'held');
  }
}

import { EventRef, TFile, debounce, setIcon } from 'obsidian';
import type { CanvasPlusPlugin } from '../main.ts';
import { CanvasViewLike, newId, shieldFromCanvas } from './adapter.ts';
import { PANEL_ICON } from './icons.ts';
import { PanelRecord, PanelStore } from './panel-store.ts';
import { TabPanel } from './tab-panel.ts';

/** Portrait (4:5), like the button's icon. */
const DEFAULT_WIDTH = 384;
const DEFAULT_HEIGHT = 480;
const CASCADE_PX = 24;
const BASE_LAYER = 1;

/** The tab panels over one canvas view, and the button that adds them. */
export class CanvasPanels {
  private panels: TabPanel[] = [];
  private buttonGroup: HTMLElement | null = null;
  private layerEl: HTMLElement;
  /** Tracked by identity, not path, so a rename keeps the panels. */
  private file: TFile | null = null;
  private layer = BASE_LAYER;
  private refs: EventRef[] = [];
  private resizeObserver: ResizeObserver;
  private destroyed = false;
  private loaded = false;
  private saveStates = debounce(() => { for (const p of this.panels) this.save(p); }, 300, true);

  constructor(private plugin: CanvasPlusPlugin, private view: CanvasViewLike, private store: PanelStore) {
    this.layerEl = view.contentEl.createDiv({ cls: 'ffc-tab-panels' });
    this.injectButton();
    this.resizeObserver = new ResizeObserver(() => { for (const p of this.panels) p.place(); });
    this.resizeObserver.observe(this.layerEl);
    const workspace = plugin.app.workspace;
    this.refs.push(workspace.on('layout-change', () => {
      this.syncFile();
      this.saveStates();
    }));
    this.refs.push(workspace.on('file-open', () => this.saveStates()));
    void store.ready.then(() => {
      this.loaded = true;
      this.syncFile();
    });
  }

  destroy(): void {
    this.destroyed = true;
    this.saveStates.cancel();
    for (const p of this.panels) {
      this.save(p);
      p.destroy();
    }
    this.panels = [];
    for (const ref of this.refs) this.plugin.app.workspace.offref(ref);
    this.resizeObserver.disconnect();
    this.buttonGroup?.remove();
    this.layerEl.remove();
  }

  add(): void {
    if (!this.file) return;
    const pane = this.layerEl;
    const width = Math.min(DEFAULT_WIDTH, Math.max(240, pane.clientWidth - 2 * CASCADE_PX));
    const height = Math.min(DEFAULT_HEIGHT, Math.max(160, pane.clientHeight - 2 * CASCADE_PX));
    let x = Math.round((pane.clientWidth - width) / 2);
    let y = Math.round((pane.clientHeight - height) / 2);
    while (this.panels.some((p) => p.record.x === x && p.record.y === y)) {
      x += CASCADE_PX;
      y += CASCADE_PX;
    }
    const record: PanelRecord = { id: newId(), x, y, width, height };
    this.store.add(this.file.path, record);
    const panel = this.mount(record);
    this.plugin.app.workspace.setActiveLeaf(panel.leaf, { focus: true });
  }

  private injectButton(): void {
    const controls = this.view.canvas?.canvasControlsEl;
    if (!controls) return;
    const group = this.buttonGroup = createDiv({ cls: 'canvas-control-group mod-raised ffc-panel-add' });
    const item = group.createDiv({
      cls: 'canvas-control-item',
      attr: { 'aria-label': 'Add panel', 'data-tooltip-position': 'left' },
    });
    setIcon(item, PANEL_ICON);
    item.addEventListener('click', () => this.add());
    shieldFromCanvas(group);
    // Help is desktop only.
    const help = controls.querySelector('.lucide-help-circle, .lucide-circle-help')?.closest('.canvas-control-group');
    controls.insertBefore(group, help ?? null);
  }

  private syncFile(): void {
    if (this.destroyed || !this.loaded) return;
    const file = (this.view as { file?: TFile | null }).file ?? null;
    if (file === this.file) return;
    for (const p of this.panels) {
      this.save(p);
      p.destroy();
    }
    this.panels = [];
    this.file = file;
    if (file) for (const record of this.store.get(file.path)) this.mount({ ...record });
  }

  private mount(record: PanelRecord): TabPanel {
    const panel: TabPanel = new TabPanel(this.plugin.app, this.view.leaf, this.layerEl, record, {
      onMove: () => this.save(panel),
      onClose: () => this.forget(panel),
      onRaise: () => panel.setLayer(++this.layer),
    });
    panel.setLayer(++this.layer);
    this.panels.push(panel);
    return panel;
  }

  private save(panel: TabPanel): void {
    if (!this.file) return;
    const record: PanelRecord = { ...panel.record };
    const state = panel.viewState();
    if (state) record.state = state;
    this.store.update(this.file.path, record);
  }

  private forget(panel: TabPanel): void {
    this.panels.remove(panel);
    if (this.file) this.store.remove(this.file.path, panel.record.id);
  }
}

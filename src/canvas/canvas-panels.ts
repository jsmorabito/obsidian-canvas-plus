import { EventRef, TFile, ViewState, debounce, setIcon } from 'obsidian';
import type { CanvasPlusPlugin } from '../main.ts';
import { CanvasViewLike, newId, shieldFromCanvas } from './adapter.ts';
import { PANEL_ICON } from './icons.ts';
import { PanelRecord, PanelStore } from './panel-store.ts';
import { TabPanel } from './tab-panel.ts';
import { LINEAR_VIEW_TYPE } from './linear-view.ts';

/** Portrait (4:5), like the button's icon. */
const DEFAULT_WIDTH = 384;
const DEFAULT_HEIGHT = 480;
const CASCADE_PX = 24;
const BASE_LAYER = 1;
/** How far below the pointer a panel taken out of the tray puts its top edge, so the pointer is on its header. */
export const HEADER_GRAB_PX = 16;

/** Somewhere a panel can be dropped while it's dragged by its header: the canvas's tray. */
export interface PanelDropTarget {
  /** Returns whether the pointer is over it. */
  dragOver(e: PointerEvent): boolean;
  /** The drag ended: let go at `e`, or cancelled (null). Returns true if it was let go over the target, which then holds the panel. */
  drop(e: PointerEvent | null): boolean;
}

/** Shown on a panel's card in the tray. */
export function describePanel(record: PanelRecord): string {
  const state = record.state;
  const file = state?.state?.file;
  if (typeof file === 'string' && file) return (file.split('/').pop() ?? file).replace(/\.md$/, '');
  if (!state || state.type === 'empty') return 'New tab';
  if (state.type === LINEAR_VIEW_TYPE) return 'Linear';
  return state.type.replace(/[-_]/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

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
  private target: PanelDropTarget | null = null;
  private onHeldChange: () => void = () => { /* no tray yet */ };
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

  /** Let panels be dropped into the tray, which is told when the panels it holds change. */
  setTray(target: PanelDropTarget, onHeldChange: () => void): void {
    this.target = target;
    this.onHeldChange = onHeldChange;
  }

  /** The panels this canvas's tray holds. */
  held(): PanelRecord[] {
    return this.store.getHeld(this.file?.path ?? '');
  }

  /** Take a panel out of the tray, with its header under the pointer. */
  release(id: string, clientX: number, clientY: number): void {
    const record = this.held().find((r) => r.id === id);
    if (!this.file || !record) return;
    const pane = this.layerEl.getBoundingClientRect();
    const placed: PanelRecord = {
      ...record,
      x: Math.round(clientX - pane.left - record.width / 2),
      y: Math.round(clientY - pane.top - HEADER_GRAB_PX),
    };
    this.store.unhold(this.file.path, id);
    this.store.add(this.file.path, placed);
    this.mount(placed);
    this.onHeldChange();
  }

  /** Put a panel in the tray: it closes, and its place and what it shows are kept there. */
  private stash(panel: TabPanel): void {
    if (!this.file) return;
    this.save(panel);
    const record = this.store.get(this.file.path).find((r) => r.id === panel.record.id) ?? panel.record;
    this.store.remove(this.file.path, record.id);
    this.store.hold(this.file.path, record);
    this.panels.remove(panel);
    panel.destroy();
    this.onHeldChange();
  }

  /** Open a view (a widget) in a panel, or raise the one already open for it. */
  openView(type: string): void {
    const open = this.panels.find((p) => p.viewState()?.type === type);
    if (open) {
      open.setLayer(++this.layer);
      this.plugin.app.workspace.setActiveLeaf(open.leaf, { focus: true });
      return;
    }
    this.add({ type, state: {} });
  }

  add(state?: ViewState): void {
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
    const record: PanelRecord = { id: newId(), x, y, width, height, ...(state ? { state } : {}) };
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
    this.onHeldChange();
  }

  private mount(record: PanelRecord): TabPanel {
    const panel: TabPanel = new TabPanel(this.plugin.app, this.view.leaf, this.layerEl, record, {
      onMove: () => this.save(panel),
      onClose: () => this.forget(panel),
      onRaise: () => panel.setLayer(++this.layer),
      onDrag: (e) => this.target?.dragOver(e) ?? false,
      onDrop: (e) => {
        if (!this.target?.drop(e)) return false;
        this.stash(panel);
        return true;
      },
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

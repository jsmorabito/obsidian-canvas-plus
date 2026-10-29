import { EventRef, TFile, ViewState, WorkspaceLeaf, debounce, setIcon } from 'obsidian';
import type { CanvasPlusPlugin } from '../main.ts';
import { CanvasViewLike, newId, shieldFromCanvas } from './adapter.ts';
import { PANEL_ICON } from './icons.ts';
import { Holder, holderOf, splitByHolder } from './holder.ts';
import { PanelRecord, PanelStore } from './panel-store.ts';
import { trackPointer } from './pointer-session.ts';
import { CLICK_SLOP_PX } from './constants.ts';
import { TabPanel } from './tab-panel.ts';
import { PROVIDERS, PROVIDER_IDS } from '../issues/providers.ts';

/** Portrait (4:5), like the button's icon. */
const DEFAULT_WIDTH = 384;
const DEFAULT_HEIGHT = 480;
const CASCADE_PX = 24;
const BASE_LAYER = 1;
/** How far below the pointer a panel taken out of the tray puts its top edge, so the pointer is on its header. */
export const HEADER_GRAB_PX = 16;

/** Somewhere a panel can be dropped while it's dragged by its header: the canvas's tray or its panel dock. */
export interface PanelDropTarget {
  /** Returns whether the pointer is over it. */
  dragOver(e: PointerEvent): boolean;
  /** The drag ended: let go at `e`, or cancelled (null). Returns true if it was let go over the target, which then holds the panel. */
  drop(e: PointerEvent | null): boolean;
}

/** Shown on a panel's card in the tray and its button in the dock. */
export function describePanel(record: PanelRecord): string {
  const state = record.state;
  const file = state?.state?.file;
  if (typeof file === 'string' && file) return (file.split('/').pop() ?? file).replace(/\.md$/, '');
  if (!state || state.type === 'empty') return 'New tab';
  const provider = PROVIDER_IDS.find((id) => PROVIDERS[id].viewType === state.type);
  if (provider) return PROVIDERS[provider].name;
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
  /** Where a panel can be dropped (the tray and the dock), each told when the panels held change. */
  private targets: Array<{ holder: Holder; target: PanelDropTarget; onHeldChange: () => void }> = [];
  /** The held panels split by holder, for each list the store has handed out, so a holder gets the same list back until it changes. */
  private split = new WeakMap<PanelRecord[], Record<Holder, PanelRecord[]>>();
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

  /** Let panels be dropped onto `target`, which then holds them as `holder`, and is told when the panels held change. */
  addDropTarget(holder: Holder, target: PanelDropTarget, onHeldChange: () => void): void {
    this.targets.push({ holder, target, onHeldChange });
  }

  /** Show every drop zone while a panel is carried, and light the one it is over. Returns whether it is over one. */
  hoverTargets(e: PointerEvent): boolean {
    return this.targets.map(({ target }) => target.dragOver(e)).some(Boolean);
  }

  /** The drop zone a pointer was let go over, or null (cancelled, or over none). Puts every drop zone away. */
  private dropOnTarget(e: PointerEvent | null): Holder | null {
    let taken: Holder | null = null;
    // Every target is told, so each puts its drop zone away.
    for (const { holder, target } of this.targets) if (target.drop(e) && !taken) taken = holder;
    return taken;
  }

  /**
   * A held panel's card was pressed: an outline of the panel follows the pointer. Let go over a drop zone and the panel is held
   * there, or over the canvas and it opens there.
   */
  dragHeldOut(record: PanelRecord, e: PointerEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    const doc = this.view.containerEl.doc;
    const ghost = doc.body.createDiv({ cls: 'ffc-canvas-ghost' });
    let moved = false;
    // Measured once: the pane doesn't move while the outline does.
    let pane: DOMRect | null = null;
    const inPane = (m: PointerEvent): boolean => {
      const r = pane ??= this.view.contentEl.getBoundingClientRect();
      return m.clientX >= r.left && m.clientX <= r.right && m.clientY >= r.top && m.clientY <= r.bottom;
    };
    const stop = trackPointer(doc, e.pointerId, {
      move: (m) => {
        if (!moved && Math.hypot(m.clientX - e.clientX, m.clientY - e.clientY) < CLICK_SLOP_PX) return;
        moved = true;
        const over = this.hoverTargets(m);
        ghost.toggleClass('is-visible', !over && inPane(m));
        ghost.setCssProps({
          '--ffc-x': `${m.clientX - record.width / 2}px`,
          '--ffc-y': `${m.clientY - HEADER_GRAB_PX}px`,
          '--ffc-w': `${record.width}px`,
          '--ffc-h': `${record.height}px`,
        });
      },
      up: (u) => {
        stop();
        ghost.remove();
        if (!moved || this.dropHeld(record.id, u)) return;
        if (inPane(u)) this.release(record.id, u.clientX, u.clientY);
      },
      cancel: () => {
        stop();
        ghost.remove();
        if (moved) this.dropHeld(record.id, null);
      },
    });
  }

  /** A held panel was let go at `e`: if over a drop zone it moves there. Returns whether it did (or was let go over its own). */
  dropHeld(id: string, e: PointerEvent | null): boolean {
    const holder = this.dropOnTarget(e);
    if (!holder) return false;
    const record = [...this.held('tray'), ...this.held('dock')].find((r) => r.id === id);
    if (this.file && record && holderOf(record.holder) !== holder) {
      this.store.rehold(this.file.path, id, holder);
      this.onHeldChange();
    }
    return true;
  }

  private onHeldChange(): void {
    for (const { onHeldChange } of this.targets) onHeldChange();
  }

  /** The panels `holder` holds on this canvas. The same list until it changes. */
  held(holder: Holder): PanelRecord[] {
    const all = this.store.getHeld(this.file?.path ?? '');
    let by = this.split.get(all);
    if (!by) {
      by = splitByHolder(all);
      this.split.set(all, by);
    }
    return by[holder];
  }

  /** Take a panel out of the dock, with its header under the pointer. */
  release(id: string, clientX: number, clientY: number): void {
    const record = [...this.held('tray'), ...this.held('dock')].find((r) => r.id === id);
    if (!this.file || !record) return;
    const pane = this.layerEl.getBoundingClientRect();
    // Leaves its holder behind: an open panel isn't held.
    const placed: PanelRecord = {
      ...record,
      x: Math.round(clientX - pane.left - record.width / 2),
      y: Math.round(clientY - pane.top - HEADER_GRAB_PX),
    };
    delete placed.holder;
    this.store.unhold(this.file.path, id);
    this.store.add(this.file.path, placed);
    this.mount(placed);
    this.onHeldChange();
  }

  /** Put a panel away in `holder`: it closes, and its place and what it shows are kept there. */
  private stash(panel: TabPanel, holder: Holder): void {
    if (!this.file) return;
    this.save(panel);
    const record = this.store.get(this.file.path).find((r) => r.id === panel.record.id) ?? panel.record;
    this.store.remove(this.file.path, record.id);
    this.store.hold(this.file.path, { ...record, holder });
    this.panels.remove(panel);
    panel.destroy();
    this.onHeldChange();
  }

  /** The leaf of the panel showing a view of `type`, if one is open. */
  viewLeaf(type: string): WorkspaceLeaf | undefined {
    return this.panels.find((p) => p.viewState()?.type === type)?.leaf;
  }

  /** Open a view (a widget) in a panel, or raise the one already open for it. Returns its leaf. */
  openView(type: string): WorkspaceLeaf | undefined {
    const open = this.panels.find((p) => p.viewState()?.type === type);
    if (open) {
      open.setLayer(++this.layer);
      this.plugin.app.workspace.setActiveLeaf(open.leaf, { focus: true });
      return open.leaf;
    }
    return this.add({ type, state: {} });
  }

  add(state?: ViewState): WorkspaceLeaf | undefined {
    if (!this.file) return undefined;
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
    return panel.leaf;
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
      // Every target is told, so each shows or puts away its drop zone.
      onDrag: (e) => this.hoverTargets(e),
      onDrop: (e) => {
        const holder = this.dropOnTarget(e);
        if (!holder) return false;
        this.stash(panel, holder);
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

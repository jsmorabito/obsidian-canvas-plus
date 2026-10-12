import { App, FileView, ViewState, WorkspaceLeaf, setIcon } from 'obsidian';
import { shieldFromCanvas } from './adapter.ts';
import { createHostedLeaf, HostedLeaf } from './hosted-leaf.ts';
import { PanelRecord } from './panel-store.ts';
import { trackPointer } from './pointer-session.ts';
import { WidgetPicker } from './widgets.ts';

const MIN_WIDTH = 240;
const MIN_HEIGHT = 160;
const KEEP_VISIBLE_PX = 48;

/** Sidebar views (file explorer, search...) hide the header and have a button row instead. */
const HANDLES_TO_MOVE = '.view-header, .nav-header';
const HEADER_CONTROLS = 'button, a, input, textarea, select, [contenteditable="true"], .clickable-icon, .view-header-breadcrumb';
/** Renames the file, so only a drag handle in views without one. */
const FILE_TITLE = '.view-header-title';

const HANDLES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;
type Handle = typeof HANDLES[number];

export interface TabPanelHooks {
  onMove: () => void;
  onClose: () => void;
  onRaise: () => void;
}

/** A real tab floating over the canvas pane, placed in pixels so the canvas moves underneath. */
export class TabPanel {
  readonly el: HTMLElement;
  private hosted: HostedLeaf;
  private stopGesture: (() => void) | null = null;
  private closed = false;
  private closeBtn: HTMLElement;
  private widgetBtn: HTMLElement;
  /** Each view brings its own header, so the buttons are re-added on view changes. */
  private viewObserver: MutationObserver;
  /** Saved state not yet (or never) restored, kept so a save meanwhile doesn't lose it. */
  private pending: ViewState | undefined;

  constructor(
    app: App,
    host: WorkspaceLeaf,
    private paneEl: HTMLElement,
    readonly record: PanelRecord,
    private hooks: TabPanelHooks,
  ) {
    this.el = paneEl.createDiv({ cls: 'ffc-tab-panel' });
    this.closeBtn = createEl('button', {
      cls: 'clickable-icon ffc-tab-panel-close',
      attr: { 'aria-label': 'Close panel', 'data-tooltip-position': 'bottom' },
    });
    setIcon(this.closeBtn, 'x');
    this.closeBtn.addEventListener('click', () => this.close());
    this.widgetBtn = this.createWidgetButton(app);

    this.hosted = createHostedLeaf(app, host, () => this.close());
    this.el.appendChild(this.hosted.el);
    this.el.addEventListener('pointerdown', (e) => {
      const target = e.target as Element | null;
      if (!target?.closest(HANDLES_TO_MOVE) || target.closest(HEADER_CONTROLS)) return;
      if (target.closest(FILE_TITLE) && this.leaf.view instanceof FileView) return;
      this.beginMove(e);
    });
    this.viewObserver = new MutationObserver(() => this.decorateView());
    this.viewObserver.observe(this.hosted.leafEl, { childList: true });
    this.decorateView();
    for (const side of HANDLES) {
      const handle = this.el.createDiv({ cls: `ffc-tab-panel-resize mod-${side}` });
      handle.addEventListener('pointerdown', (e) => this.beginResize(e, side));
    }
    this.el.addEventListener('pointerdown', () => hooks.onRaise(), true);
    shieldFromCanvas(this.el);
    this.place();
    if (record.state && record.state.type !== 'empty') {
      this.pending = record.state;
      void this.restore(record.state);
    }
  }

  get leaf(): WorkspaceLeaf { return this.hosted.leaf; }

  viewState(): ViewState | undefined {
    const state = this.leaf.getViewState();
    return state.type === 'empty' && this.pending ? this.pending : state;
  }

  setLayer(z: number): void {
    this.el.setCssProps({ '--ffc-panel-z': String(z) });
  }

  place(): void {
    const { x, y } = this.clamp(this.record.x, this.record.y);
    this.el.setCssProps({
      '--ffc-panel-x': `${x}px`,
      '--ffc-panel-y': `${y}px`,
      '--ffc-panel-w': `${this.record.width}px`,
      '--ffc-panel-h': `${this.record.height}px`,
    });
  }

  /** Leaves the record, unlike `close`. */
  destroy(): void {
    this.stopGesture?.();
    this.viewObserver.disconnect();
    this.hosted.destroy();
    this.el.remove();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.destroy();
    this.hooks.onClose();
  }

  private decorateView(): void {
    const viewEl = this.leaf.view.containerEl;
    // Views may build their DOM just after being added.
    if (!this.placeCloseButton(viewEl)) window.requestAnimationFrame(() => { this.placeCloseButton(viewEl); });
    if (this.leaf.view.getViewType() !== 'empty') return;
    const addWidget = (): boolean => {
      const list = viewEl.querySelector('.empty-state-action-list');
      if (!list) return false;
      if (list.lastElementChild !== this.widgetBtn) list.appendChild(this.widgetBtn);
      return true;
    };
    if (!addWidget()) window.requestAnimationFrame(() => { addWidget(); });
  }

  /** Header actions, else the sidebar button row, else the panel corner. False for the corner. */
  private placeCloseButton(viewEl: HTMLElement): boolean {
    const btn = this.closeBtn;
    const header = viewEl.querySelector<HTMLElement>(':scope > .view-header');
    const actions = header && header.win.getComputedStyle(header).display !== 'none'
      ? header.querySelector('.view-actions')
      : null;
    const navHeader = actions ? null : viewEl.querySelector<HTMLElement>('.nav-header');
    const parent = actions ?? navHeader ?? this.el;
    btn.toggleClass('view-action', !!actions);
    btn.toggleClass('mod-nav', !!navHeader);
    btn.toggleClass('mod-floating', !actions && !navHeader);
    if (parent.lastElementChild !== btn) parent.appendChild(btn);
    return parent !== this.el;
  }

  /** Same markup as core's new tab actions. */
  private createWidgetButton(app: App): HTMLElement {
    const btn = createDiv({
      cls: 'text-icon-button tappable mod-pill empty-state-action ffc-open-widget',
      attr: { tabindex: '0', role: 'button' },
    });
    setIcon(btn.createSpan({ cls: 'text-button-icon' }), 'puzzle');
    btn.createSpan({ cls: 'text-button-label', text: 'Open widget' });
    const open = (): void => new WidgetPicker(app, this.leaf).open();
    btn.addEventListener('click', open);
    btn.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      open();
    });
    return btn;
  }

  private async restore(state: ViewState): Promise<void> {
    try {
      await this.leaf.setViewState({ ...state, active: false });
      this.pending = undefined;
    } catch {
      // Missing file or disabled plugin: stays on the new tab screen.
    }
  }

  private clamp(x: number, y: number): { x: number; y: number } {
    const paneW = this.paneEl.clientWidth;
    const paneH = this.paneEl.clientHeight;
    return {
      x: Math.min(Math.max(x, KEEP_VISIBLE_PX - this.record.width), Math.max(0, paneW - KEEP_VISIBLE_PX)),
      y: Math.min(Math.max(y, 0), Math.max(0, paneH - KEEP_VISIBLE_PX)),
    };
  }

  private beginMove(down: PointerEvent): void {
    if (down.button !== 0) return;
    down.preventDefault();
    const start = this.clamp(this.record.x, this.record.y);
    this.track(down, 'is-moving', (e) => {
      const at = this.clamp(start.x + e.clientX - down.clientX, start.y + e.clientY - down.clientY);
      this.record.x = at.x;
      this.record.y = at.y;
    });
  }

  private beginResize(down: PointerEvent, side: Handle): void {
    if (down.button !== 0) return;
    down.preventDefault();
    down.stopPropagation();
    const start = { ...this.clamp(this.record.x, this.record.y), width: this.record.width, height: this.record.height };
    this.track(down, 'is-resizing', (e) => {
      const dx = e.clientX - down.clientX;
      const dy = e.clientY - down.clientY;
      const r = this.record;
      if (side.includes('e')) r.width = Math.max(MIN_WIDTH, start.width + dx);
      if (side.includes('s')) r.height = Math.max(MIN_HEIGHT, start.height + dy);
      if (side.includes('w')) {
        r.width = Math.max(MIN_WIDTH, start.width - dx);
        r.x = start.x + start.width - r.width;
      }
      if (side.includes('n')) {
        r.height = Math.max(MIN_HEIGHT, start.height - Math.max(dy, -start.y));
        r.y = start.y + start.height - r.height;
      }
    });
  }

  private track(down: PointerEvent, cls: string, apply: (e: PointerEvent) => void): void {
    this.stopGesture?.();
    this.el.addClass(cls);
    const stopTracking = trackPointer(this.el.doc, down.pointerId, {
      move: (e) => { apply(e); this.place(); },
      up: () => end(),
      cancel: () => end(),
    });
    const end = (): void => {
      stopTracking();
      this.stopGesture = null;
      this.el.removeClass(cls);
      this.hooks.onMove();
    };
    this.stopGesture = end;
  }
}

import { ItemView, Notice, SearchComponent, WorkspaceLeaf, setIcon } from 'obsidian';
import { LinearIssue, parseIssueRef } from '../linear/api.ts';
import type { CanvasPlusPlugin } from '../main.ts';
import { CanvasLike, CanvasViewLike, asCanvasView, focusNode } from './adapter.ts';
import { eachFrameUntil } from '../utils/helpers.ts';
import { openPluginSettings } from './actions-entries.ts';
import { hostLeaves } from './hosted-leaf.ts';
import { LINEAR_ICON } from './icons.ts';
import { stateDot } from './linear-card.ts';
import { LinearRef, readLinearRef } from './linear-ref.ts';
import { addIssueNode, findIssueNode } from './linear-picker.ts';
import type { CanvasNodeLike } from './adapter.ts';

export const LINEAR_VIEW_TYPE = 'canvas-plus-linear';

/** How long typing pauses before Linear is searched. */
const TYPING_PAUSE_MS = 300;

type Tab = 'canvas' | 'explore';

/** An issue on the canvas: what the node saved, and the node. */
interface Placed {
  ref: LinearRef;
  node: CanvasNodeLike;
}

/**
 * The Linear widget: a view that opens in a tab panel over a canvas (Open widget, or Open Linear panel in the
 * actions panel). **On canvas** lists the issues already on that canvas (select one to zoom to it), **Explore**
 * searches Linear, or lists what was updated lately, to add more. It keeps nothing of its own: the list is read
 * from the canvas, so undo and redo show up in it.
 */
export class LinearView extends ItemView {
  private tabsEl!: HTMLElement;
  private search!: SearchComponent;
  private bodyEl!: HTMLElement;
  private tab: Tab = 'canvas';
  private query = '';
  /** What Explore last found, or null before it has been asked. */
  private results: LinearIssue[] | null = null;
  private error = '';
  private loading = false;
  private seq = 0;
  private timer: number | null = null;
  /** What was last drawn, so an unchanged view isn't rebuilt (which would also lose the scroll position). */
  private drawn = '';

  constructor(leaf: WorkspaceLeaf, private plugin: CanvasPlusPlugin) {
    super(leaf);
  }

  getViewType(): string { return LINEAR_VIEW_TYPE; }
  getDisplayText(): string { return 'Linear'; }
  getIcon(): string { return LINEAR_ICON; }

  onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass('ffc-linear-view');
    // Core's navigation header (buttons and a search box, as in the file explorer) over its scrolling file list.
    this.tabsEl = root.createDiv({ cls: 'nav-header ffc-linear-tabs' });
    const searchEl = root.createDiv({ cls: 'nav-header ffc-linear-search' });
    this.search = new SearchComponent(searchEl)
      .setPlaceholder('Filter issues on this canvas')
      .onChange((value) => {
        this.query = value.trim();
        if (this.tab === 'explore') this.searchSoon();
        this.update();
      });
    this.bodyEl = root.createDiv({ cls: 'nav-files-container ffc-linear-body' });

    // The canvas changes under it, and issues arrive from Linear a moment after they are asked for.
    this.registerInterval(window.setInterval(() => this.update(), 1000));
    this.register(this.plugin.linear.store.onUpdate(() => this.update()));
    this.update();
    // The header may be built a frame after the view opens.
    eachFrameUntil(() => this.showHeaderIcon(), 10);
    return Promise.resolve();
  }

  /** Put the Linear icon in the view's header, before its title, whether or not core drew an icon slot there. */
  private showHeaderIcon(): boolean {
    const header = this.containerEl.querySelector<HTMLElement>(':scope > .view-header');
    if (!header) return false;
    let icon = header.querySelector<HTMLElement>('.view-header-icon');
    if (!icon) {
      icon = createDiv({ cls: 'view-header-icon' });
      const title = header.querySelector('.view-header-title-container');
      if (title) title.before(icon);
      else header.prepend(icon);
    }
    icon.addClass('ffc-linear-header-icon');
    icon.empty();
    setIcon(icon, LINEAR_ICON);
    return true;
  }

  onClose(): Promise<void> {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.contentEl.empty();
    return Promise.resolve();
  }

  /** The canvas this widget is for: the one its panel floats over, or else the one used last. */
  private canvasView(): CanvasViewLike | null {
    const host = hostLeaves.get(this.leaf);
    if (host) return asCanvasView(host.view);
    const recent = asCanvasView(this.app.workspace.getMostRecentLeaf()?.view);
    if (recent) return recent;
    let found: CanvasViewLike | null = null;
    this.app.workspace.iterateAllLeaves((leaf) => { found ??= asCanvasView(leaf.view); });
    return found;
  }

  /** Redraw when what it shows has changed. Cheap to call often. */
  private update(): void {
    if (!this.bodyEl?.isConnected) return;
    const canvas = this.canvasView()?.canvas;
    const store = this.plugin.linear.store;
    const placed = canvas ? this.placed(canvas) : [];
    const signature = JSON.stringify([
      this.plugin.hasLinear, !!canvas, this.tab, this.query, this.loading, this.error,
      placed.map((p) => [p.ref.id, p.ref.title, store.get(p.ref.id)?.updatedAt]),
      this.results?.map((r) => [r.id, r.updatedAt]),
      // Explore marks what is on the canvas already.
      this.tab === 'explore' ? placed.map((p) => p.ref.id) : null,
    ]);
    if (signature === this.drawn) return;
    this.drawn = signature;
    this.draw(canvas, placed);
  }

  /** The issues on the canvas, top to bottom and then left to right. */
  private placed(canvas: CanvasLike): Placed[] {
    const out: Placed[] = [];
    for (const node of canvas.nodes?.values() ?? []) {
      const ref = readLinearRef(node);
      if (ref) out.push({ ref, node });
    }
    return out.sort((a, b) => (a.node.y ?? 0) - (b.node.y ?? 0) || (a.node.x ?? 0) - (b.node.x ?? 0));
  }

  private setTab(tab: Tab): void {
    if (tab === this.tab) return;
    this.tab = tab;
    this.query = '';
    this.search.setValue('');
    this.search.setPlaceholder(tab === 'canvas' ? 'Filter issues on this canvas' : 'Search Linear, or enter an identifier or URL');
    if (tab === 'explore' && this.results === null) this.searchSoon();
    this.update();
  }

  /** Ask Linear after typing pauses. A newer ask makes an older answer unwanted. */
  private searchSoon(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    const mine = ++this.seq;
    this.loading = true;
    this.timer = window.setTimeout(() => { void this.runSearch(mine); }, this.results === null ? 0 : TYPING_PAUSE_MS);
  }

  private async runSearch(mine: number): Promise<void> {
    const { client } = this.plugin.linear;
    const q = this.query;
    try {
      const identifier = parseIssueRef(q);
      const exact = identifier ? await client.byIdentifier(identifier) : null;
      const found = exact ? [exact] : q ? await client.search(q) : await client.recent();
      if (mine !== this.seq) return;
      this.results = found;
      this.error = '';
    } catch (err) {
      if (mine !== this.seq) return;
      this.results = [];
      this.error = (err as Error).message;
    }
    this.loading = false;
    this.update();
  }

  // ── Drawing ─────────────────────────────────────────────────────────────────

  private draw(canvas: CanvasLike | undefined, placed: Placed[]): void {
    this.tabsEl.empty();
    this.bodyEl.empty();
    const on = this.plugin.hasLinear;
    this.tabsEl.toggle(on);
    this.contentEl.querySelector<HTMLElement>('.ffc-linear-search')?.toggle(on);
    if (!on) {
      const empty = this.bodyEl.createDiv({ cls: 'pane-empty' });
      empty.createDiv({ text: 'Turn on the Linear integration (beta) and sign in to see your issues here.' });
      empty.createEl('button', { cls: 'mod-cta', text: 'Open settings' }).addEventListener('click', () => openPluginSettings(this.plugin));
      return;
    }
    const tab = (id: Tab, label: string, count?: number): void => {
      // Core's buttons: the one for the tab shown is the call-to-action one.
      const btn = this.tabsEl.createEl('button', { cls: this.tab === id ? 'mod-cta' : '', text: count === undefined ? label : `${label} (${count})` });
      btn.addEventListener('click', () => this.setTab(id));
    };
    tab('canvas', 'On canvas', placed.length);
    tab('explore', 'Explore');

    if (!canvas) {
      this.bodyEl.createDiv({ cls: 'pane-empty', text: 'Open a canvas to add issues to it.' });
      return;
    }
    if (this.tab === 'canvas') this.drawPlaced(canvas, placed);
    else this.drawResults(canvas, new Set(placed.map((p) => p.ref.id)));
  }

  private drawPlaced(canvas: CanvasLike, placed: Placed[]): void {
    const words = this.query.toLowerCase().split(/\s+/).filter(Boolean);
    const store = this.plugin.linear.store;
    const rows = placed.filter(({ ref }) => {
      const text = `${ref.identifier} ${store.get(ref.id)?.title ?? ref.title}`.toLowerCase();
      return words.every((w) => text.includes(w));
    });
    if (rows.length === 0) {
      const empty = this.bodyEl.createDiv({ cls: 'pane-empty' });
      empty.createDiv({ text: placed.length === 0 ? 'No issues on this canvas yet.' : 'No issues match.' });
      if (placed.length === 0) {
        empty.createEl('button', { cls: 'mod-cta', text: 'Explore issues' }).addEventListener('click', () => this.setTab('explore'));
      }
      return;
    }
    for (const { ref, node } of rows) {
      const issue = store.get(ref.id);
      const row = this.row(ref.identifier, issue?.title ?? ref.title, issue?.state ?? null, issue?.assignee?.name);
      row.self.addEventListener('click', () => focusNode(canvas, node));
      const open = row.flair.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': 'Open in Linear' } });
      setIcon(open, 'external-link');
      open.addEventListener('click', (e) => { e.stopPropagation(); window.open(ref.url); });
    }
  }

  private drawResults(canvas: CanvasLike, onCanvas: Set<string>): void {
    if (this.error) {
      this.bodyEl.createDiv({ cls: 'pane-empty', text: this.error });
      return;
    }
    if (this.results === null || (this.loading && this.results.length === 0)) {
      this.bodyEl.createDiv({ cls: 'pane-empty', text: 'Loading from Linear…' });
      return;
    }
    if (this.results.length === 0) {
      this.bodyEl.createDiv({ cls: 'pane-empty', text: 'No issues found.' });
      return;
    }
    if (!this.query) this.bodyEl.createDiv({ cls: 'tree-item-self' }).createDiv({ cls: 'tree-item-inner u-muted', text: 'Recently updated' });
    for (const issue of this.results) {
      const there = onCanvas.has(issue.id);
      const row = this.row(issue.identifier, issue.title, issue.state, issue.assignee?.name);
      row.item.addClass(there ? 'is-placed' : 'is-addable');
      row.flair.setAttribute('aria-label', there ? 'On the canvas' : 'Add to the canvas');
      setIcon(row.flair, there ? 'check' : 'plus');
      row.self.addEventListener('click', () => this.addOrFocus(canvas, issue));
    }
  }

  /** One issue in core's tree row markup: its status, title and a line under it, with room at the right for an action. */
  private row(identifier: string, title: string, state: LinearIssue['state'], assignee?: string): { item: HTMLElement; self: HTMLElement; flair: HTMLElement } {
    const item = this.bodyEl.createDiv({ cls: 'tree-item ffc-linear-row' });
    const self = item.createDiv({ cls: 'tree-item-self is-clickable' });
    stateDot(self, state);
    const inner = self.createDiv({ cls: 'tree-item-inner' });
    inner.createDiv({ cls: 'ffc-linear-row-title', text: title });
    inner.createDiv({ cls: 'ffc-linear-row-meta u-muted', text: [identifier, state?.name, assignee].filter(Boolean).join(' · ') });
    const flair = self.createDiv({ cls: 'tree-item-flair-outer' }).createSpan({ cls: 'tree-item-flair' });
    return { item, self, flair };
  }

  /** Add the issue without moving the view, so several can be added in a row; one already there is zoomed to. */
  private addOrFocus(canvas: CanvasLike, issue: LinearIssue): void {
    const existing = findIssueNode(canvas, issue.id);
    if (existing) {
      focusNode(canvas, existing);
      return;
    }
    try {
      addIssueNode(this.plugin, canvas, issue, null);
      this.plugin.sweepCanvases();
      window.requestAnimationFrame(() => this.plugin.sweepCanvases());
      this.update();
    } catch (err) {
      new Notice(`Could not add issue to canvas: ${(err as Error).message}`);
    }
  }
}

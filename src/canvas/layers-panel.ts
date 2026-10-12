import { DropdownComponent, SearchComponent, prepareSimpleSearch, setIcon } from 'obsidian';
import type { CanvasPlusPlugin } from '../main.ts';
import { CanvasLike, CanvasViewLike, focusNode, shieldFromCanvas } from './adapter.ts';
import {
  ALL_LAYERS, FilterOption, Layer, LayerKind, buildLayers, filterLayers, filterOptions, firstMatch, matchesFilter, searchText, someLayer, walk,
} from './layers-tree.ts';
import { beginLabelEdit } from './placement.ts';

const OPEN_KEY = 'ffc-canvas-layers-open';
const HOVER_CLASS = 'ffc-layer-hover';
/** Makes label ids unique across every open canvas. */
let nextLabelId = 0;

const ICONS: Record<LayerKind, string> = {
  group: 'frame', note: 'file-text', text: 'type', card: 'sticky-note', image: 'image', file: 'file', link: 'link', ink: 'pencil',
};

/**
 * Floating panel on the left listing groups and what they
 * contain. Click to select and zoom to an item, Shift-click to add it to
 * the selection, as on the canvas itself, hover to outline it on the canvas, double-click a group to
 * rename it, select its triangle to collapse it. A search box and a filter narrow the list, and show
 * every result even inside a collapsed group. Whether it's open is a per-viewer preference.
 */
export class LayersPanel {
  private el: HTMLElement;
  /** Shown instead of the panel while it's collapsed: a core canvas control, like the ones on the right. */
  private showBtn: HTMLElement;
  private bodyEl: HTMLElement;
  private open: boolean;
  private shown = '';
  private search: SearchComponent;
  private dropdown: DropdownComponent;
  private query = '';
  private filter = ALL_LAYERS;
  /** The options last put in the dropdown, so it is only rebuilt when they change. */
  private optionsKey = '';
  /** What the list currently shows, for Enter in the search box. */
  private visible: Layer[] = [];
  /** Ids of the groups collapsed in the list. Lasts as long as the view. */
  private collapsed = new Set<string>();
  /** Whether the canvas had no layers at the last update, for the empty message. */
  private emptyCanvas = false;

  constructor(private plugin: CanvasPlusPlugin, private view: CanvasViewLike) {
    this.open = plugin.app.loadLocalStorage(OPEN_KEY) !== 'closed';
    this.el = view.contentEl.createDiv({ cls: 'ffc-layers-panel' });
    const header = this.el.createDiv({ cls: 'ffc-layers-header' });
    header.createSpan({ text: 'Layers', cls: 'ffc-layers-title' });
    const hide = header.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': 'Hide layers' } });
    setIcon(hide, 'chevrons-left');
    hide.addEventListener('click', () => this.setOpen(false));
    this.showBtn = view.contentEl.createDiv({ cls: 'canvas-control-group ffc-layers-show' });
    const item = this.showBtn.createDiv({
      cls: 'canvas-control-item',
      attr: { 'aria-label': 'Show layers', 'data-tooltip-position': 'right' },
    });
    setIcon(item, 'layers');
    item.addEventListener('click', () => this.setOpen(true));
    shieldFromCanvas(this.showBtn);

    // Obsidian's own search box and dropdown, so they look and behave like the rest of the app.
    const tools = this.el.createDiv({ cls: 'ffc-layers-filters' });
    this.search = new SearchComponent(tools)
      .setPlaceholder('Search layers…')
      .onChange((value) => { this.query = value; this.update(); });
    this.dropdown = new DropdownComponent(tools)
      .onChange((value) => { this.filter = value; this.update(); });
    this.search.inputEl.addEventListener('keydown', (e) => this.onSearchKey(e));

    this.bodyEl = this.el.createDiv({ cls: 'ffc-layers-body' });
    shieldFromCanvas(this.el);
    this.applyOpen();
  }

  private get canvas(): CanvasLike | undefined { return this.view.canvas; }

  /** Pixels at the left edge the panel covers (its margin, width and a matching gap), so zooming to a node can keep it clear. */
  get insetPx(): number {
    const shown = this.open ? this.el : this.showBtn;
    return shown.offsetLeft * 2 + shown.offsetWidth;
  }

  destroy(): void {
    this.clearHover();
    this.el.remove();
    this.showBtn.remove();
  }

  private setOpen(open: boolean): void {
    this.open = open;
    this.plugin.app.saveLocalStorage(OPEN_KEY, open ? 'open' : 'closed');
    this.applyOpen();
  }

  private applyOpen(): void {
    this.el.toggle(this.open);
    this.showBtn.toggle(!this.open);
  }

  private get filtering(): boolean {
    return this.query.trim() !== '' || this.filter !== ALL_LAYERS;
  }

  /** Whether a layer is a result: it passes the filter and every word of the search is in its name or type. */
  private keeper(): (layer: Layer) => boolean {
    const text = this.query.trim();
    const match = text ? prepareSimpleSearch(text) : null;
    return (layer) => matchesFilter(layer, this.filter) && (!match || match(searchText(layer)) !== null);
  }

  /** Offer only the filters that exist on this canvas, and fall back to all layers if the chosen one has gone. */
  private syncFilterOptions(roots: Layer[]): void {
    const options: FilterOption[] = filterOptions(roots);
    const key = JSON.stringify(options);
    if (key === this.optionsKey) return;
    this.optionsKey = key;
    if (!options.some((o) => o.value === this.filter)) this.filter = ALL_LAYERS;
    this.dropdown.selectEl.empty();
    for (const option of options) this.dropdown.addOption(option.value, option.label);
    this.dropdown.setValue(this.filter);
  }

  /** Enter jumps to the first result; Escape clears the search, then leaves the box. */
  private onSearchKey(e: KeyboardEvent): void {
    // Enter that confirms an input method's conversion (Japanese, Chinese, Korean) isn't a submit.
    if (e.isComposing) return;
    if (e.key === 'Enter') {
      const first = firstMatch(this.visible);
      const canvas = this.canvas;
      if (first && canvas) {
        e.preventDefault();
        focusNode(canvas, first.node, this.insetPx);
      }
    } else if (e.key === 'Escape') {
      if (this.query !== '') {
        e.preventDefault();
        e.stopPropagation();
        this.search.setValue('');
        this.query = '';
        this.update();
      } else {
        this.search.inputEl.blur();
      }
    }
  }

  /** Rebuild from the canvas, then redraw if what the list shows (or the selection) changed. */
  update(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const roots = buildLayers(this.plugin, canvas);
    this.syncFilterOptions(roots);
    this.pruneCollapsed(roots);
    this.emptyCanvas = roots.length === 0;
    this.visible = this.filtering ? filterLayers(roots, this.keeper()) : roots;
    this.render(canvas);
  }

  /** Redraw the list last built by `update`, only when it would look different. */
  private render(canvas: CanvasLike): void {
    const visible = this.visible;
    const selection = canvas.selection ?? new Set<object>();
    const signature = JSON.stringify([this.query, this.filter, [...this.collapsed], this.flatten(visible, selection)]);
    if (signature === this.shown) return;
    this.shown = signature;
    this.clearHover();
    this.bodyEl.empty();
    if (visible.length === 0) {
      this.bodyEl.createDiv({ cls: 'ffc-layers-empty', text: this.emptyCanvas ? 'Nothing on the canvas yet.' : 'No matching layers.' });
      return;
    }
    this.renderList(canvas, visible, 0, selection);
  }

  private flatten(layers: Layer[], selection: Set<object>): unknown[] {
    return layers.map((l) => [l.label, l.kind, l.type, l.dimmed, selection.has(l.node), this.flatten(l.children, selection)]);
  }

  /** Forget collapsed groups that are no longer on the canvas. */
  private pruneCollapsed(roots: Layer[]): void {
    if (this.collapsed.size === 0) return;
    const ids = new Set<string>();
    walk(roots, (l) => { if (l.node.id) ids.add(l.node.id); });
    for (const id of this.collapsed) if (!ids.has(id)) this.collapsed.delete(id);
  }

  private renderList(canvas: CanvasLike, layers: Layer[], depth: number, selection: Set<object>): void {
    for (const layer of layers) {
      const row = this.bodyEl.createDiv({ cls: 'ffc-layer-row' });
      row.setCssProps({ '--ffc-depth': String(depth) });
      row.toggleClass('is-selected', selection.has(layer.node));
      row.toggleClass('is-group', layer.kind === 'group');
      row.toggleClass('is-dimmed', !!layer.dimmed);
      // Search and filter always show every result, so groups only collapse when neither is active.
      const id = layer.kind === 'group' && layer.children.length > 0 && !this.filtering ? layer.node.id : undefined;
      const collapsed = !!id && this.collapsed.has(id);
      row.toggleClass('is-collapsed', collapsed);
      // A collapsed group hides its contents, so it says when the selection is inside.
      row.toggleClass('has-selection', collapsed && someLayer(layer.children, (l) => selection.has(l.node)));
      const toggle = row.createDiv({ cls: 'ffc-layer-toggle' });
      setIcon(row.createSpan({ cls: 'ffc-layer-icon' }), ICONS[layer.kind]);
      const label = row.createSpan({ cls: 'ffc-layer-label', text: layer.label });
      if (layer.type) row.createSpan({ cls: 'ffc-note-chip', text: layer.type });
      if (id) this.makeToggle(toggle, label, id, collapsed);

      row.addEventListener('click', (e) => {
        if (e.shiftKey) canvas.toggleSelect?.(layer.node);
        else focusNode(canvas, layer.node, this.insetPx);
      });
      row.addEventListener('dblclick', () => {
        if (layer.kind !== 'group') return;
        focusNode(canvas, layer.node, this.insetPx);
        beginLabelEdit(layer.node);
      });
      row.addEventListener('mouseenter', () => layer.node.nodeEl?.addClass(HOVER_CLASS));
      row.addEventListener('mouseleave', () => layer.node.nodeEl?.removeClass(HOVER_CLASS));
      if (!collapsed) this.renderList(canvas, layer.children, depth + 1, selection);
    }
  }

  /**
   * Core's tree collapse icon: a triangle that turns when the group collapses. It's named by the
   * group's label rather than an aria-label, so hovering it doesn't pop a tooltip.
   */
  private makeToggle(toggle: HTMLElement, label: HTMLElement, id: string, collapsed: boolean): void {
    toggle.addClass('collapse-icon');
    setIcon(toggle, 'right-triangle');
    label.id = `ffc-layer-label-${nextLabelId++}`;
    toggle.setAttrs({ role: 'button', tabindex: '0', 'aria-expanded': String(!collapsed), 'aria-labelledby': label.id });
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleCollapsed(id);
    });
    toggle.addEventListener('dblclick', (e) => e.stopPropagation());
    toggle.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      this.toggleCollapsed(id);
      // The list was redrawn, so put focus back on the new toggle for this group.
      this.bodyEl.querySelector<HTMLElement>(`[data-group-id="${CSS.escape(id)}"]`)?.focus();
    });
    toggle.dataset.groupId = id;
  }

  private toggleCollapsed(id: string): void {
    if (this.collapsed.has(id)) this.collapsed.delete(id);
    else this.collapsed.add(id);
    const canvas = this.canvas;
    if (canvas) this.render(canvas);
  }

  private clearHover(): void {
    for (const node of this.canvas?.nodes?.values() ?? []) node.nodeEl?.removeClass(HOVER_CLASS);
  }
}

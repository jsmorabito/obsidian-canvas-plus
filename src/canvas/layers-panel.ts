import { DropdownComponent, SearchComponent, prepareSimpleSearch, setIcon } from 'obsidian';
import type { CanvasPlusPlugin } from '../main.ts';
import {
  CanvasLike, CanvasNodeLike, CanvasViewLike, batch, editPlainText, focusNode, getExtra, isReadonly, patchData, shieldFromCanvas,
} from './adapter.ts';
import { FIELD_LINK_NAME } from './constants.ts';
import { createShowButton, loadOpen, saveOpen } from './floating-panel.ts';
import {
  ALL_LAYERS, FilterOption, LAYER_ICONS, Layer, LayerKind, buildLayers, filterLayers, filterOptions, firstMatch, kindFilter, matchesFilter, searchText,
  someLayer, walk,
} from './layers-tree.ts';
import { beginLabelEdit } from './placement.ts';
import { trackPointer } from './pointer-session.ts';
import { isReordering, makeReorderable } from './reorder-rows.ts';
import { byStopOrder, renumberStops } from './stop-order.ts';

const OPEN_KEY = 'ffc-canvas-layers-open';
const WIDTH_KEY = 'ffc-canvas-layers-width';
/** The narrowest and widest the panel can be dragged to, in pixels: Figma's left panel limits, the narrowest being its default. */
const MIN_WIDTH = 241;
const MAX_WIDTH = 450;
const FAVORITES_KEY = 'ffc-canvas-layers-favorites';
const HOVER_CLASS = 'ffc-layer-hover';
/** Makes label ids unique across every open canvas. */
let nextLabelId = 0;

/** How a kind of layer is renamed from the list: the text to start editing from, and the data to save. */
interface Rename {
  tooltip: string;
  read(node: CanvasNodeLike): string;
  patch(node: CanvasNodeLike, text: string): Record<string, unknown>;
}

const RENAMES: Partial<Record<LayerKind, Rename>> = {
  // Empty leaves the group without a label, as clearing it on the canvas does.
  group: {
    tooltip: 'Rename group',
    read: (node) => { const label = node.getData?.()?.label; return typeof label === 'string' ? label.trim() : ''; },
    patch: (_node, text) => ({ label: text || undefined }),
  },
  // A link starts from its name, or its URL if it has none. Empty, or the URL itself, shows the URL again.
  link: {
    tooltip: 'Rename link',
    read: (node) => {
      const name = getExtra(node, FIELD_LINK_NAME);
      return typeof name === 'string' && name.trim() ? name.trim() : linkUrl(node);
    },
    patch: (node, text) => ({ [FIELD_LINK_NAME]: text && text !== linkUrl(node) ? text : undefined }),
  },
};

function linkUrl(node: CanvasNodeLike): string {
  const url = node.getData?.()?.url;
  return typeof url === 'string' ? url : '';
}

/**
 * Floating panel on the left listing groups and what they
 * contain. Click to select and zoom to an item, Shift-click to add it to
 * the selection, as on the canvas itself, hover to outline it on the canvas, double-click a group or anchor to
 * rename it, select the pencil on a group or link to rename it in the list, select its triangle to collapse it. A search box and a filter narrow the list, and show
 * every result even inside a collapsed group. Filtered to anchors, it lists them in presentation order instead,
 * numbered, and dragging one changes the order. Whether it's open is a per-viewer preference, closed by default.
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
  /** The selection the list last jumped to, so it moves only when the selection does. */
  private revealedKey = '';
  /** The list should scroll to the selection once it is drawn. */
  private revealPending = false;
  /** Ids of the favourited layers, kept per canvas file as a per-viewer preference. */
  private favorites = new Set<string>();
  private favoritesLoadedFor: string | undefined;
  /** Whether the favourites section is collapsed. Lasts as long as the view. */
  private favoritesCollapsed = false;
  /** Whether the Layers section, shown under Favorites, is collapsed. */
  private layersCollapsed = false;
  /** The favourited layers present on the canvas at the last update, in canvas order. A favourited group brings its children. */
  private favoriteLayers: Layer[] = [];
  /** Whether the canvas had no layers at the last update, for the empty message. */
  private emptyCanvas = false;
  /** Whether a link's name is being edited in the list, so a redraw doesn't throw the input away. */
  private renaming = false;
  /** Ends a width drag in progress. */
  private stopResize: (() => void) | null = null;

  constructor(private plugin: CanvasPlusPlugin, private view: CanvasViewLike) {
    this.open = loadOpen(plugin.app, OPEN_KEY);
    this.el = view.contentEl.createDiv({ cls: 'ffc-layers-panel' });
    const header = this.el.createDiv({ cls: 'ffc-layers-header' });
    header.createSpan({ text: 'Layers', cls: 'ffc-layers-title' });
    const hide = header.createEl('button', { cls: 'clickable-icon', attr: { 'aria-label': 'Hide layers' } });
    setIcon(hide, 'chevrons-left');
    hide.addEventListener('click', () => this.setOpen(false));
    this.showBtn = createShowButton(view.contentEl, 'ffc-layers-show', 'layers', 'Show layers', () => this.setOpen(true));

    // Obsidian's own search box and dropdown, so they look and behave like the rest of the app.
    const tools = this.el.createDiv({ cls: 'ffc-layers-filters' });
    this.search = new SearchComponent(tools)
      .setPlaceholder('Search layers…')
      .onChange((value) => { this.query = value; this.update(); });
    this.dropdown = new DropdownComponent(tools)
      .onChange((value) => { this.filter = value; this.update(); });
    this.search.inputEl.addEventListener('keydown', (e) => this.onSearchKey(e));

    this.bodyEl = this.el.createDiv({ cls: 'ffc-layers-body' });
    const grip = this.el.createDiv({ cls: 'ffc-layers-resize', attr: { 'aria-label': 'Resize layers', 'data-tooltip-position': 'right' } });
    grip.addEventListener('pointerdown', (e) => this.beginResize(e));
    grip.addEventListener('dblclick', () => this.setWidth(MIN_WIDTH, true));
    shieldFromCanvas(this.el);
    const saved = Number(plugin.app.loadLocalStorage(WIDTH_KEY));
    if (Number.isFinite(saved) && saved > 0) this.setWidth(saved, false);
    this.applyOpen();
  }

  private get canvas(): CanvasLike | undefined { return this.view.canvas; }

  /** Pixels at the left edge the panel covers (its margin, width and a matching gap), so zooming to a node can keep it clear. */
  get insetPx(): number {
    const shown = this.open ? this.el : this.showBtn;
    return shown.offsetLeft * 2 + shown.offsetWidth;
  }

  /** Set the width within its limits, and keep it as a per-viewer preference when asked. A narrow pane holds it below the maximum. */
  private setWidth(width: number, save: boolean): void {
    const room = this.view.contentEl.clientWidth / 2;
    const clamped = Math.round(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width, Math.max(room, MIN_WIDTH))));
    this.el.setCssProps({ '--ffc-layers-width': `${clamped}px` });
    if (save) this.plugin.app.saveLocalStorage(WIDTH_KEY, clamped === MIN_WIDTH ? null : String(clamped));
  }

  private beginResize(down: PointerEvent): void {
    if (down.button !== 0) return;
    down.preventDefault();
    this.stopResize?.();
    const startWidth = this.el.offsetWidth;
    this.el.addClass('is-resizing');
    let width = startWidth;
    const end = (): void => {
      stop();
      this.stopResize = null;
      this.el.removeClass('is-resizing');
      this.setWidth(width, true);
    };
    const stop = trackPointer(this.el.doc, down.pointerId, {
      move: (e) => {
        width = startWidth + e.clientX - down.clientX;
        this.setWidth(width, false);
      },
      up: end,
      cancel: end,
    });
    this.stopResize = end;
  }

  destroy(): void {
    this.stopResize?.();
    this.clearHover();
    this.el.remove();
    this.showBtn.remove();
  }

  private setOpen(open: boolean): void {
    this.open = open;
    saveOpen(this.plugin.app, OPEN_KEY, open);
    this.applyOpen();
    this.update();
  }

  private applyOpen(): void {
    this.el.toggle(this.open);
    this.showBtn.toggle(!this.open);
  }

  private get filtering(): boolean {
    return this.query.trim() !== '' || this.filter !== ALL_LAYERS;
  }

  /**
   * Filtered to anchors with nothing searched for, the list is the presentation order: flat, numbered, and
   * dragged to reorder. Anywhere else it stays the canvas's spatial tree, where a drag would read as moving nodes.
   */
  private get ordering(): boolean {
    return this.filter === kindFilter('anchor') && this.query.trim() === '';
  }

  /** Every anchor, in presentation order, without the groups around them. */
  private stopList(roots: Layer[]): Layer[] {
    const anchors: Layer[] = [];
    walk(roots, (l) => { if (l.kind === 'anchor') anchors.push({ ...l, children: [] }); });
    return byStopOrder(anchors);
  }

  /** Move stop `from` to `to` and number every anchor in the new order, as one undo step. Not on a locked canvas. */
  private moveStop(canvas: CanvasLike, nodes: CanvasNodeLike[], from: number, to: number): void {
    if (isReadonly(canvas)) return;
    const order = [...nodes];
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved);
    renumberStops(canvas, order);
    this.update();
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
        focusNode(canvas, first.node);
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

  /** Rebuild from the canvas, then redraw if what the list shows (or the selection) changed. Not while closed: opening rebuilds it. */
  update(): void {
    const canvas = this.canvas;
    if (!canvas || !this.open) return;
    const roots = buildLayers(this.plugin, canvas);
    this.syncFilterOptions(roots);
    this.pruneCollapsed(roots);
    this.emptyCanvas = roots.length === 0;
    this.syncFavorites(roots);
    this.visible = this.ordering ? this.stopList(roots) : this.filtering ? filterLayers(roots, this.keeper()) : roots;
    this.revealSelection(canvas);
    this.render(canvas);
  }

  /** When the selection changes, open the groups it is inside and scroll the list to it once it is drawn. */
  private revealSelection(canvas: CanvasLike): void {
    const selected = new Set<object>(canvas.selection ?? []);
    const key = [...selected].map((n) => (n as { id?: string }).id ?? '').sort().join('|');
    if (key === this.revealedKey) return;
    this.revealedKey = key;
    if (selected.size === 0) return;
    const open = (layers: Layer[]): boolean => {
      let found = false;
      for (const layer of layers) {
        const inside = open(layer.children);
        if (inside && layer.node.id) this.collapsed.delete(layer.node.id);
        if (inside || selected.has(layer.node)) found = true;
      }
      return found;
    };
    open(this.visible);
    this.revealPending = true;
  }

  /** Redraw the list last built by `update`, only when it would look different. */
  private render(canvas: CanvasLike): void {
    const visible = this.visible;
    const selection = canvas.selection ?? new Set<object>();
    // Locking the canvas changes whether the order can be dragged, so it redraws the list too.
    const signature = JSON.stringify([
      this.query, this.filter, [...this.collapsed], this.showFavorites, this.favoritesCollapsed, this.layersCollapsed, [...this.favorites], this.ordering && isReadonly(canvas), this.flatten(visible, selection),
    ]);
    // Not while a row is renamed or dragged: rebuilding the list would throw that away.
    if (signature === this.shown) {
      // Nothing it shows changed, so there is nothing to jump to.
      this.revealPending = false;
      return;
    }
    if (this.renaming || isReordering(this.bodyEl)) return;
    this.shown = signature;
    this.clearHover();
    this.bodyEl.empty();
    if (visible.length === 0) {
      this.bodyEl.createDiv({ cls: 'ffc-layers-empty', text: this.emptyCanvas ? 'Nothing on the canvas yet.' : 'No matching layers.' });
      return;
    }
    if (this.showFavorites) {
      this.renderFavorites(canvas, selection);
      const content = this.renderSection(canvas, 'Layers', undefined, this.layersCollapsed, () => { this.layersCollapsed = !this.layersCollapsed; });
      if (content) this.renderList(canvas, content, visible, selection);
    } else {
      this.renderList(canvas, this.bodyEl, visible, selection);
    }
    // Core's lock means no edits, the order included: the list still shows it, but it can't be dragged.
    if (this.ordering && !isReadonly(canvas)) {
      // The anchors as they were drawn, so a redraw while the drop is handled can't shift which one moves.
      const nodes = visible.map((l) => l.node);
      const rows = Array.from(this.bodyEl.querySelectorAll<HTMLElement>('.ffc-layer-row'));
      makeReorderable(this.bodyEl, rows, (from, to) => this.moveStop(canvas, nodes, from, to));
    }
    if (this.revealPending) {
      this.revealPending = false;
      // A favourite is drawn twice, above the tree and in it: the tree's row, which is the later one, is where it belongs.
      const rows = this.bodyEl.querySelectorAll<HTMLElement>('.ffc-layer-row.is-selected');
      rows[rows.length - 1]?.scrollIntoView({ block: 'nearest' });
    }
  }

  private get favoritesKey(): string {
    return `${FAVORITES_KEY}:${this.view.file?.path ?? ''}`;
  }

  /** The favourites section sits above the tree, but only on the plain tree: filtering and ordering are their own lists. */
  private get showFavorites(): boolean {
    return this.favoriteLayers.length > 0 && !this.filtering;
  }

  /** Load this canvas's favourites (again if the view now shows another file) and find them among the layers. */
  private syncFavorites(roots: Layer[]): void {
    const path = this.view.file?.path ?? '';
    if (this.favoritesLoadedFor !== path) {
      this.favoritesLoadedFor = path;
      let ids: unknown = [];
      try { ids = JSON.parse((this.plugin.app.loadLocalStorage(this.favoritesKey) as string | null) ?? '[]'); } catch { /* start empty */ }
      this.favorites = new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []);
    }
    const found: Layer[] = [];
    // A favourite inside a favourite group is already listed with it.
    const collect = (layers: Layer[], inside: boolean): void => {
      for (const l of layers) {
        const favorite = !!l.node.id && this.favorites.has(l.node.id);
        if (favorite && !inside) found.push(l);
        collect(l.children, inside || favorite);
      }
    };
    collect(roots, false);
    this.favoriteLayers = found;
  }

  private toggleFavorite(id: string): void {
    if (this.favorites.has(id)) this.favorites.delete(id);
    else this.favorites.add(id);
    this.plugin.app.saveLocalStorage(this.favoritesKey, JSON.stringify([...this.favorites]));
    this.update();
  }

  /** The starred layers, each with what is inside it, without stars of their own. */
  private renderFavorites(canvas: CanvasLike, selection: Set<object>): void {
    const content = this.renderSection(
      canvas, 'Favorites', this.favoriteLayers.length, this.favoritesCollapsed, () => { this.favoritesCollapsed = !this.favoritesCollapsed; },
    );
    if (content) this.renderList(canvas, content, this.favoriteLayers, selection, false, true);
  }

  /** A collapsible section header. Returns where its rows go, or null while it is collapsed. */
  private renderSection(canvas: CanvasLike, title: string, count: number | undefined, collapsed: boolean, flip: () => void): HTMLElement | null {
    const section = this.bodyEl.createDiv({ cls: 'tree-item ffc-layers-section' });
    const header = section.createDiv({ cls: 'tree-item-self is-clickable mod-collapsible ffc-layers-section-header' });
    header.toggleClass('is-collapsed', collapsed);
    const icon = header.createDiv({ cls: 'tree-item-icon collapse-icon' });
    setIcon(icon, 'right-triangle');
    icon.toggleClass('is-collapsed', collapsed);
    header.createDiv({ cls: 'tree-item-inner', text: title });
    if (count !== undefined) header.createDiv({ cls: 'tree-item-flair-outer' }).createSpan({ cls: 'tree-item-flair', text: String(count) });
    header.setAttrs({ role: 'button', tabindex: '0', 'aria-expanded': String(!collapsed) });
    const toggle = (): void => { flip(); this.render(canvas); };
    header.addEventListener('click', toggle);
    header.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      toggle();
    });
    return collapsed ? null : section.createDiv({ cls: 'tree-item-children' });
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

  /** Core's tree markup and classes, as in the file explorer and outline, so themes style the list like those. */
  private renderList(canvas: CanvasLike, parent: HTMLElement, layers: Layer[], selection: Set<object>, stars = true, removable = false): void {
    for (const [i, layer] of layers.entries()) {
      const item = parent.createDiv({ cls: 'tree-item' });
      const row = item.createDiv({ cls: 'tree-item-self is-clickable ffc-layer-row' });
      row.toggleClass('is-selected', selection.has(layer.node));
      row.toggleClass('is-dimmed', !!layer.dimmed);
      // Search and filter always show every result, so groups only collapse when neither is active.
      const id = layer.kind === 'group' && layer.children.length > 0 && !this.filtering ? layer.node.id : undefined;
      const collapsed = !!id && this.collapsed.has(id);
      row.toggleClass('mod-collapsible', !!id);
      row.toggleClass('is-collapsed', collapsed);
      // A collapsed group hides its contents, so it says when the selection is inside.
      row.toggleClass('has-selection', collapsed && someLayer(layer.children, (l) => selection.has(l.node)));
      const toggle = id ? row.createDiv({ cls: 'tree-item-icon collapse-icon' }) : null;
      setIcon(row.createSpan({ cls: 'ffc-layer-icon' }), LAYER_ICONS[layer.kind]);
      const label = row.createDiv({ cls: 'tree-item-inner ffc-layer-label', text: layer.label });
      const rename = RENAMES[layer.kind];
      // In presentation order, each anchor's stop number, in core's flair (where the file explorer puts counts).
      const stop = this.ordering ? i + 1 : undefined;
      const nodeId = layer.node.id;
      if (layer.type || rename || stop || ((stars || removable) && nodeId)) {
        const flair = row.createDiv({ cls: 'tree-item-flair-outer' });
        if (stop) flair.createSpan({ cls: 'tree-item-flair', text: String(stop) });
        if (layer.type) flair.createSpan({ cls: 'ffc-note-chip', text: layer.type });
        if (rename) this.makeRename(canvas, flair, row, label, layer.node, rename);
        if (stars && nodeId) this.makeStar(flair, nodeId);
        if (removable && nodeId) this.makeUnfavorite(flair, nodeId);
      }
      if (toggle && id) this.makeToggle(toggle, label, id, collapsed);

      row.addEventListener('click', (e) => {
        if (row.hasClass('is-being-renamed')) return;
        if (e.shiftKey) canvas.toggleSelect?.(layer.node);
        else focusNode(canvas, layer.node);
      });
      row.addEventListener('dblclick', () => {
        if (layer.kind !== 'group' && layer.kind !== 'anchor') return;
        focusNode(canvas, layer.node);
        if (layer.kind === 'group') beginLabelEdit(layer.node);
        else layer.node.startEditing?.();
      });
      row.addEventListener('mouseenter', () => layer.node.nodeEl?.addClass(HOVER_CLASS));
      row.addEventListener('mouseleave', () => layer.node.nodeEl?.removeClass(HOVER_CLASS));
      if (!collapsed && layer.children.length > 0) {
        this.renderList(canvas, item.createDiv({ cls: 'tree-item-children' }), layer.children, selection, stars);
      }
    }
  }

  /**
   * Core's tree collapse icon: a triangle that turns when the group collapses. It's named by the
   * group's label rather than an aria-label, so hovering it doesn't pop a tooltip.
   */
  private makeToggle(toggle: HTMLElement, label: HTMLElement, id: string, collapsed: boolean): void {
    setIcon(toggle, 'right-triangle');
    toggle.toggleClass('is-collapsed', collapsed);
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

  /** A star that adds the layer to the favourites section, or takes it out. Shown on hover, and always once starred. */
  private makeStar(flair: HTMLElement, id: string): void {
    const starred = this.favorites.has(id);
    const btn = this.makeFavoriteButton(flair, id, 'ffc-layer-star', 'star', starred ? 'Remove from favorites' : 'Add to favorites');
    btn.toggleClass('is-starred', starred);
  }

  /** An x on a row in the favourites section, shown on hover, that takes the layer out of it. */
  private makeUnfavorite(flair: HTMLElement, id: string): void {
    this.makeFavoriteButton(flair, id, 'ffc-layer-unfavorite', 'x', 'Remove favorite');
  }

  private makeFavoriteButton(flair: HTMLElement, id: string, cls: string, icon: string, label: string): HTMLButtonElement {
    const btn = flair.createEl('button', {
      cls: `clickable-icon ${cls}`,
      attr: { 'aria-label': label, 'data-tooltip-position': 'right' },
    });
    setIcon(btn, icon);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      // The redraw removes this button while it is hovered, so its tooltip would never get a mouseleave to close on.
      activeDocument.body.findAll('.tooltip').forEach((tip) => tip.remove());
      this.toggleFavorite(id);
    });
    btn.addEventListener('dblclick', (e) => e.stopPropagation());
    return btn;
  }

  /** A pencil, shown on hover, that turns a layer's label into a field to name it. */
  private makeRename(canvas: CanvasLike, flair: HTMLElement, row: HTMLElement, label: HTMLElement, node: CanvasNodeLike, rename: Rename): void {
    const btn = flair.createEl('button', {
      cls: 'clickable-icon ffc-layer-rename',
      attr: { 'aria-label': rename.tooltip, 'data-tooltip-position': 'right' },
    });
    setIcon(btn, 'pencil');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.beginRename(canvas, row, label, node, rename);
    });
    btn.addEventListener('dblclick', (e) => e.stopPropagation());
  }

  /**
   * Rename in place, as core's file explorer does: the label itself becomes editable, so the row keeps its
   * size. Enter or leaving it saves, Escape cancels.
   */
  private beginRename(canvas: CanvasLike, row: HTMLElement, label: HTMLElement, node: CanvasNodeLike, rename: Rename): void {
    if (this.renaming) return;
    this.renaming = true;
    const before = rename.read(node);
    label.textContent = before;
    // The list is redrawn when the rename ends, which throws the editable label away.
    editPlainText(label);
    row.addClass('is-being-renamed');
    label.focus();
    label.win.getSelection()?.selectAllChildren(label);

    let done = false;
    const finish = (save: boolean): void => {
      if (done) return;
      done = true;
      this.renaming = false;
      label.win.getSelection()?.removeAllRanges();
      const after = (label.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (save && after !== before) batch(canvas, () => patchData(node, rename.patch(node, after)));
      // Force a redraw even if nothing changed, to put the label back.
      this.shown = '';
      this.update();
    };
    label.addEventListener('keydown', (e) => {
      // Keep keys away from the canvas (Delete would remove the selection) and the tool shortcuts.
      e.stopPropagation();
      if (e.isComposing) return;
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    });
    // Switching to another window blurs the label too; focus comes back to it on return, so keep editing.
    label.addEventListener('blur', () => { if (label.doc.hasFocus()) finish(true); });
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

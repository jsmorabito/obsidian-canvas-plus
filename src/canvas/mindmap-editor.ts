import { ItemView, Menu, TFile } from 'obsidian';
import type { ProviderId } from '../issues/types.ts';
import { CanvasNodeLike, isElement } from './adapter.ts';
import { CLICK_SLOP_PX } from './constants.ts';
import { createNoteFromText, TypeSource } from './convert-card.ts';
import { diagramHost } from './diagram-card.ts';
import { DiagramLinks, readDiagram } from './diagram-data.ts';
import { plainText } from './diagram-links.ts';
import { addExportItems, copyText } from './diagram-export.ts';
import { DiagramEditorBase } from './diagram-editor-base.ts';
import { DotSpec } from './floating-tools.ts';
import { openInPlaceField } from './in-place-field.ts';
import { DG_NODE_ICON, LINEAR_ICON, NOTE_TYPES_ICON, TASKAPP_ICON } from './icons.ts';
import { createIssueFromText } from './issue-create.ts';
import { LinkPicker } from './link-picker.ts';
import {
  Direction, MINDMAP_SHAPES, Mindmap, MindmapShape, Placement, addChild, addSibling, colorOf, duplicateNode, iconOf, isLabelFormatted,
  isWithin, labelOf, moveNode, neighbour, outlineOf, parseOutline, pasteOutline, readMindmap, relocate, remove, rename, setBranchColor,
  setColor, setNodeIcon, setShape, shapeOf, siblingsOf, toggleLabelFormat,
} from './mindmap-edit.ts';
import { TEXT_FORMATS, TextFormat } from './mindmap-format.ts';
import { trackPointer } from './pointer-session.ts';
import { ShapeOption, addColorButton, addCreateButtons, addFormatButtons, addIconButton, addShapeButton } from './toolbar-parts.ts';
import type { SideEffect } from './undo-journal.ts';

const ACTIVE_CLASS = 'ffc-mm-active';
/** Set on a card while a node other than the central one is picked in it, which hides the card's outline. */
const PICKED_ATTR = 'data-ffc-picked';
type Action = 'child' | 'sibling' | 'before' | 'rename' | 'remove' | 'up' | 'down' | 'indent' | 'outdent' | 'duplicate';
/** What a drag measures once, when it starts: the mindmap, the dragged node's siblings, and every node it could land on. */
interface DragContext {
  map: Mindmap;
  siblings: Set<number>;
  targets: Array<{ i: number; el: SVGElement; rect: DOMRect }>;
}

const PICKED_CLASS = 'ffc-mm-node-picked';
const DRAGGING_CLASS = 'ffc-mm-dragging';
const DROP_TARGET_CLASS = 'ffc-mm-drop-target';
const SHAPE_LABELS: Record<MindmapShape, string> = {
  text: 'Plain text', rounded: 'Rounded', square: 'Square', hexagon: 'Hexagon', cloud: 'Cloud', bang: 'Bang', circle: 'Circle',
};
const SHAPE_OPTIONS: Array<ShapeOption<MindmapShape>> = MINDMAP_SHAPES.map((id) => ({ id, label: SHAPE_LABELS[id] }));
const ARROWS: Record<string, Direction> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };

/**
 * Edit a mindmap in its diagram card, on the canvas. Select the card, then a node in it. Tab adds a child, Enter
 * a sibling, F2 or a double-click renames, Delete removes it and what's under it, and the arrow keys move
 * between nodes. Each change is written into the Mermaid source as one undo step, so the source stays the
 * only record of the mindmap.
 */
export class MindmapEditor extends DiagramEditorBase {
  protected readonly cardSelector = '.canvas-node[data-ffc-mindmap]';
  private active: { node: CanvasNodeLike; k: number } | null = null;
  /** A node being dragged to a new place among its siblings. */
  private drag: { el: SVGElement; indicator: HTMLElement; target: { k: number; place: Placement; el: SVGElement } | null } | null = null;
  /** Whether a colour picked in the toolbar goes to the node's children too. */
  private wholeBranch = false;

  /** Listen on the canvas for presses on mindmap nodes. Returns what removes the listeners. */
  attach(): () => void {
    const wrapper = this.canvas.wrapperEl;
    const down = (e: Event): void => this.onDown(e as PointerEvent);
    const dbl = (e: Event): void => this.onDoubleClick(e as MouseEvent);
    const link = (e: Event): void => this.onLinkClick(e as MouseEvent);
    const menu = (e: Event): void => this.onContextMenu(e as MouseEvent);
    const doc = this.view.containerEl.doc;
    const copy = (e: Event): void => this.onCopy(e as ClipboardEvent);
    const paste = (e: Event): void => this.onPaste(e as ClipboardEvent);
    const hover = (e: Event): void => this.onHover(e as MouseEvent);
    wrapper.addEventListener('pointerdown', down, true);
    wrapper.addEventListener('dblclick', dbl, true);
    wrapper.addEventListener('click', link, true);
    wrapper.addEventListener('contextmenu', menu, true);
    doc.addEventListener('copy', copy, true);
    doc.addEventListener('paste', paste, true);
    wrapper.addEventListener('mouseover', hover, true);
    return () => {
      wrapper.removeEventListener('pointerdown', down, true);
      wrapper.removeEventListener('dblclick', dbl, true);
      wrapper.removeEventListener('click', link, true);
      wrapper.removeEventListener('contextmenu', menu, true);
      doc.removeEventListener('copy', copy, true);
      doc.removeEventListener('paste', paste, true);
      wrapper.removeEventListener('mouseover', hover, true);
      this.stopFollowing();
      this.closeField();
      this.active = null;
      this.paint();
      this.clearTools();
    };
  }

  /** The card node under `target` and the mindmap node it is on, when that card holds a mindmap that can be edited this way. */
  private hit(target: EventTarget | null): { node: CanvasNodeLike; map: Mindmap; k: number } | null {
    if (!isElement(target)) return null;
    const mindmapNode = target.closest<HTMLElement>('.pele-node');
    const cardEl = target.closest<HTMLElement>('.canvas-node[data-ffc-diagram]');
    if (!mindmapNode || !cardEl) return null;
    const node = [...(this.canvas.nodes?.values() ?? [])].find((n) => n.nodeEl === cardEl);
    const diagram = node && readDiagram(node);
    const map = diagram && readMindmap(diagram.source);
    if (!node || !map) return null;
    const k = map.items.findIndex((i) => i.nodeId === mindmapNode.getAttribute('data-id'));
    return k < 0 ? null : { node, map, k };
  }

  private onDown(e: PointerEvent): void {
    if (isElement(e.target) && e.target.closest('.ffc-mm-input, .ffc-mm-tools, .ffc-mm-toolbar')) return;
    this.stopFollowing();
    const hit = this.hit(e.target);
    this.linkPress = hit
      ? { x: e.clientX, y: e.clientY, wasActive: this.active?.node === hit.node && this.active.k === hit.k }
      : null;
    if (!hit) {
      this.deselect();
      return;
    }
    // A multi-select press leaves the node alone.
    if (e.button !== 0 || e.shiftKey || e.metaKey || e.ctrlKey) return;
    // Pick the node on the press itself, without waiting for core to select the card: select it here, and draw now.
    // A card that is one of several selected stays as it is, for moving them together.
    const selection = this.canvas.selection;
    if (!selection?.has(hit.node)) this.canvas.selectOnly?.(hit.node);
    else if (selection.size > 1) return;
    this.closeField();
    this.active = { node: hit.node, k: hit.k };
    this.paint();
    if (hit.map.items[hit.k].parent >= 0) {
      // Dragging a node moves it among its siblings, not the card: core never sees the press.
      e.stopPropagation();
      this.followDrag(e, hit);
      return;
    }
    // A press that turns into a drag is moving the card, not picking a node.
    this.stopFollowing = trackPointer(this.view.containerEl.doc, e.pointerId, {
      move: (move) => {
        if (Math.hypot(move.clientX - e.clientX, move.clientY - e.clientY) > CLICK_SLOP_PX) {
          this.stopFollowing();
          this.deselect();
        }
      },
      up: () => this.stopFollowing(),
      cancel: () => this.stopFollowing(),
    });
  }

  /** Drag the node under the press to a new place: it follows the pointer, and a line (beside a node) or an outline (inside it) shows where it will go. */
  private followDrag(down: PointerEvent, hit: { node: CanvasNodeLike; map: Mindmap; k: number }): void {
    const { node, k } = hit;
    const host = diagramHost(node);
    const el = this.nodeEl(node, hit.map.items[k].nodeId);
    if (!host || !el) return;
    const ctm = el.ownerSVGElement?.getScreenCTM();
    // Screen pixels per drawing unit.
    const unit = ctm && ctm.a > 0 ? ctm.a : 1;
    let started = false;
    let context: DragContext | null = null;

    const finish = (commit: boolean): void => {
      this.stopFollowing();
      const drag = this.drag;
      this.drag = null;
      if (!started || !drag) return;
      el.setCssProps({ '--ffc-mm-drag': '' });
      el.removeClass(DRAGGING_CLASS);
      drag.indicator.remove();
      drag.target?.el.removeClass(DROP_TARGET_CLASS);
      const live = this.current();
      const target = drag.target;
      const moved = commit && target && live && live.node === node && live.k === k ? moveNode(live.map, k, target.k, target.place) : null;
      if (moved) this.edit(node, moved, false);
      else this.paint();
    };
    this.stopFollowing = trackPointer(this.view.containerEl.doc, down.pointerId, {
      move: (move) => {
        if (!started) {
          if (Math.hypot(move.clientX - down.clientX, move.clientY - down.clientY) <= CLICK_SLOP_PX) return;
          started = true;
          this.clearTools();
          el.addClass(DRAGGING_CLASS);
          this.drag = { el, indicator: host.createDiv({ cls: 'ffc-mm-drop' }), target: null };
          // Nothing but the dragged node moves during the drag, so where the others are is read once.
          const map = hit.map;
          context = {
            map,
            siblings: new Set(siblingsOf(map, k)),
            targets: map.items.flatMap((item, i) => {
              const target = isWithin(map, i, k) ? null : this.nodeEl(node, item.nodeId);
              return target ? [{ i, el: target, rect: target.getBoundingClientRect() }] : [];
            }),
          };
        }
        const drag = this.drag;
        if (!drag || !context) return;
        el.setCssProps({ '--ffc-mm-drag': `${(move.clientX - down.clientX) / unit}px ${(move.clientY - down.clientY) / unit}px` });
        this.aim(drag, context, host, move);
      },
      up: () => finish(true),
      cancel: () => finish(false),
    });
  }

  /**
   * Work out where the dragged node would go, and show it. Over the top or bottom quarter of another node it goes
   * before or after that node; over the middle it goes inside, as that node's last child. In the gaps between
   * nodes it goes beside the nearest of its own siblings.
   */
  private aim(drag: NonNullable<MindmapEditor['drag']>, context: DragContext, host: HTMLElement, pointer: PointerEvent): void {
    const { map, siblings, targets } = context;
    let over: { i: number; el: SVGElement; rect: DOMRect } | null = null;
    let near: { i: number; el: SVGElement; rect: DOMRect; dist: number } | null = null;
    for (const { i, el, rect } of targets) {
      const inside = pointer.clientX >= rect.left && pointer.clientX <= rect.right && pointer.clientY >= rect.top && pointer.clientY <= rect.bottom;
      if (inside) over = { i, el, rect };
      const dist = Math.hypot(
        Math.max(rect.left - pointer.clientX, 0, pointer.clientX - rect.right),
        Math.max(rect.top - pointer.clientY, 0, pointer.clientY - rect.bottom),
      );
      if (siblings.has(i) && (!near || dist < near.dist)) near = { i, el, rect, dist };
    }

    let next: { k: number; place: Placement; el: SVGElement; rect: DOMRect } | null = null;
    const hit = over;
    const close = near;
    if (hit) {
      const fraction = (pointer.clientY - hit.rect.top) / hit.rect.height;
      // Nothing goes beside the root, so all of it is a way in.
      const place: Placement = map.items[hit.i].parent < 0 || (fraction >= 0.25 && fraction <= 0.75) ? 'inside' : fraction < 0.25 ? 'before' : 'after';
      next = { k: hit.i, place, el: hit.el, rect: hit.rect };
    } else if (close) {
      next = { k: close.i, place: pointer.clientY < close.rect.top + close.rect.height / 2 ? 'before' : 'after', el: close.el, rect: close.rect };
    }

    drag.target?.el.removeClass(DROP_TARGET_CLASS);
    drag.indicator.addClass('is-hidden');
    drag.target = next ? { k: next.k, place: next.place, el: next.el } : null;
    if (!next) return;
    if (next.place === 'inside') {
      next.el.addClass(DROP_TARGET_CLASS);
      return;
    }
    const hostRect = host.getBoundingClientRect();
    const scale = host.offsetWidth > 0 ? hostRect.width / host.offsetWidth : 1;
    drag.indicator.removeClass('is-hidden');
    drag.indicator.setCssProps({
      '--ffc-mm-left': `${(next.rect.left - hostRect.left) / scale}px`,
      '--ffc-mm-top': `${((next.place === 'before' ? next.rect.top : next.rect.bottom) - hostRect.top) / scale}px`,
      '--ffc-mm-width': `${next.rect.width / scale}px`,
    });
  }

  /** Stop watching the press in progress. */
  private stopFollowing: () => void = () => { /* no press to watch */ };

  /** The picked node, when a copy or paste is for it: this canvas is the one in use, and no field is being typed in. */
  private clipboardTarget(e: ClipboardEvent): { node: CanvasNodeLike; map: Mindmap; k: number } | null {
    if (this.field || this.canvas.readonly || this.view.app.workspace.getActiveViewOfType(ItemView) !== this.view) return null;
    if (isElement(e.target) && e.target.closest('input, textarea, [contenteditable="true"], .cm-editor')) return null;
    return this.current();
  }

  /** Copying with a node picked puts it, and what is under it, on the clipboard as a markdown list. */
  private onCopy(e: ClipboardEvent): void {
    const target = this.clipboardTarget(e);
    if (!target || !e.clipboardData) return;
    e.clipboardData.setData('text/plain', outlineOf(target.map, target.k));
    e.preventDefault();
    e.stopPropagation();
  }

  /**
   * Pasting a list or an outline with a node picked adds it under that node. Canvas data (cards that were copied)
   * is left for the canvas.
   */
  private onPaste(e: ClipboardEvent): void {
    const target = this.clipboardTarget(e);
    const text = e.clipboardData?.getData('text/plain') ?? '';
    if (!target || !text.trim()) return;
    if (/^\s*[{[]/.test(text)) {
      try {
        JSON.parse(text);
        return;
      } catch { /* not canvas data: an outline that starts with a bracket */ }
    }
    const pasted = pasteOutline(target.map, target.k, parseOutline(text));
    if (!pasted) return;
    e.preventDefault();
    e.stopPropagation();
    this.edit(target.node, pasted, false);
  }

  /** Right-click on a node: pick it, and offer what can be done to it, in the canvas's own menu style. */
  private onContextMenu(e: MouseEvent): void {
    const hit = this.hit(e.target);
    if (!hit || this.canvas.readonly) return;
    // Past core's own menu for the card.
    e.preventDefault();
    e.stopPropagation();
    this.closeField();
    if (!this.canvas.selection?.has(hit.node) || this.canvas.selection.size > 1) this.canvas.selectOnly?.(hit.node);
    this.active = { node: hit.node, k: hit.k };
    this.paint();
    const current = this.current();
    if (!current) return;
    const { node, map, k } = current;
    const root = map.items[k].parent < 0;
    // What the toolbar's buttons open, so the menu doesn't repeat them.
    const press = (label: string): void => this.tools.bar?.querySelector<HTMLElement>(`[aria-label="${label}"]`)?.click();

    const menu = new Menu();
    menu.addItem((item) => item.setSection('add').setTitle('Add child').setIcon('corner-down-right').onClick(() => this.act('child')));
    if (!root) {
      menu.addItem((item) => item.setSection('add').setTitle('Add sibling below').setIcon('arrow-down-to-line').onClick(() => this.act('sibling')));
      menu.addItem((item) => item.setSection('add').setTitle('Add sibling above').setIcon('arrow-up-to-line').onClick(() => this.act('before')));
    }
    const moves: Array<[Action, string, string]> = [['up', 'Move up', 'arrow-up'], ['down', 'Move down', 'arrow-down'], ['indent', 'Indent', 'indent-increase'], ['outdent', 'Outdent', 'indent-decrease']];
    for (const [action, title, icon] of moves) {
      if (relocate(map, k, action as 'up' | 'down' | 'indent' | 'outdent')) {
        menu.addItem((item) => item.setSection('move').setTitle(title).setIcon(icon).onClick(() => this.act(action)));
      }
    }
    if (!root) menu.addItem((item) => item.setSection('copy').setTitle('Duplicate').setIcon('copy-plus').onClick(() => this.act('duplicate')));
    menu.addItem((item) => item.setSection('copy').setTitle('Copy as outline').setIcon('list-tree').onClick(() => {
      void copyText(outlineOf(map, k), 'Copied the outline.');
    }));
    menu.addItem((item) => item.setSection('edit').setTitle('Rename').setIcon('pencil').onClick(() => this.act('rename')));
    menu.addItem((item) => item.setSection('edit').setTitle('Color…').setIcon('palette').onClick(() => press('Color')));
    menu.addItem((item) => item.setSection('edit').setTitle('Shape…').setIcon('shapes').onClick(() => press('Shape')));
    menu.addItem((item) => item.setSection('edit').setTitle('Icon…').setIcon('smile').onClick(() => press('Icon')));
    for (const format of TEXT_FORMATS) {
      menu.addItem((item) => item
        .setSection('format')
        .setTitle(format.label)
        .setIcon(format.icon)
        .setChecked(isLabelFormatted(map, k, format))
        .onClick(() => this.applyFormat(format)));
    }
    const make = (title: string, icon: string, run: () => void): void => {
      menu.addItem((item) => item.setSection('create').setTitle(title).setIcon(icon).onClick(run));
    };
    if (this.plugin.hasNoteTypes) make('Convert to…', NOTE_TYPES_ICON, () => this.createNote('notes'));
    if (this.plugin.hasDiscourseGraphs) make('Convert to discourse node…', DG_NODE_ICON, () => this.createNote('discourse'));
    if (this.plugin.hasIssues('linear')) make('Create Linear issue', LINEAR_ICON, () => this.createIssue('linear'));
    if (this.plugin.hasIssues('taskapp')) make('Create Task App issue', TASKAPP_ICON, () => this.createIssue('taskapp'));
    addExportItems(menu, this.plugin, this.canvas, node);
    if (!root) {
      menu.addItem((item) => item.setSection('danger').setTitle('Delete').setIcon('trash-2').setWarning(true).onClick(() => this.act('remove')));
    }
    menu.showAtMouseEvent(e);
  }

  private onDoubleClick(e: MouseEvent): void {
    const hit = this.hit(e.target);
    if (!hit || this.canvas.readonly) return;
    // Past core's own double-click, which would open the card's source.
    e.preventDefault();
    e.stopPropagation();
    this.active = { node: hit.node, k: hit.k };
    this.paint();
    this.rename();
  }

  /** Handle a key for the selected mindmap node. Returns whether it was used. */
  handleKey(e: KeyboardEvent): boolean {
    const current = this.current();
    if (!current || this.canvas.readonly) return false;
    const { node, map, k } = current;
    if (e.key === 'Escape') {
      this.deselect();
      return true;
    }
    // Alt and an arrow moves the node among its siblings; Cmd or Ctrl and a bracket indents or outdents it, as in a list.
    const mod = e.metaKey || e.ctrlKey;
    if (e.altKey && !mod && !e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      this.act(e.key === 'ArrowUp' ? 'up' : 'down');
      return true;
    }
    if (mod && !e.altKey && !e.shiftKey && (e.key === ']' || e.key === '[')) {
      this.act(e.key === ']' ? 'indent' : 'outdent');
      return true;
    }
    if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'd') {
      this.act('duplicate');
      return true;
    }
    if (mod || e.altKey) return false;
    const arrow = ARROWS[e.key];
    if (arrow && !e.shiftKey) {
      this.active = { node, k: neighbour(map, k, arrow) };
      this.paint();
      return true;
    }
    if (e.shiftKey) return false;
    const action = e.key === 'Tab' ? 'child' : e.key === 'Enter' ? 'sibling' : e.key === 'F2' ? 'rename'
      : e.key === 'Delete' || e.key === 'Backspace' ? 'remove' : null;
    if (!action) return false;
    this.act(action);
    return true;
  }

  /** What the keys and the buttons beside the selected node do. */
  private act(action: Action): void {
    const current = this.current();
    if (!current || this.canvas.readonly) return;
    const { node, map, k } = current;
    if (action === 'rename') this.rename();
    else if (action === 'child') this.edit(node, addChild(map, k));
    else if (action === 'sibling') this.edit(node, addSibling(map, k));
    else if (action === 'before') this.edit(node, addSibling(map, k, true));
    else if (action === 'duplicate') {
      const copy = duplicateNode(map, k);
      if (copy) this.edit(node, copy, false);
    } else if (action === 'up' || action === 'down' || action === 'indent' || action === 'outdent') {
      const moved = relocate(map, k, action);
      if (moved) this.edit(node, moved, false);
    } else {
      const removed = remove(map, k);
      if (removed) this.edit(node, removed, false);
    }
  }

  /** Re-apply the highlight after the diagram has been drawn again, and let go when the card is no longer selected. */
  refresh(): void {
    if (this.active && !this.current()) this.deselect();
    else this.paint();
  }

  /** The selected mindmap node, checked against the card's source as it is now. */
  private current(): { node: CanvasNodeLike; map: Mindmap; k: number } | null {
    const active = this.active;
    if (!active || !this.isOnlySelected(active.node)) return null;
    const diagram = readDiagram(active.node);
    const map = diagram && readMindmap(diagram.source);
    return map && active.k < map.items.length ? { node: active.node, map, k: active.k } : null;
  }

  private deselect(): void {
    this.closeField();
    this.active = null;
    this.paint();
  }

  private paint(): void {
    for (const el of Array.from(this.canvas.wrapperEl.querySelectorAll(`.canvas-node[data-ffc-mindmap] .${ACTIVE_CLASS}`))) el.removeClass(ACTIVE_CLASS);
    for (const el of Array.from(this.canvas.wrapperEl.querySelectorAll(`.canvas-node[data-ffc-mindmap][${PICKED_ATTR}]`))) el.removeAttribute(PICKED_ATTR);
    const current = this.current();
    // With a node picked, its own toolbar is the one to use, not the card's.
    this.canvas.wrapperEl.toggleClass(PICKED_CLASS, !!current);
    // A mindmap card shows no outline while one of its nodes is picked, except the central one: the card is then what is picked.
    if (current && current.map.items[current.k].parent >= 0) current.node.nodeEl?.setAttribute(PICKED_ATTR, '');
    if (!current) {
      this.clearTools();
      return;
    }
    const id = current.map.items[current.k].nodeId;
    const el = this.nodeEl(current.node, id);
    el?.addClass(ACTIVE_CLASS);
    this.showTools(current, el);
  }

  /** Write new source for the selected node's card, keeping the node selected. */
  private apply(node: CanvasNodeLike, source: string, k: number): void {
    this.edit(node, { source, index: k }, false);
  }

  /** Turn a format on or off for the node's text. A wikilink is turned on by picking the note it goes to. */
  private applyFormat(format: TextFormat): void {
    const live = this.current();
    if (!live) return;
    if (format.id === 'wikilink' && !isLabelFormatted(live.map, live.k, format)) {
      this.linkNote(live);
      return;
    }
    this.apply(live.node, toggleLabelFormat(live.map, live.k, format), live.k);
  }

  /** The node's text as plain words. */
  private plainText(live: { map: Mindmap; k: number }): string {
    return plainText(labelOf(live.map, live.k));
  }

  /** Make the node's text a link to a note: the text becomes the link's alias when it isn't the note's name. */
  private applyNoteLink(live: { node: CanvasNodeLike; map: Mindmap; k: number }, file: TFile, effect: SideEffect | null): void {
    const now = this.current();
    if (!now || now.node !== live.node) return;
    this.edit(now.node, { source: rename(now.map, now.k, this.noteLinkText(file, this.plainText(now))), index: now.k }, false, { effect });
  }

  /** Pick a note (searching for the node's text, or creating it), and link the node to it. */
  private linkNote(live: { node: CanvasNodeLike; map: Mindmap; k: number }): void {
    new LinkPicker(this.view.app, this.view.file?.path ?? '', this.plainText(live), (file) => this.applyNoteLink(live, file, null)).open();
  }

  /** Make a note of one of the plugin's types from the node's text, and link the node to it. */
  private createNote(source: TypeSource): void {
    const live = this.current();
    if (!live) return;
    createNoteFromText(this.plugin, this.canvas, this.plainText(live), source, (file, effect) => this.applyNoteLink(live, file, effect));
  }

  /** Create an issue titled with the node's text, and link the node to it. */
  private createIssue(provider: ProviderId): void {
    const live = this.current();
    if (!live) return;
    createIssueFromText(this.plugin, provider, this.canvas, live.node, this.plainText(live), (issue) => {
      const now = this.current();
      if (!now || now.node !== live.node) return;
      const source = rename(now.map, now.k, `[[${issue.identifier} ${issue.title}]]`);
      // The name the link ended up with, which is what the address is kept under.
      const after = readMindmap(source);
      const name = after ? /\[\[([^\][|]+)/.exec(labelOf(after, now.k))?.[1] : undefined;
      this.edit(now.node, { source, index: now.k }, false, name ? { links: { ...(readDiagram(now.node)?.links ?? {}), [name]: issue.url } } : {});
    });
  }

  /** The toolbar's buttons for the picked node. */
  private fillBar(bar: HTMLElement, current: { node: CanvasNodeLike; map: Mindmap; k: number }): void {
    const { map, k } = current;
    addColorButton(bar, {
      chosen: colorOf(map, k),
      branch: map.items.some((i) => i.parent === k) ? { get: () => this.wholeBranch, set: (on) => { this.wholeBranch = on; } } : undefined,
      pick: (color) => {
        const live = this.current();
        if (!live) return;
        const source = this.wholeBranch ? setBranchColor(live.map.lines.join('\n'), live.k, color) : setColor(live.map, live.k, color);
        this.apply(live.node, source, live.k);
      },
    });
    addShapeButton(bar, SHAPE_OPTIONS, shapeOf(map, k), (shape) => {
      const live = this.current();
      if (live) this.apply(live.node, setShape(live.map, live.k, shape), live.k);
    });
    addIconButton(bar, this.view.app, iconOf(map, k), (name) => {
      const live = this.current();
      if (live) this.apply(live.node, setNodeIcon(live.map, live.k, name), live.k);
    });
    addFormatButtons(bar, (format) => isLabelFormatted(map, k, format), (format) => this.applyFormat(format));
    addCreateButtons(bar, this.plugin, { note: (source) => this.createNote(source), issue: (provider) => this.createIssue(provider) });
  }

  private clearTools(): void {
    this.tools.clear();
  }

  /** The dots round the picked node, which add a child or a sibling with a click, and the toolbar over it. */
  private showTools(current: { node: CanvasNodeLike; map: Mindmap; k: number }, el: SVGElement | null): void {
    if (!el || this.field || this.drag) {
      this.clearTools();
      return;
    }
    const key = `${current.node.id ?? ''}|${current.k}|${current.map.lines.join('\n')}`;
    const items = current.map.items;
    const root = items[current.k].parent < 0;
    const rect = el.getBoundingClientRect();
    const rootEl = root ? el : this.nodeEl(current.node, items[items.findIndex((i) => i.parent < 0)].nodeId);
    const rootRect = rootEl?.getBoundingClientRect() ?? rect;
    // Dots on the sides of the node, as FigJam has: out from the root adds a child, below and above add a sibling.
    const outward = rect.left + rect.width / 2 >= rootRect.left + rootRect.width / 2 ? 'right' : 'left';
    const gap = 14;
    const at = {
      right: (r: DOMRect) => ({ x: r.right + gap, y: r.top + r.height / 2 }),
      left: (r: DOMRect) => ({ x: r.left - gap, y: r.top + r.height / 2 }),
      below: (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.bottom + gap }),
      above: (r: DOMRect) => ({ x: r.left + r.width / 2, y: r.top - gap }),
    };
    const dot = (label: string, action: Action, place: DotSpec['at']): DotSpec => ({ label, at: place, run: () => this.act(action) });
    const dots = root
      ? [dot('Add child', 'child', at.right), dot('Add child', 'child', at.left)]
      : [dot('Add child', 'child', at[outward]), dot('Add sibling below', 'sibling', at.below), dot('Add sibling above', 'before', at.above)];
    this.tools.show(el, key, dots, (bar) => this.fillBar(bar, current));
  }

  private nodeEl(node: CanvasNodeLike, id: string): SVGElement | null {
    const host = diagramHost(node);
    return host && Array.from(host.querySelectorAll<SVGElement>('.pele-node')).find((el) => el.getAttribute('data-id') === id) || null;
  }

  /** Save new source for a card as one undo step, and select the node `result.index` in it. */
  private edit(
    node: CanvasNodeLike, result: { source: string; index: number }, rename = true,
    extra: { links?: DiagramLinks; effect?: SideEffect | null } = {},
  ): boolean {
    this.write(node, result.source, extra, () => { this.active = { node, k: result.index }; });
    if (rename) window.requestAnimationFrame(() => this.rename());
    return true;
  }

  /**
   * The links a node's diagram keeps after its text was edited. A link with a web address of its own (an issue's)
   * that was renamed keeps the address, as long as it is the node's only link before and after.
   */
  private carryLink(live: { node: CanvasNodeLike; map: Mindmap; k: number }, source: string): DiagramLinks {
    const links = readDiagram(live.node)?.links ?? {};
    const names = (text: string): string[] => Array.from(text.matchAll(/\[\[([^\][|]+)/g), (m) => m[1]);
    const before = names(labelOf(live.map, live.k));
    const after = readMindmap(source);
    const now = after ? names(labelOf(after, live.k)) : [];
    if (before.length === 1 && now.length === 1 && before[0] !== now[0] && links[before[0]] && !links[now[0]]) {
      return { ...links, [now[0]]: links[before[0]] };
    }
    return links;
  }

  /** A field over the selected node, to type its new name in. Enter saves it, Tab saves it and adds a child, Escape drops it. */
  private rename(): void {
    const current = this.current();
    if (!current) return;
    const { node, map, k } = current;
    const host = diagramHost(node);
    const el = this.nodeEl(node, map.items[k].nodeId);
    if (!host || !el) return;
    this.closeField();
    this.clearTools();
    this.field = openInPlaceField(host, el, labelOf(map, k), (text, commit, tab) => {
      this.field = null;
      const live = this.current();
      if (!commit || !live || text.trim() === labelOf(live.map, live.k)) {
        this.paint();
        return;
      }
      const source = rename(live.map, live.k, text);
      this.edit(live.node, { source, index: live.k }, false, { links: this.carryLink(live, source) });
      if (tab) {
        const after = this.current();
        if (after) this.edit(after.node, addChild(after.map, after.k));
      }
    });
  }
}

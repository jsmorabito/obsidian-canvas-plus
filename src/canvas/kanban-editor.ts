import { Menu, Notice, TFile, setIcon } from 'obsidian';
import { CanvasNodeLike, isElement, toCanvasPoint } from './adapter.ts';
import { CLICK_SLOP_PX } from './constants.ts';
import { diagramHost } from './diagram-card.ts';
import { DiagramHeld, DiagramLinks, readDiagram } from './diagram-data.ts';
import { webLinkText } from './diagram-links.ts';
import { addExportItems } from './diagram-export.ts';
import { DiagramEditorBase } from './diagram-editor-base.ts';
import { DotSpec } from './floating-tools.ts';
import { openInPlaceField } from './in-place-field.ts';
import {
  Direction, Edit, Kanban, Pick, addCard, addCardBefore, addCards, addColumn, labelOf, moveCard, neighbour, readKanban, remove, rename, shift,
} from './kanban-edit.ts';
import { DROP_COLUMN_CLASS, Slot, SlotColumn, chooseSlot, measureColumns, placeIndicator, unitOf } from './kanban-slot.ts';
import { heldMeta } from './kanban-held.ts';
import { trackPointer } from './pointer-session.ts';
import { TrayItem, itemBox, restoreItem } from './tray-items.ts';
import { toolButton } from './toolbar-parts.ts';

const ACTIVE_CLASS = 'ffc-mm-active';
const DRAGGING_CLASS = 'ffc-mm-dragging';
/** Set on a card while a column or card in it is picked, which hides the card's outline. */
const PICKED_ATTR = 'data-ffc-picked';
/** Set on the canvas while a column or card is picked, which hides the card's own toolbar for ours. */
const PICKED_CLASS = 'ffc-kb-picked';
const ARROWS: Record<string, Direction> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
type Action = 'add' | 'above' | 'column' | 'rename' | 'remove';

/** The moves offered for a column or a card, as a direction, its title and its icon. `vertical` adds up and down, which a card has in its column. */
function moveChoices(kind: Pick['kind'], vertical: boolean): Array<[Direction, string, string]> {
  if (kind === 'column') return [['left', 'Move left', 'arrow-left'], ['right', 'Move right', 'arrow-right']];
  const sideways: Array<[Direction, string, string]> = [['left', 'Move to previous column', 'arrow-left'], ['right', 'Move to next column', 'arrow-right']];
  return vertical ? [['up', 'Move up', 'arrow-up'], ['down', 'Move down', 'arrow-down'], ...sideways] : sideways;
}

/** Something dropped on a board from the canvas, to be a card in it. */
export interface Dropped {
  /** What the card says. */
  words: string;
  /** A note the card links to. */
  file?: TFile;
  /** A web address the card links to. */
  url?: string;
  /** The canvas card itself, which the board holds and gives back. */
  held: TrayItem;
}

/** A board's drawing as it is on the screen: the columns measured, and what to draw a drop on. */
export interface BoardView {
  host: HTMLElement;
  columns: SlotColumn[];
  columnEls: SVGElement[];
  unit: number;
}

/**
 * Edit a kanban in its diagram card, on the canvas. Select the card, then a column or a card in it. Enter adds a
 * card, F2 or a double-click renames, Delete removes, the arrow keys move between them, and a card can be dragged
 * to another column. Each change is written into the Mermaid source as one undo step, so the source stays the only
 * record of the board.
 */
export class KanbanEditor extends DiagramEditorBase {
  protected readonly cardSelector = '.canvas-node[data-ffc-kanban]';
  private active: { node: CanvasNodeLike; pick: Pick } | null = null;
  /** A card being dragged to another place on the board. */
  private drag: { el: SVGElement; indicator: HTMLElement; target: { slot: Slot; columnEl: SVGElement } | null } | null = null;

  /** Listen on the canvas for presses on kanban columns and cards. Returns what removes the listeners. */
  attach(): () => void {
    const wrapper = this.canvas.wrapperEl;
    const down = (e: Event): void => this.onDown(e as PointerEvent);
    const dbl = (e: Event): void => this.onDoubleClick(e as MouseEvent);
    const link = (e: Event): void => this.onLinkClick(e as MouseEvent);
    const menu = (e: Event): void => this.onContextMenu(e as MouseEvent);
    const hover = (e: Event): void => this.onHover(e as MouseEvent);
    const key = (e: Event): void => this.onKeyDown(e as KeyboardEvent);
    wrapper.addEventListener('pointerdown', down, true);
    wrapper.addEventListener('dblclick', dbl, true);
    wrapper.addEventListener('click', link, true);
    wrapper.addEventListener('contextmenu', menu, true);
    wrapper.addEventListener('mouseover', hover, true);
    wrapper.addEventListener('keydown', key, true);
    return () => {
      wrapper.removeEventListener('keydown', key, true);
      wrapper.removeEventListener('pointerdown', down, true);
      wrapper.removeEventListener('dblclick', dbl, true);
      wrapper.removeEventListener('click', link, true);
      wrapper.removeEventListener('contextmenu', menu, true);
      wrapper.removeEventListener('mouseover', hover, true);
      this.stopFollowing();
      this.closeField();
      this.active = null;
      this.paint();
    };
  }

  /**
   * A key that reached the canvas without the key scope taking it: the board takes it if it is for the picked column
   * or card, so the canvas doesn't delete the card it is in. Keys typed into a field are left alone.
   */
  private onKeyDown(e: KeyboardEvent): void {
    if (e.defaultPrevented || e.isComposing || !this.active) return;
    if (isElement(e.target) && e.target.closest('input, textarea, select, [contenteditable="true"], .cm-editor, .ffc-mm-input')) return;
    if (this.handleKey(e)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  /** The drawing's columns and cards, in the order the source has them. Null while the drawing is not the source's yet. */
  private elements(node: CanvasNodeLike, kanban: Kanban): { columns: SVGElement[]; cards: SVGElement[] } | null {
    const host = diagramHost(node);
    if (!host) return null;
    const columns = Array.from(host.querySelectorAll<SVGElement>('.pele-column'));
    const cards = Array.from(host.querySelectorAll<SVGElement>('.pele-card'));
    return columns.length === kanban.columns.length && cards.length === kanban.cards.length ? { columns, cards } : null;
  }

  private elementOf(node: CanvasNodeLike, kanban: Kanban, pick: Pick): SVGElement | null {
    const els = this.elements(node, kanban);
    return els ? (pick.kind === 'column' ? els.columns : els.cards)[pick.i] ?? null : null;
  }

  /** The card node under `target` and the column or card it is on, when that card holds a kanban that can be edited this way. */
  private hit(target: EventTarget | null): { node: CanvasNodeLike; kanban: Kanban; pick: Pick } | null {
    if (!isElement(target)) return null;
    const cardEl = target.closest<HTMLElement>('.canvas-node[data-ffc-kanban]');
    const el = target.closest<SVGElement>('.pele-card, .pele-column');
    if (!cardEl || !el) return null;
    const node = [...(this.canvas.nodes?.values() ?? [])].find((n) => n.nodeEl === cardEl);
    const diagram = node && readDiagram(node);
    const kanban = diagram && readKanban(diagram.source);
    const els = node && kanban && this.elements(node, kanban);
    if (!node || !kanban || !els) return null;
    const isCard = el.classList.contains('pele-card');
    const i = (isCard ? els.cards : els.columns).indexOf(el);
    return i < 0 ? null : { node, kanban, pick: { kind: isCard ? 'card' : 'column', i } };
  }

  private onDown(e: PointerEvent): void {
    if (isElement(e.target) && e.target.closest('.ffc-mm-input, .ffc-mm-tools, .ffc-mm-toolbar')) return;
    this.stopFollowing();
    const hit = this.hit(e.target);
    this.linkPress = hit
      ? { x: e.clientX, y: e.clientY, wasActive: this.active?.node === hit.node && this.same(this.active.pick, hit.pick) }
      : null;
    if (!hit) {
      this.deselect();
      return;
    }
    // A multi-select press leaves the board alone.
    if (e.button !== 0 || e.shiftKey || e.metaKey || e.ctrlKey) return;
    // Pick on the press itself, without waiting for core to select the card.
    const selection = this.canvas.selection;
    if (!selection?.has(hit.node)) this.canvas.selectOnly?.(hit.node);
    else if (selection.size > 1) return;
    this.closeField();
    this.active = { node: hit.node, pick: hit.pick };
    this.paint();
    if (hit.pick.kind === 'card' && !this.canvas.readonly) {
      // Dragging a card moves it on the board, not the canvas card: core never sees the press.
      e.stopPropagation();
      this.followDrag(e, hit);
      return;
    }
    // A press that turns into a drag is moving the canvas card, not picking a column.
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

  private same(a: Pick, b: Pick): boolean {
    return a.kind === b.kind && a.i === b.i;
  }

  /**
   * Drag the card under the press: it follows the pointer, and a line shows where in which column it will land. A card
   * that holds a canvas card can be dragged out of the board, and dropped on the canvas to bring that card back.
   */
  private followDrag(down: PointerEvent, hit: { node: CanvasNodeLike; kanban: Kanban; pick: Pick }): void {
    const { node, kanban, pick } = hit;
    const host = diagramHost(node);
    const els = this.elements(node, kanban);
    const el = els?.cards[pick.i];
    if (!host || !els || !el) return;
    const unit = unitOf(el);
    const holds = this.heldBy(node, kanban, pick.i) !== null;
    let columns: SlotColumn[] | null = null;
    let ghost: HTMLElement | null = null;

    const finish = (commit: boolean, up?: PointerEvent): void => {
      this.stopFollowing();
      const drag = this.drag;
      this.drag = null;
      const leaving = !!ghost;
      ghost?.remove();
      if (!columns || !drag) return;
      el.setCssProps({ '--ffc-mm-drag': '' });
      el.removeClass(DRAGGING_CLASS);
      drag.indicator.remove();
      drag.target?.columnEl.removeClass(DROP_COLUMN_CLASS);
      const live = this.current();
      const stillThere = commit && live && live.node === node && this.same(live.pick, pick);
      const at = up && stillThere && leaving ? toCanvasPoint(this.canvas, up) : null;
      if (at) {
        this.putBack(node, pick.i, at);
        return;
      }
      const slot = drag.target?.slot;
      const moved = stillThere && slot && live ? moveCard(live.kanban, pick.i, slot.column.i, slot.before) : null;
      if (moved) this.edit(node, moved);
      else this.paint();
    };
    this.stopFollowing = trackPointer(this.view.containerEl.doc, down.pointerId, {
      move: (move) => {
        if (!columns) {
          if (Math.hypot(move.clientX - down.clientX, move.clientY - down.clientY) <= CLICK_SLOP_PX) return;
          this.clearTools();
          el.addClass(DRAGGING_CLASS);
          this.drag = { el, indicator: host.createDiv({ cls: 'ffc-mm-drop' }), target: null };
          // Nothing but the dragged card moves during the drag, so where the others are is read once.
          columns = measureColumns(kanban, els.columns, els.cards, pick.i);
        }
        const drag = this.drag;
        if (!drag) return;
        el.setCssProps({ '--ffc-mm-drag': `${(move.clientX - down.clientX) / unit}px ${(move.clientY - down.clientY) / unit}px` });
        drag.target?.columnEl.removeClass(DROP_COLUMN_CLASS);
        drag.target = null;
        const rect = host.getBoundingClientRect();
        const outside = move.clientX < rect.left || move.clientX > rect.right || move.clientY < rect.top || move.clientY > rect.bottom;
        if (holds && outside) {
          // Out of the board, it is the canvas card that is carried: a stand-in follows the pointer.
          drag.indicator.addClass('is-hidden');
          ghost ??= this.canvas.wrapperEl.createDiv({ cls: 'ffc-kb-ghost', text: labelOf(kanban, pick) });
          const wrapper = this.canvas.wrapperEl.getBoundingClientRect();
          ghost.setCssProps({ '--ffc-kb-left': `${move.clientX - wrapper.left}px`, '--ffc-kb-top': `${move.clientY - wrapper.top}px` });
          return;
        }
        ghost?.remove();
        ghost = null;
        const slot = chooseSlot(columns, move.clientX, move.clientY, unit);
        const target = slot ? { slot, columnEl: els.columns[slot.column.i] } : null;
        drag.target = target;
        if (!slot || !target) return;
        target.columnEl.addClass(DROP_COLUMN_CLASS);
        placeIndicator(host, drag.indicator, slot, unit);
      },
      up: (up) => finish(true, up),
      cancel: () => finish(false),
    });
  }

  /**
   * A board's drawing as it is on the screen, measured, for something carried over it from the canvas. Null when
   * the card is not a kanban this editor can read, or its drawing isn't the source's yet.
   */
  boardView(node: CanvasNodeLike): BoardView | null {
    const diagram = readDiagram(node);
    const kanban = diagram && readKanban(diagram.source);
    const els = kanban && this.elements(node, kanban);
    const host = diagramHost(node);
    if (!kanban || !els || !host) return null;
    return { host, columns: measureColumns(kanban, els.columns, els.cards), columnEls: els.columns, unit: unitOf(els.columns[0]) };
  }

  /**
   * Add cards for things dropped on a board: in column `column`, above card `before` or at the bottom. A note is a
   * link to it, and anything with a web address a link that opens it. The board holds each canvas card, which comes
   * back when its card is dragged out. `alongside` is what else the drop changes on the canvas (the cards leaving it),
   * in the same undo step.
   */
  addDropped(node: CanvasNodeLike, column: number, before: number | undefined, items: readonly Dropped[], alongside: () => void): void {
    const diagram = readDiagram(node);
    const kanban = diagram && readKanban(diagram.source);
    if (!diagram || !kanban || !kanban.columns[column] || this.canvas.readonly) return;
    const links: DiagramLinks = { ...(diagram.links ?? {}) };
    // Names the links must not take: those the diagram has, and those of the cards added with them.
    let written = diagram.source;
    const texts = items.map((item) => {
      let text = item.words;
      if (item.file) text = this.noteLinkText(item.file, item.file.basename);
      else if (item.url) {
        const link = webLinkText(item.words, written, links);
        links[link.name] = item.url;
        text = link.text;
      }
      written += `\n${text}`;
      return text;
    });
    const added = addCards(kanban, column, texts, before, true, items.map((item) => heldMeta(item.held)));
    if (!added || added.ids.length !== items.length) return;
    const held: DiagramHeld = { ...(diagram.held ?? {}) };
    added.ids.forEach((id, n) => { held[id] = items[n].held; });
    this.write(node, added.source, { links, held, alongside });
  }

  /** Put the canvas card a board's card holds on the canvas, to the right of the board. */
  private putBackBeside(node: CanvasNodeLike, card: number): void {
    const diagram = readDiagram(node);
    const kanban = diagram && readKanban(diagram.source);
    const item = kanban && diagram.held?.[kanban.cards[card]?.id ?? ''];
    if (!item || node.x === undefined || node.y === undefined || node.width === undefined) return;
    const box = itemBox(item);
    this.putBack(node, card, { x: node.x + node.width + 40 + box.width / 2, y: node.y + box.height / 2 });
  }

  /** The canvas card a board's card holds, if it holds one. */
  private heldBy(node: CanvasNodeLike, kanban: Kanban, card: number): TrayItem | null {
    return readDiagram(node)?.held?.[kanban.cards[card].id] ?? null;
  }

  /**
   * Take a card out of the board and put the canvas card it holds back on the canvas, centred on `at` (canvas
   * coordinates). One undo step.
   */
  putBack(node: CanvasNodeLike, card: number, at: { x: number; y: number }): void {
    const diagram = readDiagram(node);
    const kanban = diagram && readKanban(diagram.source);
    const item = diagram && kanban && card < kanban.cards.length ? diagram.held?.[kanban.cards[card].id] : undefined;
    const removed = kanban && item ? remove(kanban, { kind: 'card', i: card }) : null;
    if (!item || !removed || this.canvas.readonly) return;
    const box = itemBox(item);
    let restored: CanvasNodeLike[] = [];
    // The card leaves the source, which is what lets the board let go of what it held.
    this.write(node, removed.source, {
      restore: false,
      alongside: () => { restored = restoreItem(this.canvas, item, { x: at.x - box.width / 2, y: at.y - box.height / 2 }); },
    }, () => { this.active = null; });
    const top = restored.find((n) => n.id === item.id) ?? restored[0];
    if (top) {
      this.canvas.deselectAll?.();
      this.canvas.selectOnly?.(top);
    }
  }

  /** Stop watching the press in progress. */
  private stopFollowing: () => void = () => { /* no press to watch */ };

  /** Right-click on a column or a card: pick it, and offer what can be done to it, in the canvas's own menu style. */
  private onContextMenu(e: MouseEvent): void {
    const hit = this.hit(e.target);
    if (!hit || this.canvas.readonly) return;
    // Past core's own menu for the card.
    e.preventDefault();
    e.stopPropagation();
    this.closeField();
    if (!this.canvas.selection?.has(hit.node) || this.canvas.selection.size > 1) this.canvas.selectOnly?.(hit.node);
    this.active = { node: hit.node, pick: hit.pick };
    this.paint();
    const current = this.current();
    if (!current) return;
    const { node, kanban, pick } = current;
    const card = pick.kind === 'card';

    const menu = new Menu();
    if (card) {
      menu.addItem((item) => item.setSection('add').setTitle('Add card below').setIcon('arrow-down-to-line').onClick(() => this.act('add')));
      menu.addItem((item) => item.setSection('add').setTitle('Add card above').setIcon('arrow-up-to-line').onClick(() => this.act('above')));
    } else {
      menu.addItem((item) => item.setSection('add').setTitle('Add card').setIcon('plus').onClick(() => this.act('add')));
    }
    menu.addItem((item) => item.setSection('add').setTitle('Add column').setIcon('columns-3').onClick(() => this.act('column')));
    for (const [dir, title, icon] of moveChoices(pick.kind, true)) {
      if (shift(kanban, pick, dir)) menu.addItem((item) => item.setSection('move').setTitle(title).setIcon(icon).onClick(() => this.move(dir)));
    }
    menu.addItem((item) => item.setSection('edit').setTitle('Rename').setIcon('pencil').onClick(() => this.act('rename')));
    if (card && this.heldBy(node, kanban, pick.i)) {
      menu.addItem((item) => item.setSection('edit').setTitle('Put back on canvas').setIcon('log-out').onClick(() => this.putBackBeside(node, pick.i)));
    }
    addExportItems(menu, this.plugin, this.canvas, node);
    if (card || kanban.columns.length > 1) {
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
    this.active = { node: hit.node, pick: hit.pick };
    this.paint();
    this.rename();
  }

  /**
   * Handle a key for the selected column or card. Returns whether it was used. A key the board takes must never fall
   * through to the canvas, which would delete the whole card, so a failure is shown and the key counts as used.
   */
  handleKey(e: KeyboardEvent): boolean {
    try {
      return this.takeKey(e);
    } catch (error) {
      console.error('Canvas Plus: a kanban key failed', error);
      new Notice(`Couldn’t change the board: ${error instanceof Error ? error.message : 'something went wrong'}`);
      this.paint();
      return true;
    }
  }

  private takeKey(e: KeyboardEvent): boolean {
    const current = this.current();
    if (!current || this.canvas.readonly) return false;
    const { node, kanban, pick } = current;
    if (e.key === 'Escape') {
      this.deselect();
      return true;
    }
    const mod = e.metaKey || e.ctrlKey;
    const arrow = ARROWS[e.key];
    // Alt and an arrow moves it: a card within its column or across, a column along the row.
    if (arrow && e.altKey && !mod && !e.shiftKey) {
      this.move(arrow);
      return true;
    }
    if (mod && !e.altKey && !e.shiftKey && e.key === 'Enter') {
      this.act('column');
      return true;
    }
    if (mod || e.altKey || e.shiftKey) return false;
    if (arrow) {
      this.active = { node, pick: neighbour(kanban, pick, arrow) };
      this.paint();
      return true;
    }
    const action = e.key === 'Tab' || e.key === 'Enter' ? 'add' : e.key === 'F2' ? 'rename'
      : e.key === 'Delete' || e.key === 'Backspace' ? 'remove' : null;
    if (!action) return false;
    this.act(action);
    return true;
  }

  /** What the keys and the buttons beside the picked column or card do. */
  private act(action: Action): void {
    const current = this.current();
    if (!current || this.canvas.readonly) return;
    const { node, kanban, pick } = current;
    const column = pick.kind === 'column' ? pick.i : kanban.cards[pick.i].column;
    if (action === 'rename') this.rename();
    else if (action === 'add') this.edit(node, addCard(kanban, column, pick.kind === 'card' ? pick.i : undefined), true);
    else if (action === 'above') this.edit(node, pick.kind === 'card' ? addCardBefore(kanban, pick.i) : addCard(kanban, column), true);
    else if (action === 'column') this.edit(node, addColumn(kanban, column), true);
    else {
      const removed = remove(kanban, pick);
      if (removed) this.edit(node, removed);
    }
  }

  private move(dir: Direction): void {
    const current = this.current();
    if (!current || this.canvas.readonly) return;
    const moved = shift(current.kanban, current.pick, dir);
    if (moved) this.edit(current.node, moved);
  }

  /** Re-apply the highlight after the diagram has been drawn again, and let go when the card is no longer selected. */
  refresh(): void {
    if (this.active && !this.current()) this.deselect();
    else this.paint();
  }

  /** The picked column or card, checked against the card's source as it is now. */
  private current(): { node: CanvasNodeLike; kanban: Kanban; pick: Pick } | null {
    const active = this.active;
    if (!active || !this.isOnlySelected(active.node)) return null;
    const diagram = readDiagram(active.node);
    const kanban = diagram && readKanban(diagram.source);
    const { kind, i } = active.pick;
    return kanban && i < (kind === 'column' ? kanban.columns : kanban.cards).length ? { node: active.node, kanban, pick: active.pick } : null;
  }

  private deselect(): void {
    this.closeField();
    this.active = null;
    this.paint();
  }

  private paint(): void {
    for (const el of Array.from(this.canvas.wrapperEl.querySelectorAll(`.canvas-node[data-ffc-kanban] .${ACTIVE_CLASS}`))) el.removeClass(ACTIVE_CLASS);
    for (const el of Array.from(this.canvas.wrapperEl.querySelectorAll(`.canvas-node[data-ffc-kanban][${PICKED_ATTR}]`))) el.removeAttribute(PICKED_ATTR);
    const current = this.current();
    this.canvas.wrapperEl.toggleClass(PICKED_CLASS, !!current);
    current?.node.nodeEl?.setAttribute(PICKED_ATTR, '');
    const el = current && this.elementOf(current.node, current.kanban, current.pick);
    if (!current || !el) {
      this.tools.clear();
      return;
    }
    el.addClass(ACTIVE_CLASS);
    this.showTools(current, el);
  }

  /** The dots round the picked column or card, which add a card or a column with a click, and the toolbar over it. */
  private showTools(current: { node: CanvasNodeLike; kanban: Kanban; pick: Pick }, el: SVGElement): void {
    if (this.field || this.drag) {
      this.tools.clear();
      return;
    }
    const { node, kanban, pick } = current;
    const key = `${node.id ?? ''}|${pick.kind}${pick.i}|${kanban.lines.join('\n')}`;
    const gap = 14;
    const below = (r: DOMRect): { x: number; y: number } => ({ x: r.left + r.width / 2, y: r.bottom + gap });
    const above = (r: DOMRect): { x: number; y: number } => ({ x: r.left + r.width / 2, y: r.top - gap });
    const right = (r: DOMRect): { x: number; y: number } => ({ x: r.right + gap, y: r.top + r.height / 2 });
    const dot = (label: string, action: Action, at: DotSpec['at']): DotSpec => ({ label, at, run: () => this.act(action) });
    const dots = pick.kind === 'card'
      ? [dot('Add card below', 'add', below), dot('Add card above', 'above', above)]
      : [dot('Add card', 'add', below), dot('Add column', 'column', right)];
    this.tools.show(el, key, dots, (bar) => this.fillBar(bar, current));
  }

  /** The toolbar's buttons for the picked column or card. */
  private fillBar(bar: HTMLElement, current: { kanban: Kanban; pick: Pick }): void {
    const { kanban, pick } = current;
    const button = (label: string, icon: string, run: () => void): void => {
      const b = toolButton(bar, label);
      setIcon(b, icon);
      b.addEventListener('click', (ev) => {
        ev.stopPropagation();
        run();
      });
    };
    button('Rename', 'pencil', () => this.act('rename'));
    if (pick.kind === 'column') button('Add card', 'plus', () => this.act('add'));
    button('Add column', 'columns-3', () => this.act('column'));
    for (const [dir, label, icon] of moveChoices(pick.kind, false)) if (shift(kanban, pick, dir)) button(label, icon, () => this.move(dir));
    if (pick.kind === 'card' || kanban.columns.length > 1) button('Delete', 'trash-2', () => this.act('remove'));
  }

  private clearTools(): void {
    this.tools.clear();
  }

  /** Save new source for a card as one undo step, and pick what the edit says. A new column or card is named at once. */
  private edit(node: CanvasNodeLike, result: Edit, nameIt = false): void {
    this.write(node, result.source, {}, () => { this.active = { node, pick: result.pick }; });
    if (nameIt) window.requestAnimationFrame(() => this.rename());
  }

  /** A field over the picked column or card, to type its new name in. Enter saves it, Tab saves it and adds a card, Escape drops it. */
  private rename(): void {
    const current = this.current();
    if (!current) return;
    const { node, kanban, pick } = current;
    const host = diagramHost(node);
    const el = this.elementOf(node, kanban, pick);
    if (!host || !el) return;
    this.closeField();
    this.clearTools();
    this.field = openInPlaceField(host, el, labelOf(kanban, pick), (text, commit, tab) => {
      this.field = null;
      const live = this.current();
      const renamed = commit && live ? rename(live.kanban, live.pick, text) : null;
      if (renamed && live) this.edit(live.node, renamed);
      else this.paint();
      if (tab) this.act('add');
    }, []);
  }
}

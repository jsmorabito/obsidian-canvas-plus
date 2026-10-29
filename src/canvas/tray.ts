import { Platform, setIcon } from 'obsidian';
import type { CanvasPlusPlugin } from '../main.ts';
import {
  CanvasLike, CanvasNodeLike, CanvasViewLike, afterCanvasFrame, batch, draggedNodes, holdEdgePan, isElement, isReadonly,
  removeNode, shieldFromCanvas,
} from './adapter.ts';
import { CLICK_SLOP_PX } from './constants.ts';
import { isAnchor } from './anchor.ts';
import { readInk } from './ink-nodes.ts';
import { LAYER_ICONS } from './layers-tree.ts';
import { pinLook } from './pin-node.ts';
import { trackPointer } from './pointer-session.ts';
import { CanvasPanels, PanelDropTarget, describePanel } from './canvas-panels.ts';
import type { PanelDock } from './panel-dock.ts';
import { Holder, holderOf, splitByHolder } from './holder.ts';
import { PanelRecord } from './panel-store.ts';
import { PRESENTING_CLASS } from './presentation.ts';
import { TrayItem, commentItem, itemBox, readTray, restoreItem, trayItemsFrom, writeTray } from './tray-items.ts';
import { CanvasComment, movedTo, readComments, writeComments } from './comments.ts';

/** The theme colours behind core's six canvas colours. */
/**
 * Whether each view's tray is open, and the file it was open for. Kept by view rather than by tray, so it survives
 * the controller being rebuilt (a canvas moved to a popout), and gone with the view when the tab closes.
 */
const viewState = new WeakMap<object, { open: boolean; path: string | undefined }>();

const PRESET_VARS: Record<string, string> = {
  '1': 'var(--color-red)', '2': 'var(--color-orange)', '3': 'var(--color-yellow)',
  '4': 'var(--color-green)', '5': 'var(--color-cyan)', '6': 'var(--color-purple)',
};
/** Canvas units a comment pin's outline takes while it's dragged out of the tray. */
const PIN_BOX = { width: 40, height: 40 };
/** Core's menus and controls, and the toolbar the tray is in: a press there never starts a drag of nodes. */
const CANVAS_UI = '.canvas-card-menu, .canvas-controls, .canvas-menu-container, .ffc-mm-toolbar';

/** Follows a pointer for the tray: `update` with each move, and `release` when it's let go. */
interface OverWatch {
  update(e: PointerEvent): void;
  release(): void;
}

/**
 * The tray: holds things for later. Its button sits in the bottom toolbar after the eraser, and its strip opens
 * just above the toolbar. Dragging anything on the canvas shows the strip as a drop zone (when it's open, the
 * strip itself takes the drop); dropping there takes the dragged nodes off the canvas and keeps each as a small
 * card, and leaves the tray open to show it. A tab panel dragged there by its header goes in
 * too. Dragging a card back onto the canvas puts it back. The button keeps the strip open, to see what it holds,
 * or closes it again.
 *
 * The canvas's things are saved in the canvas file, so they go wherever the canvas does, and putting one in or
 * taking it out is undone with the canvas's own undo. Panels are kept with the other panels, in the plugin's data.
 */
export class Tray implements PanelDropTarget {
  private el: HTMLElement;
  private stripEl: HTMLElement;
  private itemsEl: HTMLElement;
  private buttonEl: HTMLElement;
  /** What the button adds to the toolbar: a divider and the button's group. */
  private toolbarEls: HTMLElement[] = [];
  private open: boolean;
  /** The file this tray last saw its view show. */
  private path: string | undefined;
  /** A drag of canvas nodes is under way, so the strip shows as somewhere to drop them. */
  private dragging = false;
  /** The items last drawn, to tell when they've changed (an undo, or the file reloading). */
  private drawn: TrayItem[] | null = null;
  private drawnPanels: PanelRecord[] | null = null;
  /** How many things the tray held when last drawn, to close it when the last one leaves. */
  private held = 0;
  private cleanups: Array<() => void> = [];
  private endDrag: (() => void) | null = null;
  /**
   * Where the strip is, measured once per drag. It doesn't move while something is dragged, and measuring it on
   * every move, just after the dragged thing has moved, would lay out the whole pane each time.
   */
  private stripRect: DOMRect | null = null;
  /** The timer that takes dropped nodes once core has finished its drag. */
  private pendingTake = 0;
  /** Which holder the last carried thing was let go over, for the one that takes it next. */
  private dropHolder: Holder | null = null;
  /** What each held item looks like, found once: a redraw for any change would otherwise look every card up again. Lasts as long as the item. */
  private looks = new WeakMap<TrayItem, { icon: string; color: string } | null>();

  constructor(
    private plugin: CanvasPlusPlugin,
    private view: CanvasViewLike,
    private panels: CanvasPanels,
    private dock: PanelDock,
    menuEl: HTMLElement | null,
    private onChange: () => void,
  ) {
    const canvas = view.canvas!;
    const kept = viewState.get(view);
    // A view that has gone on to show another canvas starts with the tray closed.
    this.path = view.file?.path;
    this.open = !!kept && kept.open && kept.path === this.path;
    // Made in the canvas's own window, which may be a popout. Above the bottom toolbar, or without one, floating
    // where it would be with the button beside it.
    this.el = (menuEl ?? view.contentEl).createDiv({ cls: 'ffc-tray' });
    let group: HTMLElement;
    if (menuEl) {
      // After the drawing tools (the last group of tools), before the pen colours.
      const tools = menuEl.querySelectorAll<HTMLElement>(':scope > .ffc-menu-tools');
      const divider = menuEl.createDiv({ cls: 'canvas-card-menu-divider' });
      group = menuEl.createDiv({ cls: 'ffc-menu-tools ffc-tray-toggle' });
      tools[tools.length - 1]?.after(divider, group);
      this.toolbarEls = [divider, group];
    } else {
      this.el.addClass('mod-floating');
      group = this.el.createDiv({ cls: 'canvas-control-group ffc-tray-toggle' });
    }
    this.buttonEl = group.createDiv({
      cls: 'canvas-control-item',
      attr: { 'aria-label': 'Tray', 'data-tooltip-position': 'top' },
    });
    setIcon(this.buttonEl, 'inbox');
    this.buttonEl.addEventListener('click', () => this.setOpen(!this.open));
    this.stripEl = this.el.createDiv({ cls: 'ffc-tray-strip' });
    this.itemsEl = this.stripEl.createDiv({ cls: 'ffc-tray-items' });
    // The same icon as the panel dock's drop zone, so it is plain they do the same thing.
    const hint = this.stripEl.createDiv({ cls: 'ffc-tray-hint' });
    setIcon(hint.createSpan({ cls: 'ffc-tray-hint-icon' }), 'arrow-down-to-line');
    hint.createSpan({ text: 'Drop zone' });
    shieldFromCanvas(this.el);
    for (const el of this.toolbarEls) shieldFromCanvas(el);

    // After the controller's own listeners, so a press an armed tool has taken is left alone.
    const press = (e: PointerEvent): void => this.onPress(canvas, e);
    canvas.wrapperEl.addEventListener('pointerdown', press, true);
    this.cleanups.push(() => canvas.wrapperEl.removeEventListener('pointerdown', press, true));
    // Undo and redo change what the tray holds, and redraw the canvas when they do.
    this.cleanups.push(afterCanvasFrame(canvas, () => this.sync()));

    // A view reused for another canvas (opened in the same tab) closes the tray, and a file not yet loaded isn't one.
    const fileRef = plugin.app.workspace.on('file-open', () => {
      const path = view.file?.path;
      if (path && this.path && path !== this.path) this.setOpen(false);
      if (path) this.path = path;
    });
    this.cleanups.push(() => plugin.app.workspace.offref(fileRef));

    panels.addDropTarget('tray', this, () => this.sync());
    this.sync();
    this.layout();
  }

  dragOver(e: PointerEvent): boolean {
    if (!this.dragging) this.setDragging(true);
    const over = this.hits(e);
    if (over !== this.stripEl.hasClass('is-target')) this.stripEl.toggleClass('is-target', over);
    return over;
  }

  drop(e: PointerEvent | null): boolean {
    const over = e !== null && this.hits(e);
    this.stripEl.removeClass('is-target');
    this.setDragging(false);
    // Stays open to show where the panel went.
    if (over && !this.open) this.setOpen(true);
    return over;
  }

  /** A comment pin is carried: show both drop zones and light the one it is over. Returns whether it is over one. */
  carryOver(e: PointerEvent): boolean {
    const tray = this.dragOver(e);
    const dock = this.dock.dragOver(e);
    return tray || dock;
  }

  /** The pin was let go at `e`, or cancelled (null). Returns whether it is over a drop zone, which `takeComment` then holds it in. */
  carryDrop(e: PointerEvent | null): boolean {
    const tray = this.drop(e);
    const dock = this.dock.drop(e);
    this.dropHolder = tray ? 'tray' : dock ? 'dock' : null;
    return this.dropHolder !== null;
  }

  destroy(): void {
    this.endDrag?.();
    window.clearTimeout(this.pendingTake);
    this.el.remove();
    for (const el of this.toolbarEls) el.remove();
    for (const fn of this.cleanups) fn();
    this.cleanups = [];
  }

  /** Redraw the cards if what the tray holds has changed. */
  sync(): void {
    const canvas = this.view.canvas;
    if (!canvas) return;
    const items = readTray(canvas);
    const panels = this.panels.held('tray');
    if (items === this.drawn && panels === this.drawnPanels) return;
    this.drawn = items;
    this.drawnPanels = panels;
    // New cards can change the strip's width.
    this.stripRect = null;
    this.itemsEl.empty();
    this.dock.heldEl.empty();
    const { tray: here, dock: there } = splitByHolder(items);
    for (const item of here) this.drawCard(canvas, item);
    for (const record of panels) this.drawPanelCard(record);
    for (const item of there) this.drawDockCard(canvas, item);
    this.dock.setHeldItems(there.length);
    const count = here.length + panels.length;
    this.el.toggleClass('is-empty', count === 0);
    // Like the panel dock, it goes when the last thing is taken out; opened again, empty, it stays until closed.
    const emptied = this.held > 0 && count === 0;
    this.held = count;
    if (emptied && this.open && !this.dragging) this.setOpen(false);
  }

  private setOpen(open: boolean): void {
    this.open = open;
    viewState.set(this.view, { open, path: this.path });
    this.layout();
  }

  private layout(): void {
    this.stripRect = null;
    this.el.toggleClass('is-shown', this.open || this.dragging);
    // Dashed while anything is dragged, open or not: it is where to drop.
    this.el.toggleClass('is-dragging', this.dragging);

    this.buttonEl.toggleClass('is-active', this.open);
  }

  private setDragging(dragging: boolean): void {
    this.dragging = dragging;
    this.layout();
  }

  /** Both drop zones, for a carried node or pin: the strip and the dock. */
  private showZones(on: boolean): void {
    this.setDragging(on);
    this.dock.setDragging(on);
    if (!on) this.dock.setTarget(false);
  }

  /** Which drop zone a pointer is over, if either. */
  private zoneAt(e: PointerEvent): Holder | null {
    if (this.hits(e)) return 'tray';
    return this.dock.hits(e) ? 'dock' : null;
  }

  /** Whether a pointer is over the strip. */
  private hits(e: PointerEvent): boolean {
    if (!this.el.hasClass('is-shown')) return false;
    const r = this.stripRect ??= this.stripEl.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  }

  /**
   * Hold core's edge scrolling while a dragging pointer is over the strip, which sits near the canvas's edge: a
   * drag held there would otherwise scroll the canvas under it.
   */
  private watchOver(e: PointerEvent, canvas: CanvasLike, onOver?: (zone: Holder | null) => void): OverWatch {
    let unhold: (() => void) | null = null;
    let zone: Holder | null = null;
    const set = (next: Holder | null): void => {
      if (next === zone) return;
      zone = next;
      if ((next !== null) !== (unhold !== null)) {
        if (next !== null) unhold = holdEdgePan(canvas);
        else {
          unhold?.();
          unhold = null;
        }
      }
      onOver?.(next);
    };
    set(this.zoneAt(e));
    return { update: (move) => set(this.zoneAt(move)), release: () => set(null) };
  }

  /** A press on the canvas: if it turns into a drag of nodes, show the strip, and take them if they're dropped on it. */
  private onPress(canvas: CanvasLike, down: PointerEvent): void {
    if (down.button !== 0 || down.defaultPrevented || isReadonly(canvas)) return;
    if (this.view.contentEl.hasClass(PRESENTING_CLASS)) return;
    // A drag from the toolbar (a tray card, the note button) is core's own drag of a stand-in, not of nodes.
    if (isElement(down.target) && down.target.closest(CANVAS_UI)) return;
    this.endDrag?.();
    let dragged: CanvasNodeLike[] | null = null;
    let zone: Holder | null = null;
    let watch: OverWatch | null = null;
    const finish = (): void => {
      stop();
      watch?.release();
      this.endDrag = null;
    };
    const stop = trackPointer(this.view.containerEl.doc, down.pointerId, {
      move: (e) => {
        if (!dragged) {
          if (Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) < CLICK_SLOP_PX) return;
          const nodes = draggedNodes(canvas);
          if (nodes.length === 0) return;
          dragged = nodes;
          this.showZones(true);
          watch = this.watchOver(e, canvas, (z) => {
            zone = z;
            this.stripEl.toggleClass('is-target', z === 'tray');
            this.dock.setTarget(z === 'dock');
          });
        }
        watch?.update(e);
      },
      up: (e) => {
        // Core's alt (Ctrl on Windows and Linux) drag leaves the nodes and drops copies: those stay on the canvas.
        const copying = Platform.isMacOS ? e.altKey : e.ctrlKey;
        const holder = zone;
        const take = dragged && holder && !copying ? dragged : null;
        finish();
        if (!dragged) return;
        if (!take || !holder) {
          this.showZones(false);
          return;
        }
        // Once core has finished its drag, and with the strip still there so the nodes don't flash into view.
        this.pendingTake = window.setTimeout(() => {
          this.take(canvas, take, holder);
          this.showZones(false);
        }, 0);
      },
      cancel: () => {
        finish();
        if (dragged) this.showZones(false);
      },
    });
    this.endDrag = () => {
      finish();
      if (dragged) this.showZones(false);
    };
  }

  /** Take the nodes off the canvas into the tray, as one undo step with the drag that brought them. */
  private take(canvas: CanvasLike, dragged: CanvasNodeLike[], holder: Holder): void {
    const nodes = dragged.filter((n) => n.id && canvas.nodes?.get(n.id) === n);
    if (nodes.length === 0) return;
    const items = trayItemsFrom(this.plugin, canvas, nodes).map((item) => (holder === 'tray' ? item : { ...item, holder }));
    // Only what the items hold leaves the canvas: a node they couldn't keep stays where it is.
    const kept = new Set(items.flatMap((item) => item.nodes.map((n) => n.id)));
    canvas.deselectAll?.();
    batch(canvas, () => {
      writeTray(canvas, [...readTray(canvas), ...items]);
      for (const node of nodes) if (kept.has(node.id)) removeNode(canvas, node);
    });
    // Stays open to show where they went.
    if (holder === 'tray' && !this.open) this.setOpen(true);
    this.sync();
    this.onChange();
  }

  /** Take a comment pin off the canvas into the tray, as one undo step. */
  takeComment(comment: CanvasComment): void {
    const canvas = this.view.canvas;
    if (!canvas) return;
    const holder = this.dropHolder ?? 'tray';
    this.dropHolder = null;
    batch(canvas, () => {
      writeTray(canvas, [...readTray(canvas), commentItem(comment, holder)]);
      writeComments(canvas, readComments(canvas).filter((c) => c.id !== comment.id));
    });
    if (holder === 'tray' && !this.open) this.setOpen(true);
    this.sync();
    this.onChange();
  }

  /** Put a held comment pin back on the canvas, with its tail where its outline was dropped, attached to the node under it. */
  private restoreComment(canvas: CanvasLike, item: TrayItem, comment: CanvasComment, pos: { x: number; y: number }): void {
    if (!readTray(canvas).includes(item)) return;
    const at = { x: pos.x, y: pos.y + PIN_BOX.height };
    batch(canvas, () => {
      writeComments(canvas, [...readComments(canvas).filter((c) => c.id !== comment.id), movedTo(canvas, comment, at)]);
      writeTray(canvas, readTray(canvas).filter((i) => i !== item));
    });
    this.sync();
    this.onChange();
  }

  /** Put an item back on the canvas where its card was dropped, selected. */
  private restore(canvas: CanvasLike, item: TrayItem, at: { x: number; y: number }): void {
    if (!readTray(canvas).includes(item)) return;
    const nodes = batch(canvas, () => {
      const restored = restoreItem(canvas, item, at);
      writeTray(canvas, readTray(canvas).filter((i) => i !== item));
      return restored;
    });
    // A single item selects its own node (the group, for a group); several together select them all.
    const select = item.bundle ? nodes : nodes.filter((n) => n.id === item.id);
    if (select.length > 0) {
      canvas.deselectAll?.();
      canvas.selectOnly?.(select[0]);
      for (const n of select.slice(1)) canvas.toggleSelect?.(n);
    }
    this.sync();
    this.onChange();
  }

  /** The colour an item's card takes: several things together show one only if they all share it. */
  private colorOf(item: TrayItem): string | undefined {
    const color = item.bundle && item.nodes.some((n) => n.color !== item.nodes[0]?.color) ? undefined : item.nodes[0]?.color;
    return typeof color === 'string' && color ? PRESET_VARS[color] ?? color : undefined;
  }

  private iconOf(item: TrayItem): string {
    return item.kind === 'comment' ? 'message-circle' : LAYER_ICONS[item.kind] ?? 'box';
  }

  /**
   * What an object looks like as a pin, for its card: a typed note's icon and colour, an issue's icon, a diagram's, a widget's
   * view's, and so on. Null for what can't be pinned (strokes, anchors), a comment, and several things taken together, which
   * keep the icon for their kind.
   */
  private lookOf(item: TrayItem): { icon: string; color: string } | null {
    const cached = this.looks.get(item);
    if (cached !== undefined) return cached;
    const look = this.lookUp(item);
    this.looks.set(item, look);
    return look;
  }

  private lookUp(item: TrayItem): { icon: string; color: string } | null {
    const data = item.nodes[0];
    if (!data || item.comment || item.bundle) return null;
    const path = typeof data.file === 'string' ? data.file : undefined;
    const file = path ? this.plugin.app.vault.getFileByPath(path) : null;
    // Just enough of a node for the pin's lookup, which reads its file and its data.
    const stand: CanvasNodeLike = { file: file ?? undefined, getData: () => data, unknownData: data };
    if (readInk(stand, data) || isAnchor(stand, data)) return null;
    return pinLook(this.plugin, stand, data);
  }

  private drawCard(canvas: CanvasLike, item: TrayItem): void {
    const inside = item.nodes.length - 1;
    const card = this.itemsEl.createDiv({
      cls: 'ffc-tray-card',
      attr: { 'aria-label': `${item.label}\nDrag onto the canvas to put it back`, 'data-tooltip-position': 'bottom' },
    });
    const look = this.lookOf(item);
    const color = look?.color || this.colorOf(item);
    if (color) {
      card.addClass('has-color');
      card.setCssProps({ '--ffc-tray-color': color });
    }
    setIcon(card.createSpan({ cls: 'ffc-tray-card-icon' }), look?.icon ?? this.iconOf(item));
    card.createSpan({ cls: 'ffc-tray-card-label', text: item.label });
    if (inside > 0) card.createSpan({ cls: 'ffc-tray-card-count', text: `+${inside}` });
    card.addEventListener('pointerdown', (e) => this.dragOut(canvas, item, e));
  }

  /** The same item held in the panel dock: a button with its icon, and its name in the tooltip. */
  private drawDockCard(canvas: CanvasLike, item: TrayItem): void {
    const inside = item.nodes.length - 1;
    const label = inside > 0 ? `${item.label} (+${inside})` : item.label;
    const button = this.dock.heldEl.createDiv({
      cls: 'canvas-control-item ffc-panel-dock-item',
      attr: { 'aria-label': `${label}\nDrag onto the canvas to put it back`, 'data-tooltip-position': 'left' },
    });
    const look = this.lookOf(item);
    const color = look?.color || this.colorOf(item);
    if (color) {
      button.addClass('has-color');
      button.setCssProps({ '--ffc-tray-color': color });
    }
    setIcon(button, look?.icon ?? this.iconOf(item));
    button.addEventListener('pointerdown', (e) => this.dragOut(canvas, item, e));
  }

  /** Hold an item in the other holder, as one undo step. */
  private moveItem(canvas: CanvasLike, item: TrayItem, holder: Holder): void {
    if (!readTray(canvas).includes(item)) return;
    batch(canvas, () => {
      // The tray is the default holder, so an item held there carries no holder at all.
      writeTray(canvas, readTray(canvas).map((i) => {
        if (i !== item) return i;
        const moved: TrayItem = { ...i, holder };
        if (holder === 'tray') delete moved.holder;
        return moved;
      }));
    });
    if (holder === 'tray' && !this.open) this.setOpen(true);
    this.sync();
    this.onChange();
  }

  /**
   * Core's own drag from a menu button: an outline of the item, snapped, put back where it's dropped on the canvas. Let go
   * over a drop zone instead, and it is held there: over the other holder's, it moves.
   */
  private dragOut(canvas: CanvasLike, item: TrayItem, e: PointerEvent): void {
    if (e.button !== 0 || isReadonly(canvas) || !canvas.dragTempNode) return;
    const box = item.comment ? PIN_BOX : itemBox(item);
    const home: Holder = holderOf(item.holder);
    // The drop zones may have moved since they were last measured (the pen colours lift the strip).
    this.stripRect = null;
    const watch = this.watchOver(e, canvas, (z) => {
      this.stripEl.toggleClass('is-target', z === 'tray');
      this.dock.setTarget(z === 'dock');
    });
    let begun = false;
    let zone: Holder | null = null;
    const stop = trackPointer(this.view.containerEl.doc, e.pointerId, {
      move: (m) => {
        if (!begun) {
          if (Math.hypot(m.clientX - e.clientX, m.clientY - e.clientY) < CLICK_SLOP_PX) return;
          begun = true;
          this.showZones(true);
        }
        watch.update(m);
      },
      up: (u) => {
        stop();
        zone = this.zoneAt(u);
        watch.release();
        if (begun) this.showZones(false);
      },
      cancel: () => {
        stop();
        watch.release();
        if (begun) this.showZones(false);
      },
    });
    canvas.dragTempNode(e, { width: box.width, height: box.height }, (pos) => {
      if (zone) {
        if (zone !== home) this.moveItem(canvas, item, zone);
        return;
      }
      if (item.comment) this.restoreComment(canvas, item, item.comment, pos);
      else this.restore(canvas, item, pos);
    });
  }

  private drawPanelCard(record: PanelRecord): void {
    const label = describePanel(record);
    const card = this.itemsEl.createDiv({
      cls: 'ffc-tray-card',
      attr: { 'aria-label': `${label}\nDrag onto the canvas to open the panel again`, 'data-tooltip-position': 'bottom' },
    });
    setIcon(card.createSpan({ cls: 'ffc-tray-card-icon' }), 'app-window');
    card.createSpan({ cls: 'ffc-tray-card-label', text: label });
    card.addEventListener('pointerdown', (e) => this.dragPanelOut(record, e));
  }

  private dragPanelOut(record: PanelRecord, e: PointerEvent): void {
    this.stripRect = null;
    this.panels.dragHeldOut(record, e);
  }
}

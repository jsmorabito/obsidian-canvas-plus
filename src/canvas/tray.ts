import { Platform, setIcon } from 'obsidian';
import type { CanvasPlusPlugin } from '../main.ts';
import {
  CanvasLike, CanvasNodeLike, CanvasViewLike, afterCanvasFrame, batch, draggedNodes, holdEdgePan, isElement, isReadonly,
  removeNode, shieldFromCanvas,
} from './adapter.ts';
import { CLICK_SLOP_PX } from './constants.ts';
import { loadOpen, saveOpen } from './floating-panel.ts';
import { LAYER_ICONS } from './layers-tree.ts';
import { trackPointer } from './pointer-session.ts';
import { CanvasPanels, HEADER_GRAB_PX, PanelDropTarget, describePanel } from './canvas-panels.ts';
import { PanelRecord } from './panel-store.ts';
import { PRESENTING_CLASS } from './presentation.ts';
import { TrayItem, itemBox, readTray, restoreItem, trayItemsFrom, writeTray } from './tray-items.ts';

const OPEN_KEY = 'ffc-canvas-tray-open';
/** Core's menus and controls, and the toolbar the tray is in: a press there never starts a drag of nodes. */
const CANVAS_UI = '.canvas-card-menu, .canvas-controls, .canvas-menu-container';

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
  /** A drag of canvas nodes is under way, so the strip shows as somewhere to drop them. */
  private dragging = false;
  /** The items last drawn, to tell when they've changed (an undo, or the file reloading). */
  private drawn: TrayItem[] | null = null;
  private drawnPanels: PanelRecord[] | null = null;
  private cleanups: Array<() => void> = [];
  private endDrag: (() => void) | null = null;
  /**
   * Where the strip is, measured once per drag. It doesn't move while something is dragged, and measuring it on
   * every move, just after the dragged thing has moved, would lay out the whole pane each time.
   */
  private stripRect: DOMRect | null = null;
  /** The timer that takes dropped nodes once core has finished its drag. */
  private pendingTake = 0;

  constructor(
    private plugin: CanvasPlusPlugin,
    private view: CanvasViewLike,
    private panels: CanvasPanels,
    menuEl: HTMLElement | null,
    private onChange: () => void,
  ) {
    const canvas = view.canvas!;
    this.open = loadOpen(plugin.app, OPEN_KEY);
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
    this.stripEl.createDiv({ cls: 'ffc-tray-hint', text: 'Drag anything here to hold it for later' });
    shieldFromCanvas(this.el);
    for (const el of this.toolbarEls) shieldFromCanvas(el);

    // After the controller's own listeners, so a press an armed tool has taken is left alone.
    const press = (e: PointerEvent): void => this.onPress(canvas, e);
    canvas.wrapperEl.addEventListener('pointerdown', press, true);
    this.cleanups.push(() => canvas.wrapperEl.removeEventListener('pointerdown', press, true));
    // Undo and redo change what the tray holds, and redraw the canvas when they do.
    this.cleanups.push(afterCanvasFrame(canvas, () => this.sync()));

    panels.setTray(this, () => this.sync());
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
    const panels = this.panels.held();
    if (items === this.drawn && panels === this.drawnPanels) return;
    this.drawn = items;
    this.drawnPanels = panels;
    // New cards can change the strip's width.
    this.stripRect = null;
    this.itemsEl.empty();
    for (const item of items) this.drawCard(canvas, item);
    for (const record of panels) this.drawPanelCard(record);
    const count = items.length + panels.length;
    this.el.toggleClass('is-empty', count === 0);
  }

  private setOpen(open: boolean): void {
    this.open = open;
    saveOpen(this.plugin.app, OPEN_KEY, open);
    this.layout();
  }

  private layout(): void {
    this.stripRect = null;
    this.el.toggleClass('is-shown', this.open || this.dragging);
    // Open, the tray is already where to drop: no drop zone over it.
    const dropZone = this.dragging && !this.open;
    this.el.toggleClass('is-dragging', dropZone);

    this.buttonEl.toggleClass('is-active', this.open);
  }

  private setDragging(dragging: boolean): void {
    this.dragging = dragging;
    this.layout();
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
  private watchOver(e: PointerEvent, canvas: CanvasLike, onOver?: (over: boolean) => void): OverWatch {
    let unhold: (() => void) | null = null;
    const set = (over: boolean): void => {
      if (over === (unhold !== null)) return;
      if (over) unhold = holdEdgePan(canvas);
      else {
        unhold?.();
        unhold = null;
      }
      onOver?.(over);
    };
    set(this.hits(e));
    return { update: (move) => set(this.hits(move)), release: () => set(false) };
  }

  /** A press on the canvas: if it turns into a drag of nodes, show the strip, and take them if they're dropped on it. */
  private onPress(canvas: CanvasLike, down: PointerEvent): void {
    if (down.button !== 0 || down.defaultPrevented || isReadonly(canvas)) return;
    if (this.view.contentEl.hasClass(PRESENTING_CLASS)) return;
    // A drag from the toolbar (a tray card, the note button) is core's own drag of a stand-in, not of nodes.
    if (isElement(down.target) && down.target.closest(CANVAS_UI)) return;
    this.endDrag?.();
    let dragged: CanvasNodeLike[] | null = null;
    let over = false;
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
          this.setDragging(true);
          watch = this.watchOver(e, canvas, (o) => {
            over = o;
            this.stripEl.toggleClass('is-target', o);
          });
        }
        watch?.update(e);
      },
      up: (e) => {
        // Core's alt (Ctrl on Windows and Linux) drag leaves the nodes and drops copies: those stay on the canvas.
        const copying = Platform.isMacOS ? e.altKey : e.ctrlKey;
        const take = dragged && over && !copying ? dragged : null;
        finish();
        if (!dragged) return;
        if (!take) {
          this.setDragging(false);
          return;
        }
        // Once core has finished its drag, and with the strip still there so the nodes don't flash into view.
        this.pendingTake = window.setTimeout(() => {
          this.take(canvas, take);
          this.setDragging(false);
        }, 0);
      },
      cancel: () => {
        finish();
        if (dragged) this.setDragging(false);
      },
    });
    this.endDrag = () => {
      finish();
      if (dragged) this.setDragging(false);
    };
  }

  /** Take the nodes off the canvas into the tray, as one undo step with the drag that brought them. */
  private take(canvas: CanvasLike, dragged: CanvasNodeLike[]): void {
    const nodes = dragged.filter((n) => n.id && canvas.nodes?.get(n.id) === n);
    if (nodes.length === 0) return;
    const items = trayItemsFrom(this.plugin, canvas, nodes);
    // Only what the items hold leaves the canvas: a node they couldn't keep stays where it is.
    const kept = new Set(items.flatMap((item) => item.nodes.map((n) => n.id)));
    canvas.deselectAll?.();
    batch(canvas, () => {
      writeTray(canvas, [...readTray(canvas), ...items]);
      for (const node of nodes) if (kept.has(node.id)) removeNode(canvas, node);
    });
    // Stays open to show where they went.
    if (!this.open) this.setOpen(true);
    this.sync();
    this.onChange();
  }

  /** Put an item back on the canvas where its card was dropped, selected. */
  private restore(canvas: CanvasLike, item: TrayItem, at: { x: number; y: number }): void {
    if (!readTray(canvas).includes(item)) return;
    const node = batch(canvas, () => {
      const restored = restoreItem(canvas, item, at);
      writeTray(canvas, readTray(canvas).filter((i) => i !== item));
      return restored;
    });
    if (node) {
      canvas.deselectAll?.();
      canvas.selectOnly?.(node);
    }
    this.sync();
    this.onChange();
  }

  private drawCard(canvas: CanvasLike, item: TrayItem): void {
    const inside = item.nodes.length - 1;
    const card = this.itemsEl.createDiv({
      cls: 'ffc-tray-card',
      attr: { 'aria-label': `${item.label}\nDrag onto the canvas to put it back`, 'data-tooltip-position': 'bottom' },
    });
    const color = item.nodes[0]?.color;
    if (typeof color === 'string' && color) {
      card.addClass('has-color');
      card.setCssProps({ '--ffc-tray-color': /^[1-6]$/.test(color) ? `rgb(var(--canvas-color-${color}))` : color });
    }
    setIcon(card.createSpan({ cls: 'ffc-tray-card-icon' }), LAYER_ICONS[item.kind] ?? 'box');
    card.createSpan({ cls: 'ffc-tray-card-label', text: item.label });
    if (inside > 0) card.createSpan({ cls: 'ffc-tray-card-count', text: `+${inside}` });
    card.addEventListener('pointerdown', (e) => this.dragOut(canvas, item, e));
  }

  /** Core's own drag from a menu button: an outline of the item, snapped, put back where it's dropped on the canvas. */
  private dragOut(canvas: CanvasLike, item: TrayItem, e: PointerEvent): void {
    if (e.button !== 0 || isReadonly(canvas) || !canvas.dragTempNode) return;
    const box = itemBox(item);
    // The strip may have moved since it was last measured (the pen colours lift it).
    this.stripRect = null;
    const watch = this.watchOver(e, canvas);
    // Let go over the strip, it stays in the tray, though the canvas is under it too.
    let onStrip = false;
    const stop = trackPointer(this.view.containerEl.doc, e.pointerId, {
      move: (m) => watch.update(m),
      up: (u) => {
        stop();
        onStrip = this.hits(u);
        watch.release();
      },
      cancel: () => {
        stop();
        watch.release();
      },
    });
    canvas.dragTempNode(e, { width: box.width, height: box.height }, (pos) => {
      if (!onStrip) this.restore(canvas, item, pos);
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

  /** An outline of the panel follows the pointer; let go off the strip, over the canvas, and the panel opens there. */
  private dragPanelOut(record: PanelRecord, e: PointerEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    this.stripRect = null;
    const doc = this.view.containerEl.doc;
    const ghost = doc.body.createDiv({ cls: 'ffc-canvas-ghost' });
    let moved = false;
    // Measured once, like the strip: the pane doesn't move while the outline does.
    let pane: DOMRect | null = null;
    const onCanvas = (m: PointerEvent): boolean => {
      const r = pane ??= this.view.contentEl.getBoundingClientRect();
      return !this.hits(m) && m.clientX >= r.left && m.clientX <= r.right && m.clientY >= r.top && m.clientY <= r.bottom;
    };
    const stop = trackPointer(doc, e.pointerId, {
      move: (m) => {
        if (!moved && Math.hypot(m.clientX - e.clientX, m.clientY - e.clientY) < CLICK_SLOP_PX) return;
        moved = true;
        ghost.toggleClass('is-visible', onCanvas(m));
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
        if (moved && onCanvas(u)) this.panels.release(record.id, u.clientX, u.clientY);
      },
      cancel: () => {
        stop();
        ghost.remove();
      },
    });
  }
}

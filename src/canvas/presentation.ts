import { Menu, Notice, Scope, TFile, setIcon, setTooltip } from 'obsidian';
import type { CanvasPlusPlugin } from '../main.ts';
import {
  Box, CanvasLike, CanvasNodeLike, CanvasViewLike, finishViewportMove, glideTo, isReadonly, nodeBox, savedReadonly, selectedNodes,
  setReadonly, zoomToBox,
} from './adapter.ts';
import { anchorLabel, isAnchor, isAnchorFrame } from './anchor.ts';
import { PRESENT_ICON } from './icons.ts';
import { smallestContaining } from './layers-tree.ts';
import { PresentationBar } from './presentation-bar.ts';
import { byStopOrder } from './stop-order.ts';

/** On the view's content while presenting: hides the panels and menus (see styles.css). */
const PRESENTING_CLASS = 'ffc-presenting';

interface Stop {
  node: CanvasNodeLike;
  box: Box;
}

/** The stops of a presentation: the anchors, in presentation order (as set in the layers panel, else reading order). */
function findStops(canvas: CanvasLike): Stop[] {
  const stops: Stop[] = [];
  for (const node of canvas.nodes?.values() ?? []) {
    const box = isAnchor(node) ? nodeBox(node) : null;
    if (box) stops.push({ node, box });
  }
  return byStopOrder(stops);
}

/** What a stop shows: a framed anchor's own box, or else the smallest group around it (the one the layers panel lists it in). */
function frameOf(canvas: CanvasLike, stop: Stop): Box | null {
  if (isAnchorFrame(stop.node)) return stop.box;
  const groups: Array<{ box: Box }> = [];
  for (const node of canvas.nodes?.values() ?? []) {
    const box = node.getData?.().type === 'group' ? nodeBox(node) : null;
    if (box) groups.push({ box });
  }
  return smallestContaining(groups, stop.box)?.box ?? null;
}

/**
 * Presenting a canvas: step through its anchors like slides. A button in the view header switches it on
 * and off, as the reading view button does for a note. While presenting, the canvas is in core's read-only
 * mode, and the view's key scope is swapped for one that steps through the stops, so the keys only act
 * while this canvas is the active view.
 */
export class Presenter {
  private actionEl: HTMLElement;
  private scope: Scope;
  /** The view's own scope, put back when the presentation ends. */
  private viewScope: Scope | null = null;
  /** The stop on screen, and where it was in the order, so stepping on still works if its anchor is deleted. */
  private current: { id?: string; index: number } | null = null;
  private active = false;
  /** Whether the canvas was already read-only (core's lock) before presenting, to leave it that way after. */
  private wasReadonly = false;
  /** The file being presented. A view that goes on to show another file ends the presentation. */
  private file: TFile | null = null;
  private bar: PresentationBar | null = null;

  constructor(plugin: CanvasPlusPlugin, private view: CanvasViewLike, private onStart: () => void) {
    this.actionEl = view.addAction(PRESENT_ICON, 'Present', () => this.toggle());
    this.scope = new Scope(plugin.app.scope);
    const next = (): false => { this.next(); return false; };
    const previous = (): false => { this.previous(); return false; };
    for (const key of ['ArrowRight', 'ArrowDown', ' ', 'PageDown']) this.scope.register([], key, next);
    for (const key of ['ArrowLeft', 'ArrowUp', 'PageUp']) this.scope.register([], key, previous);
    this.scope.register(['Shift'], ' ', previous);
    // G for "go to": the menu of stops, opened from the count in the bar.
    this.scope.register([], 'g', () => { this.openStops(); return false; });
    this.scope.register([], 'Escape', () => { this.stop(); return false; });
    this.render();
  }

  get presenting(): boolean {
    return this.active;
  }

  toggle(): void {
    if (this.active) this.stop();
    else this.start();
  }

  /** Start at the selected anchor, or else the first. */
  start(): void {
    const canvas = this.view.canvas;
    if (!canvas || this.active) return;
    const stops = findStops(canvas);
    if (stops.length === 0) {
      new Notice('Add an anchor to present this canvas.');
      return;
    }
    const selected = selectedNodes(canvas).find((n) => isAnchor(n));
    const first = Math.max(0, stops.findIndex((s) => s.node === selected));
    this.active = true;
    this.file = this.view.file ?? null;
    this.onStart();
    canvas.deselectAll?.();
    this.wasReadonly = isReadonly(canvas);
    setReadonly(canvas, true);
    this.viewScope = this.view.scope;
    this.view.scope = this.scope;
    // Before showing the first stop: the hidden panels then leave the whole canvas to fit it in.
    this.view.contentEl.addClass(PRESENTING_CLASS);
    this.bar = new PresentationBar(this.view.contentEl, {
      onPrevious: () => this.previous(),
      onNext: () => this.next(),
      onStops: (evt) => this.openStops(evt),
    });
    this.render();
    this.show(canvas, stops, first);
  }

  /** End the presentation, leaving the view on the stop it was showing. */
  stop(): void {
    if (!this.active) return;
    this.active = false;
    this.current = null;
    if (this.view.scope === this.scope) this.view.scope = this.viewScope;
    this.viewScope = null;
    // The lock goes back to what it was. If the view has moved on to another file, that file's own saved lock
    // (core applies it only when one is saved, so otherwise the presentation's would linger).
    const sameFile = (this.view.file ?? null) === this.file;
    const readonly = sameFile ? this.wasReadonly : savedReadonly(this.view) ?? false;
    if (this.view.canvas) setReadonly(this.view.canvas, readonly);
    this.file = null;
    this.view.contentEl.removeClass(PRESENTING_CLASS);
    this.bar?.destroy();
    this.bar = null;
    this.render();
  }

  /**
   * Keep up with the canvas between steps: the bar's count as anchors are added or deleted, and the end of the
   * presentation if the view goes on to show another file or no anchors are left.
   */
  refresh(): void {
    const canvas = this.view.canvas;
    if (!canvas || !this.active) return;
    if ((this.view.file ?? null) !== this.file) {
      this.stop();
      return;
    }
    const stops = findStops(canvas);
    if (stops.length === 0) {
      this.endEmpty();
      return;
    }
    const at = stops.findIndex((s) => s.node.id === this.current?.id);
    // The stop on screen lost its anchor: there's no number for it, but stepping still goes on from where it was.
    if (at === -1) this.bar?.update(null, stops.length, '');
    else this.bar?.update(at, stops.length, anchorLabel(stops[at].node));
  }

  next(): void {
    this.step(1);
  }

  previous(): void {
    this.step(-1);
  }

  destroy(): void {
    this.stop();
    this.actionEl.remove();
  }

  /** Stops are found again on every step, so anchors added, moved or deleted while presenting are followed. */
  private step(delta: 1 | -1): void {
    const canvas = this.view.canvas;
    if (!canvas || !this.active) return;
    const stops = findStops(canvas);
    if (stops.length === 0) {
      this.endEmpty();
      return;
    }
    this.show(canvas, stops, this.target(stops, delta));
  }

  /**
   * Every stop in a core menu, numbered, with a tick on the one on screen: choose one to go there. It opens from
   * the bar's count, as the canvas's own settings menu opens from its control, at the pointer when the count was
   * clicked and at the count when G was pressed. Arrow keys, Enter and Escape work as in any menu.
   */
  private openStops(evt?: MouseEvent): void {
    const canvas = this.view.canvas;
    const button = this.bar?.stopsEl;
    // Selecting the count again while its menu is open just closes the menu, as core's control does.
    if (!canvas || !this.active || !button || button.hasClass('has-active-menu')) return;
    const stops = findStops(canvas);
    const at = stops.findIndex((s) => s.node.id === this.current?.id);
    const menu = new Menu().setParentElement(button);
    stops.forEach((stop, i) => {
      const id = stop.node.id;
      menu.addItem((item) => item
        .setTitle(`${i + 1}. ${anchorLabel(stop.node) || 'Untitled anchor'}`)
        .setChecked(i === at)
        .onClick(() => this.goTo(id)));
    });
    if (evt) menu.showAtMouseEvent(evt);
    else {
      const rect = button.getBoundingClientRect();
      menu.showAtPosition({ x: rect.left, y: rect.top }, button.doc);
    }
  }

  /** Show the stop of the anchor `id`, found again in case the canvas changed while the menu was open. */
  private goTo(id: string | undefined): void {
    const canvas = this.view.canvas;
    if (!canvas || !this.active) return;
    const stops = findStops(canvas);
    const index = stops.findIndex((s) => s.node.id === id);
    if (index !== -1) this.show(canvas, stops, index);
  }

  private endEmpty(): void {
    this.stop();
    new Notice('There are no anchors left to present.');
  }

  /** The index of the stop `delta` away from the current one. The first and last stops are as far as it goes. */
  private target(stops: Stop[], delta: 1 | -1): number {
    const clamp = (i: number): number => Math.min(stops.length - 1, Math.max(0, i));
    const current = this.current;
    if (!current) return 0;
    const at = stops.findIndex((s) => s.node.id === current.id);
    if (at !== -1) return clamp(at + delta);
    // Its anchor is gone and the stops after it have moved up one: the next is now at its old place.
    return clamp(delta > 0 ? current.index : current.index - 1);
  }

  /**
   * Fit the stop's group in the view, or centre on an anchor outside any group at the current zoom. Either way
   * core eases the view there, as it does for Zoom to selection; with reduced motion it lands at once.
   */
  private show(canvas: CanvasLike, stops: Stop[], index: number): void {
    const stop = stops[index];
    this.current = { id: stop.node.id, index };
    this.bar?.update(index, stops.length, anchorLabel(stop.node));
    const frame = frameOf(canvas, stop);
    if (frame) zoomToBox(canvas, frame);
    else glideTo(canvas, stop.box.x + stop.box.width / 2, stop.box.y + stop.box.height / 2);
    if (this.view.containerEl.win.matchMedia('(prefers-reduced-motion: reduce)').matches) finishViewportMove(canvas);
  }

  /** The header button, like the reading view button: it says which view this is, and what selecting it does. */
  private render(): void {
    setIcon(this.actionEl, this.active ? 'pencil' : PRESENT_ICON);
    setTooltip(this.actionEl, this.active ? 'Current view: presenting\nClick to edit' : 'Current view: editing\nClick to present');
  }
}

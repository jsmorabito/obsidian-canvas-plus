import { setIcon } from 'obsidian';
import type { CanvasPlusPlugin } from '../main.ts';
import { CanvasViewLike, shieldFromCanvas } from './adapter.ts';
import { CanvasPanels, PanelDropTarget, describePanel } from './canvas-panels.ts';
import { PanelRecord } from './panel-store.ts';

/**
 * Somewhere to put a panel away for a while: a vertical section under the canvas's right-hand button groups. It shows while a
 * panel is dragged by its header, as a drop zone, and stays while it holds panels, one button each. Dragging a button back
 * onto the canvas opens its panel there again. The tray holds panels too, apart from the dock's: a panel can be dragged from one to the other. What either holds is kept with the panels, in the plugin's data.
 */
export class PanelDock implements PanelDropTarget {
  private el: HTMLElement;
  private itemsEl: HTMLElement;
  /** Where the tray draws what it holds here: nodes and comments, which the tray owns. */
  readonly heldEl: HTMLElement;
  /** How many of those there are. */
  private extra = 0;
  private dragging = false;
  private drawn: PanelRecord[] | null = null;
  /** Where the dock is, measured once per drag: it doesn't move while a panel does, and a measure on every move would lay out the pane. */
  private rect: DOMRect | null = null;

  constructor(private plugin: CanvasPlusPlugin, private view: CanvasViewLike, private panels: CanvasPanels) {
    // Core's own control groups, so it looks like the buttons above it; it goes last in their column.
    const controls = view.canvas?.canvasControlsEl;
    // Without the controls to join it has no place on the canvas, so it is never attached: the tray can still call it, to no effect.
    this.el = controls ? controls.createDiv({ cls: 'canvas-control-group ffc-panel-dock' }) : createDiv({ cls: 'canvas-control-group ffc-panel-dock' });
    this.itemsEl = this.el.createDiv({ cls: 'ffc-panel-dock-items' });
    this.heldEl = this.el.createDiv({ cls: 'ffc-panel-dock-items' });
    const hint = this.el.createDiv({ cls: 'ffc-panel-dock-hint', attr: { 'aria-label': 'Drop zone', 'data-tooltip-position': 'left' } });
    setIcon(hint, 'arrow-down-to-line');
    shieldFromCanvas(this.el);
    if (controls) panels.addDropTarget('dock', this, () => this.sync());
    this.sync();
  }

  dragOver(e: PointerEvent): boolean {
    if (!this.dragging) this.setDragging(true);
    const over = this.hits(e);
    if (over !== this.el.hasClass('is-target')) this.el.toggleClass('is-target', over);
    return over;
  }

  drop(e: PointerEvent | null): boolean {
    const over = e !== null && this.hits(e);
    this.el.removeClass('is-target');
    this.setDragging(false);
    return over;
  }

  destroy(): void {
    this.el.remove();
  }

  /** Redraw the buttons if the panels held have changed. */
  sync(): void {
    const held = this.panels.held('dock');
    if (held === this.drawn) return;
    this.drawn = held;
    this.rect = null;
    this.itemsEl.empty();
    for (const record of held) this.drawButton(record);
    this.layout();
  }

  /** The tray has drawn this many of its own things here. */
  setHeldItems(count: number): void {
    if (count === this.extra) return;
    this.extra = count;
    this.layout();
  }

  /** Light the drop zone while something carried is over it. */
  setTarget(over: boolean): void {
    this.el.toggleClass('is-target', over);
  }

  setDragging(dragging: boolean): void {
    this.dragging = dragging;
    this.rect = null;
    this.layout();
  }

  private layout(): void {
    const held = (this.drawn?.length ?? 0) + this.extra;
    this.el.toggleClass('is-shown', this.dragging || held > 0);
    this.el.toggleClass('is-dragging', this.dragging);
    this.el.toggleClass('is-empty', held === 0);
  }

  hits(e: PointerEvent): boolean {
    if (!this.el.hasClass('is-shown')) return false;
    const r = this.rect ??= this.el.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  }

  private drawButton(record: PanelRecord): void {
    const label = describePanel(record);
    const button = this.itemsEl.createDiv({
      cls: 'canvas-control-item ffc-panel-dock-item',
      attr: { 'aria-label': `${label}\nDrag onto the canvas to open the panel again`, 'data-tooltip-position': 'left' },
    });
    setIcon(button, 'app-window');
    button.addEventListener('pointerdown', (e) => this.dragOut(record, e));
  }

  private dragOut(record: PanelRecord, e: PointerEvent): void {
    this.rect = null;
    this.panels.dragHeldOut(record, e);
  }
}

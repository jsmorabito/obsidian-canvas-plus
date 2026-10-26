/** A dot beside a node: where it goes on screen for the node's box, and what it does. */
export interface DotSpec {
  label: string;
  at: (rect: DOMRect) => { x: number; y: number };
  run: () => void;
  /** Given, the press on the dot is handed to it instead of being a click (to tell a click from a drag). */
  press?: (e: PointerEvent) => void;
}

interface Shown {
  layer: HTMLElement;
  bar: HTMLElement;
  key: string;
  /** The node they're for, and where it was when they were last placed. */
  target: Element;
  rect: DOMRect;
  dots: Array<{ el: HTMLElement; at: DotSpec['at'] }>;
}

/**
 * The dots round a picked diagram node and the toolbar over it, on the canvas rather than in the card: in screen
 * pixels, so the zoom doesn't resize them and the card can't cut them off, and kept inside the canvas. They follow
 * the node each frame it moves on screen (panning, zooming, moving the card).
 */
export class FloatingTools {
  private shown: Shown | null = null;
  private watching = 0;

  constructor(private wrapper: HTMLElement) {}

  /** The toolbar, while it is shown. */
  get bar(): HTMLElement | null {
    return this.shown?.bar ?? null;
  }

  /** Show them for `target`. Left as they are while `key` is the same, since this runs on every sweep. */
  show(target: Element, key: string, dots: DotSpec[], fillBar: (bar: HTMLElement) => void): void {
    if (this.shown?.key === key && this.shown.bar.isConnected) return;
    this.clear();
    const layer = this.wrapper.createDiv({ cls: 'ffc-mm-tools' });
    const placed = dots.map((spec) => {
      const el = layer.createEl('button', { cls: 'ffc-mm-dot', attr: { 'aria-label': spec.label, 'data-tooltip-position': 'top', type: 'button' } });
      el.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        spec.press?.(e);
      });
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!spec.press) spec.run();
      });
      return { el, at: spec.at };
    });
    const bar = this.wrapper.createDiv({ cls: 'canvas-menu ffc-mm-bar ffc-mm-toolbar' });
    bar.addEventListener('pointerdown', (e) => e.stopPropagation());
    fillBar(bar);
    this.shown = { layer, bar, key, target, rect: target.getBoundingClientRect(), dots: placed };
    this.place(this.shown);
    this.watch();
  }

  clear(): void {
    this.shown?.layer.remove();
    this.shown?.bar.remove();
    this.shown = null;
    if (this.watching) window.cancelAnimationFrame(this.watching);
    this.watching = 0;
  }

  private place(shown: Shown): void {
    const view = this.wrapper.getBoundingClientRect();
    for (const dot of shown.dots) {
      const at = dot.at(shown.rect);
      dot.el.setCssProps({ '--ffc-mm-left': `${at.x - view.left}px`, '--ffc-mm-top': `${at.y - view.top}px` });
    }
    // Above the node, clear of its dots, or below it near the top of the canvas; inside the canvas either way.
    const margin = 8;
    const gap = 28;
    const bar = shown.bar;
    const above = shown.rect.top - gap - bar.offsetHeight >= view.top + margin;
    const top = above ? shown.rect.top - gap - bar.offsetHeight : shown.rect.bottom + gap;
    const left = Math.max(view.left + margin, Math.min(shown.rect.left + shown.rect.width / 2 - bar.offsetWidth / 2, view.right - margin - bar.offsetWidth));
    bar.setCssProps({ '--ffc-mm-left': `${left - view.left}px`, '--ffc-mm-top': `${top - view.top}px` });
    bar.toggleClass('is-below', !above);
  }

  private watch(): void {
    if (this.watching) return;
    const tick = (): void => {
      this.watching = 0;
      const shown = this.shown;
      if (!shown) return;
      if (shown.target.isConnected) {
        const rect = shown.target.getBoundingClientRect();
        const moved = Math.abs(rect.left - shown.rect.left) + Math.abs(rect.top - shown.rect.top)
          + Math.abs(rect.width - shown.rect.width) + Math.abs(rect.height - shown.rect.height);
        if (moved > 0.5) {
          shown.rect = rect;
          this.place(shown);
        }
      }
      this.watching = window.requestAnimationFrame(tick);
    };
    this.watching = window.requestAnimationFrame(tick);
  }
}

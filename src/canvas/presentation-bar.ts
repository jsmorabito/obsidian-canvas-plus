import { setIcon, setTooltip } from 'obsidian';
import { shieldFromCanvas } from './adapter.ts';

export interface PresentationBarActions {
  onPrevious: () => void;
  onNext: () => void;
  /** The count was selected; the menu of stops opens from it. */
  onStops: (evt: MouseEvent) => void;
}

/**
 * Where a presentation is: previous, "3 / 8", next. The count is also a button: it opens the menu of every stop.
 * Built from core's canvas control group, laid out in a row where the card menu sits while editing, so it looks
 * like the canvas's own controls.
 */
export class PresentationBar {
  private el: HTMLElement;
  private prevEl: HTMLElement;
  private countEl: HTMLElement;
  private nextEl: HTMLElement;
  constructor(parent: HTMLElement, actions: PresentationBarActions) {
    this.el = parent.createDiv({ cls: 'canvas-control-group mod-raised ffc-presentation-bar' });
    this.prevEl = this.button('chevron-left', 'Previous stop', actions.onPrevious);
    this.countEl = this.el.createDiv({ cls: 'canvas-control-item ffc-presentation-count', attr: { role: 'button' } });
    this.countEl.addEventListener('click', actions.onStops);
    this.nextEl = this.button('chevron-right', 'Next stop', actions.onNext);
    shieldFromCanvas(this.el);
  }

  /** Where the menu of stops opens from, as core's canvas settings menu opens from its control. */
  get stopsEl(): HTMLElement {
    return this.countEl;
  }

  /**
   * Show stop `index` (from 0) of `total`; its name is the count's tooltip. A null index is a stop whose anchor
   * has gone: no number, and both ways stay open.
   */
  update(index: number | null, total: number, name: string): void {
    this.countEl.setText(`${index === null ? '–' : index + 1} / ${total}`);
    setTooltip(this.countEl, name, { placement: 'top' });
    // Core's own disabled state for a control that has nothing to do.
    this.prevEl.toggleClass('is-disabled', index !== null && index <= 0);
    this.nextEl.toggleClass('is-disabled', index !== null && index >= total - 1);
  }

  destroy(): void {
    this.el.remove();
  }

  private button(icon: string, label: string, onClick: (evt: MouseEvent) => void): HTMLElement {
    const item = this.el.createDiv({ cls: 'canvas-control-item', attr: { role: 'button' } });
    setIcon(item, icon);
    setTooltip(item, label, { placement: 'top' });
    item.addEventListener('click', onClick);
    return item;
  }
}

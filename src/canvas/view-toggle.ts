import { setIcon } from 'obsidian';
import { CanvasLike, CanvasNodeLike } from './adapter.ts';
import { canToggleView, stopOf, toggleInfo, toggleViews } from './note-card.ts';
import { canPin, isPinned, togglePins } from './pin-node.ts';

const BUTTON_CLASS = 'ffc-view-btn';
const PIN_BUTTON_CLASS = 'ffc-pin-btn';

/**
 * A button in the selection pop-up menu that moves the selected note cards and issues
 * to their next view: card, then full embed, then styled link. It describes
 * where it will go, and updates as the view changes.
 */
export function injectViewToggleButton(canvas: CanvasLike, selected: CanvasNodeLike[], onToggled: () => void): void {
  const menuEl = canvas.menu?.menuEl;
  if (!menuEl) return;
  // Only when everything selected is a note card or issue this plugin has dressed.
  const cards = selected.filter(canToggleView);
  if (cards.length === 0 || cards.length !== selected.length) return;

  let btn = menuEl.querySelector<HTMLElement>(`.${BUTTON_CLASS}`);
  if (!btn) {
    btn = menuEl.createEl('button', { cls: `clickable-icon ${BUTTON_CLASS}`, attr: { 'data-tooltip-position': 'top' } });
    btn.addEventListener('click', () => {
      toggleViews(canvas, cards);
      onToggled();
    });
  }
  const info = toggleInfo(cards.map(stopOf));
  if (btn.getAttribute('aria-label') !== info.label) {
    btn.setAttribute('aria-label', info.label);
    btn.empty();
    setIcon(btn, info.icon);
  }
}

/** A button in the selection pop-up menu that shows what is selected as a pin, or back as it was when it is one already. */
export function injectPinButton(canvas: CanvasLike, selected: CanvasNodeLike[], onToggled: () => void): void {
  const menuEl = canvas.menu?.menuEl;
  if (!menuEl) return;
  const nodes = selected.filter(canPin);
  if (nodes.length === 0 || nodes.length !== selected.length) return;

  let btn = menuEl.querySelector<HTMLElement>(`.${PIN_BUTTON_CLASS}`);
  if (!btn) {
    btn = menuEl.createEl('button', { cls: `clickable-icon ${PIN_BUTTON_CLASS}`, attr: { 'data-tooltip-position': 'top' } });
    btn.addEventListener('click', () => {
      togglePins(canvas, nodes);
      onToggled();
    });
  }
  const label = nodes.every(isPinned) ? 'Show in full' : 'Show as pin';
  if (btn.getAttribute('aria-label') !== label) {
    btn.setAttribute('aria-label', label);
    btn.empty();
    setIcon(btn, 'map-pin');
  }
}

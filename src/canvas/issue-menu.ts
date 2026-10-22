import { setIcon } from 'obsidian';
import type { CanvasPlusPlugin } from '../main.ts';
import { CanvasLike, CanvasNodeLike, selectedNodes } from './adapter.ts';
import { LINEAR_ICON } from './icons.ts';
import { createIssuesFromCards, isConvertibleCard } from './linear-create.ts';
import { readLinearRef } from './linear-ref.ts';

const CREATE_CLASS = 'ffc-linear-create-btn';
const OPEN_CLASS = 'ffc-linear-open-btn';

function button(menuEl: HTMLElement, cls: string, label: string, icon: string, onClick: () => void): void {
  let btn = menuEl.querySelector<HTMLElement>(`.${cls}`);
  if (!btn) {
    btn = menuEl.createEl('button', { cls: `clickable-icon ${cls}`, attr: { 'data-tooltip-position': 'top' } });
    btn.addEventListener('click', onClick);
  }
  if (btn.getAttribute('aria-label') !== label) {
    btn.setAttribute('aria-label', label);
    btn.empty();
    setIcon(btn, icon);
  }
}

/**
 * Buttons in the selection pop-up menu: turn selected cards into Linear issues, and open a selected issue in
 * Linear. Obsidian rebuilds the menu on every selection change, so this runs after each one.
 */
export function injectLinearButtons(plugin: CanvasPlusPlugin, canvas: CanvasLike, selected: CanvasNodeLike[], onChanged: () => void): void {
  const menuEl = canvas.menu?.menuEl;
  if (!menuEl || selected.length === 0) return;

  if (plugin.hasLinear && selected.every(isConvertibleCard)) {
    button(menuEl, CREATE_CLASS, selected.length > 1 ? 'Create Linear issues' : 'Create Linear issue', LINEAR_ICON, () => {
      createIssuesFromCards(plugin, canvas, selectedNodes(canvas), onChanged);
    });
    return;
  }

  const ref = selected.length === 1 ? readLinearRef(selected[0]) : null;
  if (!ref) return;
  button(menuEl, OPEN_CLASS, 'Open in Linear', 'external-link', () => {
    const current = selectedNodes(canvas);
    const url = current.length === 1 ? readLinearRef(current[0])?.url : undefined;
    if (url) window.open(url);
  });
}

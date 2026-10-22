import { setIcon } from 'obsidian';
import { PROVIDERS, PROVIDER_IDS } from '../issues/providers.ts';
import type { CanvasPlusPlugin } from '../main.ts';
import { CanvasLike, CanvasNodeLike, selectedNodes } from './adapter.ts';
import { createIssuesFromCards, isConvertibleCard } from './issue-create.ts';
import { readIssueRef } from './issue-ref.ts';

const OPEN_CLASS = 'ffc-linear-open-btn';

/** Add a button to the selection menu once, relabelling it if its label changes. */
export function button(menuEl: HTMLElement, cls: string, label: string, icon: string, onClick: () => void): void {
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
 * Buttons in the selection pop-up menu: turn selected cards into issues (one button for each service that is set
 * up), and open a selected issue in its service. Obsidian rebuilds the menu on every selection change, so this runs
 * after each one.
 */
export function injectIssueButtons(plugin: CanvasPlusPlugin, canvas: CanvasLike, selected: CanvasNodeLike[], onChanged: () => void): void {
  const menuEl = canvas.menu?.menuEl;
  if (!menuEl || selected.length === 0) return;

  const ready = PROVIDER_IDS.filter((id) => plugin.hasIssues(id));
  if (ready.length > 0 && selected.every(isConvertibleCard)) {
    for (const id of ready) {
      const { name, icon } = PROVIDERS[id];
      button(menuEl, `ffc-${id}-create-btn`, selected.length > 1 ? `Create ${name} issues` : `Create ${name} issue`, icon, () => {
        createIssuesFromCards(plugin, id, canvas, selectedNodes(canvas), onChanged);
      });
    }
    return;
  }

  const ref = selected.length === 1 ? readIssueRef(selected[0]) : null;
  if (!ref) return;
  button(menuEl, OPEN_CLASS, `Open in ${PROVIDERS[ref.provider].name}`, 'external-link', () => {
    const current = selectedNodes(canvas);
    const url = current.length === 1 ? readIssueRef(current[0])?.url : undefined;
    if (url) window.open(url);
  });
}

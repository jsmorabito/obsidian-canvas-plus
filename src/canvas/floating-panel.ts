import { App, setIcon } from 'obsidian';
import { shieldFromCanvas } from './adapter.ts';

/** Whether a floating panel is open, a per-viewer preference. `fallback` until the viewer has chosen. */
export function loadOpen(app: App, key: string, fallback = true): boolean {
  const stored = app.loadLocalStorage(key) as string | null;
  return stored ? stored !== 'closed' : fallback;
}

export function saveOpen(app: App, key: string, open: boolean): void {
  app.saveLocalStorage(key, open ? 'open' : 'closed');
}

/**
 * What a floating panel shows while it's closed: a core canvas control, like the ones on the right, that
 * opens it again. `cls` places it.
 */
export function createShowButton(parent: HTMLElement, cls: string, icon: string, label: string, onShow: () => void): HTMLElement {
  const group = parent.createDiv({ cls: `canvas-control-group ${cls}` });
  const item = group.createDiv({
    cls: 'canvas-control-item',
    attr: { 'aria-label': label, 'data-tooltip-position': 'right' },
  });
  setIcon(item, icon);
  item.addEventListener('click', onShow);
  shieldFromCanvas(group);
  return group;
}

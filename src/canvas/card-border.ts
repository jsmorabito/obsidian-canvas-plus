import { Menu } from 'obsidian';
import { CanvasLike, CanvasNodeLike, batch, getExtra, selectedNodes, setExtra } from './adapter.ts';
import {
  FIELD_BORDER, FIELD_DIAGRAM, FIELD_INK, FIELD_KIND, FIELD_LINEAR_INITIATIVE, FIELD_LINEAR_PROJECT, FIELD_PIN, FIELD_TASKAPP_PROJECT, FIELD_WIDGET,
} from './constants.ts';
import { dashMask } from './dash-mask.ts';
import { readIssueRef } from './issue-ref.ts';
import { button } from './issue-menu.ts';

export type BorderStyle = 'solid' | 'dashed' | 'none';

export const BORDERS: ReadonlyArray<{ id: BorderStyle; label: string; icon: string }> = [
  { id: 'solid', label: 'Solid', icon: 'square' },
  { id: 'dashed', label: 'Dashed', icon: 'square-dashed' },
  { id: 'none', label: 'None', icon: 'ban' },
];

/** Fields that mark a text node as something other than a plain card, which draws its own chrome. */
const NOT_PLAIN = [FIELD_KIND, FIELD_INK, FIELD_DIAGRAM, FIELD_PIN, FIELD_WIDGET, FIELD_LINEAR_PROJECT, FIELD_LINEAR_INITIATIVE, FIELD_TASKAPP_PROJECT];

/** A plain text card of the canvas's own: not free text, a drawing, an anchor, a diagram, a pin, a widget, or an issue, project or initiative. */
export function isBorderable(node: CanvasNodeLike, data = node.getData?.()): boolean {
  if (!data || data.type !== 'text') return false;
  return NOT_PLAIN.every((key) => data[key] === undefined) && !readIssueRef(node, data);
}

/** The border a card has: solid unless it was saved as dashed or none. */
export function borderOf(node: CanvasNodeLike, data = node.getData?.()): BorderStyle {
  const v = getExtra(node, FIELD_BORDER, data);
  return v === 'dashed' || v === 'none' ? v : 'solid';
}

/**
 * Show a card's border on it. Run for each node on every sweep, with the data the sweep has already read, as the card's
 * element is made again as it comes into view. A border on something that isn't a plain card is left off, since there
 * is no button to change it.
 */
export function decorateBorder(node: CanvasNodeLike, data: Record<string, unknown> | undefined): void {
  const el = node.nodeEl;
  if (!el) return;
  const style = data && isBorderable(node, data) ? borderOf(node, data) : 'solid';
  if (style !== 'solid') el.setAttribute('data-ffc-border', style);
  else el.removeAttribute('data-ffc-border');
  const { width, height } = data ?? {};
  if (style === 'dashed' && typeof width === 'number' && typeof height === 'number') {
    // The corner radius is the theme's, so the line is drawn to the card's own.
    const container = el.querySelector<HTMLElement>('.canvas-node-container');
    const radius = container ? parseFloat(el.win.getComputedStyle(container).borderTopLeftRadius) || 0 : 0;
    const key = `${width}x${height}x${radius}`;
    // The mask only changes with the card's size, and this runs every sweep.
    if (el.getAttribute('data-ffc-dash') !== key) {
      el.setAttribute('data-ffc-dash', key);
      el.setCssProps({ '--ffc-dash-mask': dashMask(width, height, radius) });
    }
  } else if (el.hasAttribute('data-ffc-dash')) {
    el.removeAttribute('data-ffc-dash');
    el.setCssProps({ '--ffc-dash-mask': '' });
  }
}

/** Give `nodes` a border, as one undo step. Solid is the default, so it is saved as nothing. */
export function setBorders(canvas: CanvasLike, nodes: CanvasNodeLike[], style: BorderStyle): void {
  batch(canvas, () => {
    for (const node of nodes) setExtra(node, FIELD_BORDER, style === 'solid' ? undefined : style);
  });
}

/** A button in the selection pop-up menu to choose solid, dashed or no border for the selected cards. */
export function injectBorderButton(canvas: CanvasLike, selected: CanvasNodeLike[], onChanged: () => void): void {
  const menuEl = canvas.menu?.menuEl;
  if (!menuEl || selected.length === 0 || !selected.every((n) => isBorderable(n))) return;
  button(menuEl, 'ffc-border-btn', 'Border', 'square-dashed', () => {
    const nodes = selectedNodes(canvas);
    const now = new Set(nodes.map((n) => borderOf(n)));
    const menu = new Menu();
    for (const option of BORDERS) {
      menu.addItem((item) => item.setTitle(option.label).setIcon(option.icon).setChecked(now.size === 1 && now.has(option.id)).onClick(() => {
        setBorders(canvas, nodes, option.id);
        onChanged();
      }));
    }
    const rect = menuEl.querySelector<HTMLElement>('.ffc-border-btn')?.getBoundingClientRect();
    if (rect) menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
  });
}

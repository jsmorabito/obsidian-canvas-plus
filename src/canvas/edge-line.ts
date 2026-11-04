import { Menu } from 'obsidian';
import { CanvasEdgeLike, CanvasLike, batch, selectedEdges } from './adapter.ts';
import { FIELD_EDGE_LINE } from './constants.ts';
import { joinSegments, lineOf } from './edge-line-data.ts';
import type { EdgeLine } from './edge-line-data.ts';
import { button } from './issue-menu.ts';

export type { EdgeLine };

export const EDGE_LINES: ReadonlyArray<{ id: EdgeLine; label: string; icon: string }> = [
  { id: 'solid', label: 'Solid', icon: 'minus' },
  { id: 'dashed', label: 'Dashed', icon: 'ellipsis' },
];

/** Show each edge's line on it. Cheap enough to run on every sweep, as an edge's element is made again as it comes into view. */
export function decorateEdgeLines(canvas: CanvasLike): void {
  for (const edge of canvas.edges?.values() ?? []) {
    const g = edge.lineGroupEl;
    if (!g) continue;
    if (lineOf(edge) === 'dashed') {
      g.setAttribute('data-ffc-line', 'dashed');
      const path = g.querySelector('path.canvas-display-path');
      const d = path?.getAttribute('d');
      const joined = d ? joinSegments(d) : d;
      if (path && joined && joined !== d) path.setAttribute('d', joined);
    } else g.removeAttribute('data-ffc-line');
  }
}

/** Give `edges` a line, as one undo step. Solid is the default, so it is saved as nothing. */
export function setEdgeLines(canvas: CanvasLike, edges: CanvasEdgeLike[], line: EdgeLine): void {
  batch(canvas, () => {
    for (const edge of edges) {
      edge.setData?.({ ...edge.getData(), [FIELD_EDGE_LINE]: line === 'solid' ? undefined : line });
    }
  });
}

/** A button in the selection pop-up menu to choose a solid or dashed line for the selected edges. */
export function injectEdgeLineButton(canvas: CanvasLike, onChanged: () => void): void {
  const menuEl = canvas.menu?.menuEl;
  const edges = selectedEdges(canvas);
  // A mixed selection of cards and edges has no one control for both.
  if (!menuEl || edges.length === 0 || edges.length !== (canvas.selection?.size ?? 0)) return;
  button(menuEl, 'ffc-edge-line-btn', 'Line', 'ellipsis', () => {
    const now = new Set(selectedEdges(canvas).map(lineOf));
    const menu = new Menu();
    for (const option of EDGE_LINES) {
      menu.addItem((item) => item.setTitle(option.label).setIcon(option.icon).setChecked(now.size === 1 && now.has(option.id)).onClick(() => {
        setEdgeLines(canvas, selectedEdges(canvas), option.id);
        onChanged();
      }));
    }
    const rect = menuEl.querySelector<HTMLElement>('.ffc-edge-line-btn')?.getBoundingClientRect();
    if (rect) menu.showAtPosition({ x: rect.left, y: rect.bottom + 4 });
  });
}

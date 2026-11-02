import { CanvasLike, CanvasNodeLike } from './adapter.ts';
import { TrayItem, itemBox, restoreItem } from './tray-items.ts';

/** Space between a board and the cards put back beside it, and between those cards, in canvas units. */
const GAP = 40;

/** Put canvas cards a diagram no longer holds back on the canvas, one under the other to the right of it. Returns the restored nodes. */
export function restoreBeside(canvas: CanvasLike, node: CanvasNodeLike, items: readonly TrayItem[]): CanvasNodeLike[] {
  let y = node.y ?? 0;
  const restored: CanvasNodeLike[] = [];
  for (const item of items) {
    restored.push(...restoreItem(canvas, item, { x: (node.x ?? 0) + (node.width ?? 0) + GAP, y }));
    y += itemBox(item).height + GAP / 2;
  }
  return restored;
}

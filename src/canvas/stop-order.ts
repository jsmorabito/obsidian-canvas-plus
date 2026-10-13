import { Box, CanvasLike, CanvasNodeLike, batch, getExtra, setExtra } from './adapter.ts';
import { isAnchor } from './anchor.ts';
import { FIELD_STOP } from './constants.ts';
import { readingOrder } from './layers-tree.ts';

/** An anchor's place in the presentation order, if it has been given one. */
export function stopNumber(node: CanvasNodeLike, data?: Record<string, unknown>): number | undefined {
  const n = getExtra(node, FIELD_STOP, data);
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

/**
 * Anchors in presentation order: numbered ones first, by number, then the rest in reading order (top to bottom,
 * then left to right). Equal numbers, as from an anchor pasted in from another canvas, also fall back to reading
 * order. A canvas never reordered is simply in reading order.
 */
export function byStopOrder<T extends { node: CanvasNodeLike; box: Box }>(items: T[]): T[] {
  const keyed = items.map((item) => ({ item, n: stopNumber(item.node) }));
  keyed.sort((a, b) => {
    if (a.n !== undefined && b.n !== undefined && a.n !== b.n) return a.n - b.n;
    if ((a.n === undefined) !== (b.n === undefined)) return a.n === undefined ? 1 : -1;
    return readingOrder(a.item, b.item);
  });
  return keyed.map((k) => k.item);
}

/** Number `nodes` 1, 2, 3… in the order given, as one undo step. Nothing is recorded if the order is unchanged. */
export function renumberStops(canvas: CanvasLike, nodes: CanvasNodeLike[]): void {
  const changed = nodes.some((node, i) => stopNumber(node) !== i + 1);
  if (!changed) return;
  batch(canvas, () => nodes.forEach((node, i) => {
    if (stopNumber(node) !== i + 1) setExtra(node, FIELD_STOP, i + 1);
  }));
}

/** The number for a new anchor: last, once the canvas has an order. None while it is still in reading order. */
export function nextStopNumber(canvas: CanvasLike): number | undefined {
  let highest: number | undefined;
  for (const node of canvas.nodes?.values() ?? []) {
    const n = isAnchor(node) ? stopNumber(node) : undefined;
    if (n !== undefined && (highest === undefined || n > highest)) highest = n;
  }
  return highest === undefined ? undefined : Math.floor(highest) + 1;
}

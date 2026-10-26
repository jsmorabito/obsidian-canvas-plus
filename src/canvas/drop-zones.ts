/** A side of a box. */
export type Side = 'top' | 'bottom' | 'left' | 'right';

/** Where a dragged node would go: beside a sibling, or hanging from the node it is dropped on. */
export type Placement = 'before' | 'after' | 'inside';

/** A box on the screen. A `DOMRect` is one. */
export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

/** The side of a node a chart runs out of, for the direction its source says: where the dot that adds a node after it is. */
export function forwardOf(direction: string): Side {
  return ({ LR: 'right', RL: 'left', TD: 'bottom', TB: 'bottom', BT: 'top' } as Record<string, Side | undefined>)[direction] ?? 'bottom';
}

/** The side of `box` that the point is nearest to, measured from its middle. */
export function sideOf(box: Box, x: number, y: number): Side {
  const halfWidth = (box.right - box.left) / 2;
  const halfHeight = (box.bottom - box.top) / 2;
  const dx = (x - (box.left + halfWidth)) / halfWidth;
  const dy = (y - (box.top + halfHeight)) / halfHeight;
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 'left' : 'right';
  return dy < 0 ? 'top' : 'bottom';
}

export interface DropChoice {
  id: string;
  place: Placement;
  /** The side of the target the drop is shown on. */
  side: Side;
}

/**
 * Where a node dragged to the point (x, y) would go. Over a node it is the side the point is nearest to, the way the
 * dots round a node are placed: on the side the chart runs out of, the dragged node hangs from that node (a child);
 * on a side beside it, when the node is a sibling, it goes before or after it. The side the chart runs into takes
 * nothing. Over no node, it goes beside the nearest sibling. Null when it has nowhere to go.
 */
export function chooseDrop(
  forward: Side, siblings: ReadonlySet<string>, targets: ReadonlyArray<{ id: string; rect: Box }>, x: number, y: number,
): DropChoice | null {
  const stacked = forward === 'left' || forward === 'right';
  // Beside a node is across the way the chart runs; the first of those sides is "before" and the other "after".
  const before: Side = stacked ? 'top' : 'left';
  let over: (typeof targets)[number] | null = null;
  let near: { target: (typeof targets)[number]; dist: number } | null = null;
  for (const target of targets) {
    const { rect } = target;
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) over = target;
    const dist = Math.hypot(Math.max(rect.left - x, 0, x - rect.right), Math.max(rect.top - y, 0, y - rect.bottom));
    if (siblings.has(target.id) && (!near || dist < near.dist)) near = { target, dist };
  }
  if (over) {
    const side = sideOf(over.rect, x, y);
    if (side === OPPOSITE[forward]) return null;
    if (side === forward || !siblings.has(over.id)) return { id: over.id, place: 'inside', side: forward };
    return { id: over.id, place: side === before ? 'before' : 'after', side };
  }
  if (!near) return null;
  const { rect } = near.target;
  const after = stacked ? y >= (rect.top + rect.bottom) / 2 : x >= (rect.left + rect.right) / 2;
  return { id: near.target.id, place: after ? 'after' : 'before', side: after ? OPPOSITE[before] : before };
}

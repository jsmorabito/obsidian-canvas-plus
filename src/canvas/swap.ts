export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A node as the swap sees it: what it is, and where. */
export interface Placed<T> {
  node: T;
  box: Box;
  group: boolean;
}

/** The smallest of `items` whose box holds the point, so a node inside a selected group wins over the group. */
export function placedAt<T>(items: Array<Placed<T>>, p: { x: number; y: number }): Placed<T> | undefined {
  let best: Placed<T> | undefined;
  for (const item of items) {
    const b = item.box;
    if (p.x < b.x || p.y < b.y || p.x > b.x + b.width || p.y > b.y + b.height) continue;
    if (!best || b.width * b.height < best.box.width * best.box.height) best = item;
  }
  return best;
}

/** Put a box's centre where another's was, keeping its own size. */
export function centredOn(mine: Box, other: Box): Box {
  return { ...mine, x: other.x + (other.width - mine.width) / 2, y: other.y + (other.height - mine.height) / 2 };
}

const holds = (outer: Box, inner: Box): boolean =>
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;

/**
 * Every move that swaps `a` and `b` (centre to centre). A group takes the nodes inside it along, as core's own
 * drag does; `rest` is every other node on the canvas, and a node that is itself being swapped is not carried.
 */
export function swapMoves<T>(a: Placed<T>, b: Placed<T>, rest: Array<Placed<T>>): Array<{ node: T; box: Box }> {
  const moves = [{ node: a.node, box: centredOn(a.box, b.box) }, { node: b.node, box: centredOn(b.box, a.box) }];
  const carried = new Set<T>();
  for (const [from, to] of [[a, moves[0].box], [b, moves[1].box]] as const) {
    if (!from.group) continue;
    const dx = to.x - from.box.x;
    const dy = to.y - from.box.y;
    for (const inner of rest) {
      if (inner.node === a.node || inner.node === b.node || carried.has(inner.node) || !holds(from.box, inner.box)) continue;
      carried.add(inner.node);
      moves.push({ node: inner.node, box: { ...inner.box, x: inner.box.x + dx, y: inner.box.y + dy } });
    }
  }
  return moves;
}

import type { ProviderId } from '../issues/types.ts';
import { CanvasLike, CanvasNodeLike, batch, createTextNode, setExtra, viewportCenter } from './adapter.ts';
import { SIZE_ISSUE_CARD } from './constants.ts';
import { findFreeSpot } from './free-spot.ts';
import { IssueRef, issueNodeText, readIssueRef, storedRef } from './issue-ref.ts';

/** The node already showing this issue or project, if any. */
export function findRefNode(canvas: CanvasLike, kind: IssueRef['kind'], provider: ProviderId, id: string): CanvasNodeLike | undefined {
  return [...canvas.nodes?.values() ?? []].find((n: CanvasNodeLike) => ((r) => r?.kind === kind && r.provider === provider && r.id === id)(readIssueRef(n)));
}

/**
 * Add a card for an issue or project, as one undo step, saved in `field`. `at` is where its centre goes; without it,
 * the nearest free spot to the middle of the view.
 */
export function addRefNode(canvas: CanvasLike, ref: IssueRef, field: string, at: { x: number; y: number } | null): CanvasNodeLike | undefined {
  const size = SIZE_ISSUE_CARD;
  const pos = at
    ? { x: Math.round(at.x - size.width / 2), y: Math.round(at.y - size.height / 2) }
    : findFreeSpot(canvas, viewportCenter(canvas), size);
  return batch(canvas, () => {
    const added = createTextNode(canvas, { pos, size, text: issueNodeText(ref), focus: false });
    if (added) setExtra(added, field, storedRef(ref));
    return added;
  });
}

import type { CanvasEdgeLike } from './adapter.ts';
import { FIELD_EDGE_LINE } from './constants.ts';

export type EdgeLine = 'solid' | 'dashed';

/** The line an edge has: solid unless it was saved as dashed. */
export function lineOf(edge: CanvasEdgeLike): EdgeLine {
  // Core's `setData` keeps fields it doesn't know in `unknownData`; reading it avoids copying every edge's data each sweep.
  return edge.unknownData?.[FIELD_EDGE_LINE] === 'dashed' ? 'dashed' : 'solid';
}

/**
 * Core draws an end with no arrow as a short line of its own, ahead of the curve. A dash pattern starts over with each
 * piece, so that stub runs into the curve's first dash as one long one. Joining the pieces (each starts where the last
 * ended) lets the pattern run on. Only the drawn line is changed; the wider one that takes the clicks is left alone.
 */
export function joinSegments(d: string): string {
  return d.replace(/(\S)\s*M/g, '$1 L');
}

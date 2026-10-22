import { CanvasLike, CanvasNodeLike, getCanvasExtra, nodeBox, setCanvasExtra } from './adapter.ts';
import { FIELD_COMMENTS } from './constants.ts';
import { readInk } from './ink-nodes.ts';

export interface CommentMessage {
  text: string;
  /** Milliseconds since the epoch. */
  at: number;
}

/** A pin on the canvas, at a canvas point, with the thread of messages left on it. */
export interface CanvasComment {
  id: string;
  x: number;
  y: number;
  thread: CommentMessage[];
  resolved?: boolean;
  /** The node the pin is attached to: it keeps its place on the node, at (dx, dy) from the node's top-left, as the node moves. */
  node?: string;
  dx?: number;
  dy?: number;
}

/** Where a pin is: on its node if it has one still on the canvas, else where it was last put. */
export function pinPoint(canvas: CanvasLike, c: Pick<CanvasComment, 'x' | 'y' | 'node' | 'dx' | 'dy'>): { x: number; y: number } {
  const node = c.node ? canvas.nodes?.get(c.node) : undefined;
  const box = node && nodeBox(node);
  return box ? { x: box.x + (c.dx ?? 0), y: box.y + (c.dy ?? 0) } : { x: c.x, y: c.y };
}

/** The node a pin at `at` would attach to: the smallest one under it (strokes aren't things to comment on). */
export function nodeUnder(canvas: CanvasLike, at: { x: number; y: number }): CanvasNodeLike | undefined {
  let best: CanvasNodeLike | undefined;
  let bestArea = Infinity;
  for (const node of canvas.nodes?.values() ?? []) {
    const box = nodeBox(node);
    if (!box || !node.id || readInk(node)) continue;
    if (at.x < box.x || at.y < box.y || at.x > box.x + box.width || at.y > box.y + box.height) continue;
    if (box.width * box.height < bestArea) {
      best = node;
      bestArea = box.width * box.height;
    }
  }
  return best;
}

/** `comment` put at `at`, attached to the node under it, or to none. */
export function movedTo(canvas: CanvasLike, comment: CanvasComment, at: { x: number; y: number }, node = nodeUnder(canvas, at)): CanvasComment {
  const box = node && nodeBox(node);
  return {
    id: comment.id,
    thread: comment.thread,
    ...(comment.resolved ? { resolved: true } : {}),
    x: at.x,
    y: at.y,
    ...(node?.id && box ? { node: node.id, dx: at.x - box.x, dy: at.y - box.y } : {}),
  };
}

const EMPTY: CanvasComment[] = [];
/** Each array already checked, so a redraw check on every canvas frame doesn't walk it again. */
const checked = new WeakMap<unknown[], CanvasComment[]>();

const isMessage = (o: unknown): o is CommentMessage => typeof o === 'object' && o !== null
  && typeof (o as CommentMessage).text === 'string' && typeof (o as CommentMessage).at === 'number';

const isComment = (o: unknown): o is CanvasComment => typeof o === 'object' && o !== null
  && typeof (o as CanvasComment).id === 'string' && Number.isFinite((o as CanvasComment).x) && Number.isFinite((o as CanvasComment).y)
  && Array.isArray((o as CanvasComment).thread) && (o as CanvasComment).thread.every(isMessage);

/** The canvas's comments. The same array until they change, so a caller can tell when to redraw. */
export function readComments(canvas: CanvasLike): CanvasComment[] {
  const value = getCanvasExtra(canvas, FIELD_COMMENTS);
  if (!Array.isArray(value)) return EMPTY;
  let comments = checked.get(value);
  if (!comments) {
    comments = value.every(isComment) ? value : EMPTY;
    checked.set(value, comments);
  }
  return comments;
}

export function writeComments(canvas: CanvasLike, comments: CanvasComment[]): void {
  setCanvasExtra(canvas, FIELD_COMMENTS, comments.length > 0 ? comments : undefined);
}

export function newCommentId(): string {
  return Math.random().toString(16).slice(2, 12) + Date.now().toString(16);
}

/** How long ago a message was left, as a short phrase. */
export function timeAgo(at: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days}d ago` : new Date(at).toLocaleDateString();
}

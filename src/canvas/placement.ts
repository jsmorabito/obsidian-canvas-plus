import {
  CanvasLike, CanvasNodeLike, batch, createGroupNode, createTextNode, removeNode, setExtra,
} from './adapter.ts';
import {
  FIELD_FRAME, FIELD_KIND, FIELD_STOP, KIND_ANCHOR, KIND_TEXT, MIN_DRAW_HEIGHT, MIN_DRAW_HEIGHT_TEXT, MIN_DRAW_WIDTH,
  SIZE_ANCHOR, SIZE_CARD, SIZE_GROUP, SIZE_TEXT,
} from './constants.ts';
import type { PlaceTool } from './tools.ts';
import { editAnchorLabel, nextAnchorLabel } from './anchor.ts';
import { nextStopNumber } from './stop-order.ts';
import { eachFrameUntil } from '../utils/helpers.ts';
type Point = { x: number; y: number };
export interface PlacedRect {
  pos: Point;
  size: { width: number; height: number };
  /** Dragged out rather than clicked. */
  drawn?: boolean;
}

const DEFAULT_SIZE: Record<PlaceTool, { width: number; height: number }> = {
  text: SIZE_TEXT, card: SIZE_CARD, group: SIZE_GROUP, anchor: SIZE_ANCHOR,
};

/**
 * Where a node lands. A click (`end` null) puts text at the click point and
 * centres anchors, cards and groups on it; a drag sets the box, with minimum sizes.
 * An anchor drag smaller than that minimum counts as a click: a frame that small is a hand that wandered while
 * clicking, and it drops a plain anchor where the press started.
 */
export function placementRect(tool: PlaceTool, start: Point, end: Point | null): PlacedRect {
  const tooSmallForFrame = tool === 'anchor' && !!end
    && (Math.abs(end.x - start.x) < MIN_DRAW_WIDTH || Math.abs(end.y - start.y) < MIN_DRAW_HEIGHT);
  if (!end || tooSmallForFrame) {
    const size = DEFAULT_SIZE[tool];
    const pos = tool === 'text' ? start
      : { x: start.x - size.width / 2, y: start.y - size.height / 2 };
    return { pos: { x: Math.round(pos.x), y: Math.round(pos.y) }, size };
  }
  const minH = tool === 'text' ? MIN_DRAW_HEIGHT_TEXT : MIN_DRAW_HEIGHT;
  return {
    pos: { x: Math.round(Math.min(start.x, end.x)), y: Math.round(Math.min(start.y, end.y)) },
    size: {
      width: Math.round(Math.max(Math.abs(end.x - start.x), MIN_DRAW_WIDTH)),
      height: Math.round(Math.max(Math.abs(end.y - start.y), minH)),
    },
    drawn: true,
  };
}

/** Create the node for `tool` as one undo step and drop the user into editing it. */
export function placeNode(canvas: CanvasLike, tool: PlaceTool, rect: PlacedRect): CanvasNodeLike | undefined {
  return batch(canvas, () => {
    if (tool === 'group') {
      const group = createGroupNode(canvas, { ...rect, focus: true });
      if (group) beginLabelEdit(group);
      return group;
    }
    if (tool === 'anchor') {
      // Once the canvas has a presentation order, a new anchor goes last in it.
      const stop = nextStopNumber(canvas);
      // Not focused: core would focus the node a moment later, taking focus from the label being renamed.
      const anchor = createTextNode(canvas, { ...rect, text: nextAnchorLabel(canvas), focus: false });
      if (anchor) {
        setExtra(anchor, FIELD_KIND, KIND_ANCHOR);
        if (stop !== undefined) setExtra(anchor, FIELD_STOP, stop);
        // A drawn anchor is a frame: its box is what a presentation shows at that stop.
        if (rect.drawn) setExtra(anchor, FIELD_FRAME, true);
        // The node exists before it is on the page, and the label can't take focus until it is.
        eachFrameUntil(() => {
          if (!anchor.nodeEl?.isConnected) return false;
          editAnchorLabel(canvas, anchor);
          return true;
        });
      }
      return anchor;
    }
    const node = createTextNode(canvas, { ...rect, focus: true });
    if (node && tool === 'text') {
      setExtra(node, FIELD_KIND, KIND_TEXT);
      removeWhenLeftEmpty(canvas, node);
    }
    node?.startEditing?.();
    return node;
  });
}

/**
 * Free text left empty after editing removes itself. It only arms once the editor has had focus and
 * only fires when focus has left the whole node, so a focus change while the editor mounts can't
 * delete a box the user is about to type in.
 */
function removeWhenLeftEmpty(canvas: CanvasLike, node: CanvasNodeLike): void {
  eachFrameUntil(() => {
    const el = node.nodeEl;
    if (!el) return false;
    let armed = el.contains(el.doc.activeElement);
    el.addEventListener('focusin', () => { armed = true; });
    el.addEventListener('focusout', () => {
      if (!armed) return;
      window.setTimeout(() => {
        if (!el.isConnected || el.contains(el.doc.activeElement)) return;
        if ((node.text ?? '').trim() === '') batch(canvas, () => removeNode(canvas, node));
      }, 80);
    });
    return true;
  });
}

/** A fresh group starts in label edit. Group nodes have no consistent startEditing, so focus the label. */
export function beginLabelEdit(group: CanvasNodeLike): void {
  eachFrameUntil(() => {
    try { group.startEditing?.(); } catch { /* group may not expose startEditing */ }
    const label = group.nodeEl?.querySelector<HTMLElement>('.canvas-node-label');
    if (!label) return false;
    label.focus();
    label.win.getSelection()?.selectAllChildren(label);
    return true;
  });
}

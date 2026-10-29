import { CanvasLike, CanvasNodeLike, getExtra } from './adapter.ts';
import { isPinned } from './pin-node.ts';
import { FIELD_KIND, KIND_TEXT, MIN_DRAW_HEIGHT_TEXT } from './constants.ts';

/** Space the node's own padding takes above and below the text, in canvas units. */
const VERTICAL_PADDING = 8;

/** What the text inside a node needs, in canvas units: the editor while editing, else the rendered preview. */
function contentHeight(node: CanvasNodeLike): number | null {
  const el = node.nodeEl;
  if (!el) return null;
  const inner = el.querySelector<HTMLElement>('.cm-content')
    ?? el.querySelector<HTMLElement>('.markdown-preview-sizer');
  if (!inner) return null;
  // Layout pixels are scaled by the canvas zoom; the node's own width in both units gives the scale.
  const scale = node.width ? el.offsetWidth / node.width : 1;
  return scale > 0 ? inner.offsetHeight / scale : null;
}

/**
 * Free text never clips: its height follows its text, with a one-line minimum. The width stays whatever
 * the user set, so the text wraps there. Returns whether the node changed size.
 */
export function fitFreeText(canvas: CanvasLike, node: CanvasNodeLike): boolean {
  if (getExtra(node, FIELD_KIND) !== KIND_TEXT || node.x === undefined || node.y === undefined || !node.width || isPinned(node)) return false;
  const content = contentHeight(node);
  if (content === null || content === 0) return false;
  const height = Math.max(MIN_DRAW_HEIGHT_TEXT, Math.ceil(content + VERTICAL_PADDING));
  if (Math.abs(height - (node.height ?? 0)) < 1) return false;
  node.moveAndResize?.({ x: node.x, y: node.y, width: node.width, height });
  canvas.requestSave?.(false);
  return true;
}

/** Fit every free-text node. */
export function fitAllFreeText(canvas: CanvasLike): void {
  for (const node of canvas.nodes?.values() ?? []) fitFreeText(canvas, node);
}

/** The free-text node whose element holds `target`, if any. */
export function freeTextAt(canvas: CanvasLike, target: EventTarget | null): CanvasNodeLike | undefined {
  if (!(target instanceof Element)) return undefined;
  const el = target.closest('.canvas-node[data-ffc-kind="text"]');
  if (!el) return undefined;
  for (const node of canvas.nodes?.values() ?? []) if (node.nodeEl === el) return node;
  return undefined;
}

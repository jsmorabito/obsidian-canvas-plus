import { CanvasLike, nodeBox } from './adapter.ts';
import { isAnchor } from './anchor.ts';
import { readInk } from './ink-nodes.ts';

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

/** Canvas coordinates to minimap pixels: `map = canvas * scale + offset`. */
export interface MapTransform { scale: number; dx: number; dy: number }

/** Colours resolved from the theme, since a 2D context can't read CSS variables. */
export interface Palette {
  node: string;
  accent: string;
  /** Core's six canvas colours, keyed '1' to '6' as nodes store them. */
  colors: Record<string, string>;
}

/** Smallest a node is drawn, in minimap pixels, so a far-off note is still a visible speck. */
const MIN_NODE_PX = 2;
const ANCHOR_RADIUS_PX = 2.5;

/** Everything on the canvas, and the part in view, so the view's box always fits on the map. */
export function mapBounds(canvas: CanvasLike, viewport: Bounds | null): Bounds | null {
  let out: Bounds | null = viewport ? { ...viewport } : null;
  for (const node of canvas.nodes?.values() ?? []) {
    const box = nodeBox(node);
    if (!box) continue;
    out = out
      ? {
        minX: Math.min(out.minX, box.x), minY: Math.min(out.minY, box.y),
        maxX: Math.max(out.maxX, box.x + box.width), maxY: Math.max(out.maxY, box.y + box.height),
      }
      : { minX: box.x, minY: box.y, maxX: box.x + box.width, maxY: box.y + box.height };
  }
  return out;
}

/** Fit `bounds` inside a `width` × `height` map with `pad` pixels to spare, centred. */
export function fitTransform(bounds: Bounds, width: number, height: number, pad: number): MapTransform {
  const bw = Math.max(1, bounds.maxX - bounds.minX);
  const bh = Math.max(1, bounds.maxY - bounds.minY);
  const scale = Math.min((width - 2 * pad) / bw, (height - 2 * pad) / bh);
  return {
    scale,
    dx: (width - bw * scale) / 2 - bounds.minX * scale,
    dy: (height - bh * scale) / 2 - bounds.minY * scale,
  };
}

export function toCanvasPos(t: MapTransform, mx: number, my: number): { x: number; y: number } {
  return { x: (mx - t.dx) / t.scale, y: (my - t.dy) / t.scale };
}

/** Whether each colour string a node has stored is one CSS understands, so an odd one isn't drawn in the last valid colour. */
const validColors = new Map<string, boolean>();

function colorOf(data: Record<string, unknown>, palette: Palette): string {
  const color = data.color;
  if (typeof color !== 'string' || color === '') return palette.node;
  const preset = palette.colors[color];
  if (preset) return preset;
  let valid = validColors.get(color);
  if (valid === undefined) {
    valid = CSS.supports('color', color);
    validColors.set(color, valid);
  }
  return valid ? color : palette.node;
}

/** Draw every node and the box of what's in view. `ctx` is already scaled to CSS pixels and cleared. */
/**
 * What the node layer looks like, without reading any node's data: where each node is, its colour and whether
 * it's selected. Equal keys mean `drawNodes` would draw the same picture, so a pan or zoom that doesn't move
 * the map can reuse it.
 */
export function nodeLayerKey(canvas: CanvasLike, t: MapTransform): string {
  const selection = canvas.selection ?? new Set<object>();
  const parts: Array<string | number | undefined> = [t.scale, t.dx, t.dy];
  for (const node of canvas.nodes?.values() ?? []) {
    const box = nodeBox(node);
    if (box) parts.push(box.x, box.y, box.width, box.height, node.color, selection.has(node) ? 1 : 0);
  }
  return parts.join('|');
}

/** The nodes alone, on a transparent map. */
export function drawNodes(ctx: CanvasRenderingContext2D, canvas: CanvasLike, t: MapTransform, palette: Palette): void {
  const selection = canvas.selection ?? new Set<object>();
  // Each node's data is read once: this runs every frame while the view moves.
  const items = [...(canvas.nodes?.values() ?? [])].flatMap((node) => {
    const box = nodeBox(node);
    if (!box) return [];
    const data = node.getData?.() ?? {};
    return [{ node, box, data, group: data.type === 'group' }];
  });
  // Groups first, so what they hold is drawn over them, as on the canvas.
  items.sort((a, b) => Number(b.group) - Number(a.group));
  ctx.lineWidth = 1;
  for (const { node, box, data, group } of items) {
    const x = box.x * t.scale + t.dx;
    const y = box.y * t.scale + t.dy;
    const w = Math.max(MIN_NODE_PX, box.width * t.scale);
    const h = Math.max(MIN_NODE_PX, box.height * t.scale);
    const color = colorOf(data, palette);
    const selected = selection.has(node);
    ctx.fillStyle = color;
    ctx.strokeStyle = selected ? palette.accent : color;
    if (isAnchor(node, data)) {
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(x + w / 2, y + h / 2, ANCHOR_RADIUS_PX, 0, 2 * Math.PI);
      ctx.fill();
    } else if (group) {
      ctx.globalAlpha = 0.12;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 0.6;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    } else if (readInk(node, data)) {
      // A stroke is mostly empty box: a faint fill reads as a mark without hiding what's under it.
      ctx.globalAlpha = 0.35;
      ctx.fillRect(x, y, w, h);
    } else {
      ctx.globalAlpha = 0.55;
      ctx.fillRect(x, y, w, h);
    }
    if (selected) {
      ctx.globalAlpha = 1;
      ctx.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
    }
  }
  ctx.globalAlpha = 1;
}

/** The box for the part of the canvas in view. */
export function drawViewport(ctx: CanvasRenderingContext2D, t: MapTransform, palette: Palette, viewport: Bounds | null): void {
  if (viewport) {
    const x = viewport.minX * t.scale + t.dx;
    const y = viewport.minY * t.scale + t.dy;
    const w = (viewport.maxX - viewport.minX) * t.scale;
    const h = (viewport.maxY - viewport.minY) * t.scale;
    ctx.fillStyle = palette.accent;
    ctx.strokeStyle = palette.accent;
    ctx.globalAlpha = 0.1;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, w, h);
  }
  ctx.globalAlpha = 1;
}

import type { CanvasPlusPlugin } from '../main.ts';
import { Box, CanvasLike, CanvasNodeLike, getCanvasExtra, importNodes, nodeBox, setCanvasExtra } from './adapter.ts';
import { FIELD_TRAY } from './constants.ts';
import { LayerKind, describe, readingOrder } from './layers-tree.ts';

/**
 * One thing held in a canvas's tray: a node taken off the canvas, with everything in it if it's a group,
 * and the edges that touched them. Kept as JSON Canvas data, so it goes back exactly as it was.
 */
export interface TrayItem {
  /** The id of the node it was made from (the group, for a group). */
  id: string;
  kind: LayerKind;
  label: string;
  /** The node first, then what a group holds. */
  nodes: Record<string, unknown>[];
  edges: Record<string, unknown>[];
}

const EMPTY: TrayItem[] = [];

const isItem = (o: unknown): o is TrayItem => typeof o === 'object' && o !== null
  && typeof (o as TrayItem).id === 'string' && Array.isArray((o as TrayItem).nodes) && Array.isArray((o as TrayItem).edges);

/** What the canvas's tray holds. The same array until it changes, so a caller can tell when to redraw. */
export function readTray(canvas: CanvasLike): TrayItem[] {
  const value = getCanvasExtra(canvas, FIELD_TRAY);
  return Array.isArray(value) && value.every(isItem) ? value : EMPTY;
}

export function writeTray(canvas: CanvasLike, items: TrayItem[]): void {
  setCanvasExtra(canvas, FIELD_TRAY, items.length > 0 ? items : undefined);
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** The box around all of an item's nodes, in canvas units, where they were when it was put in the tray. */
export function itemBox(item: TrayItem): Box {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of item.nodes) {
    minX = Math.min(minX, num(n.x));
    minY = Math.min(minY, num(n.y));
    maxX = Math.max(maxX, num(n.x) + num(n.width));
    maxY = Math.max(maxY, num(n.y) + num(n.height));
  }
  return item.nodes.length > 0 ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : { x: 0, y: 0, width: 0, height: 0 };
}

const within = (outer: Box, inner: Box): boolean => outer.x <= inner.x && outer.y <= inner.y
  && outer.x + outer.width >= inner.x + inner.width && outer.y + outer.height >= inner.y + inner.height;

/**
 * Turn dragged nodes into tray items: one for each, except that what a dragged group holds goes in with the
 * group (the outermost one, when groups are nested).
 */
export function trayItemsFrom(plugin: CanvasPlusPlugin, canvas: CanvasLike, nodes: CanvasNodeLike[]): TrayItem[] {
  const entries = nodes.flatMap((node) => {
    const box = nodeBox(node);
    const data = node.getData?.();
    return box && data && node.id ? [{ node, box, data }] : [];
  });
  const area = (b: Box): number => b.width * b.height;
  const groups = entries.filter((e) => e.data.type === 'group').sort((a, b) => area(b.box) - area(a.box));
  const members = new Map<(typeof entries)[number], Array<(typeof entries)[number]>>();
  for (const entry of entries) {
    const owner = groups.find((g) => g !== entry && within(g.box, entry.box) && area(g.box) >= area(entry.box));
    if (!owner) members.set(entry, members.get(entry) ?? []);
    else members.set(owner, [...(members.get(owner) ?? []), entry]);
  }
  const edges = [...(canvas.edges?.values() ?? [])];
  return [...members.entries()]
    .sort(([a], [b]) => readingOrder(a, b))
    .map(([top, inside]) => {
      const ids = new Set([top.node.id, ...inside.map((e) => e.node.id)]);
      const { kind, label } = describe(plugin, top.node);
      return {
        id: top.node.id!,
        kind,
        label,
        nodes: [top.data, ...inside.sort(readingOrder).map((e) => e.data)],
        edges: edges.filter((e) => ids.has(e.from.node.id) || ids.has(e.to.node.id)).map((e) => e.getData()),
      };
    });
}

/**
 * Put an item's nodes back on the canvas with the top-left of their box at `at`, and the edges whose ends are
 * both there. Returns the item's own node. The caller saves and records it for undo.
 */
export function restoreItem(canvas: CanvasLike, item: TrayItem, at: { x: number; y: number }): CanvasNodeLike | undefined {
  const box = itemBox(item);
  const dx = Math.round(at.x - box.x);
  const dy = Math.round(at.y - box.y);
  const nodes: Record<string, unknown>[] = item.nodes.map((n) => ({ ...n, x: num(n.x) + dx, y: num(n.y) + dy }));
  const present = new Set<unknown>([...(canvas.nodes?.keys() ?? []), ...nodes.map((n) => n.id)]);
  const edges = item.edges.filter((e) => present.has(e.fromNode) && present.has(e.toNode));
  importNodes(canvas, nodes, edges);
  return canvas.nodes?.get(item.id);
}

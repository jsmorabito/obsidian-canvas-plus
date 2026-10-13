import type { CanvasPlusPlugin } from '../main.ts';
import { Box, CanvasLike, CanvasNodeLike, getExtra, nodeBox } from './adapter.ts';
import { FIELD_KIND, FIELD_LINK_NAME, KIND_TEXT } from './constants.ts';
import { readInk } from './ink-nodes.ts';
import { anchorLabel, isAnchor } from './anchor.ts';
import { noteRefFor } from './relation-logic.ts';

export type LayerKind = 'group' | 'anchor' | 'note' | 'text' | 'card' | 'image' | 'file' | 'link' | 'ink';

export interface Layer {
  node: CanvasNodeLike;
  kind: LayerKind;
  label: string;
  /** Note type name, for note cards. */
  type?: string;
  /** The URL, for web links. */
  url?: string;
  box: Box;
  children: Layer[];
  /** Set by filtering: this group doesn't match, and is only shown because something inside it does. */
  dimmed?: boolean;
}

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp']);

/** First non-empty line of `text` with markdown markup stripped. */
export function firstLine(text: string): string {
  const line = text.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  return line
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/!?\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_m, target: string, alias?: string) => alias ?? target)
    .replace(/^(?:#{1,6}\s+|>\s+|[-*+]\s+(?:\[.\]\s+)?|\d+\.\s+)/, '')
    .replace(/[*_`~]/g, '')
    .trim();
}

function describe(plugin: CanvasPlusPlugin, node: CanvasNodeLike): Pick<Layer, 'kind' | 'label' | 'type' | 'url'> {
  const ink = readInk(node);
  if (ink) return { kind: 'ink', label: ink.tool === 'highlighter' ? 'Highlight' : 'Drawing' };
  const data = node.getData?.() ?? {};
  switch (data.type) {
    case 'group':
      return { kind: 'group', label: typeof data.label === 'string' && data.label.trim() ? data.label.trim() : 'Untitled group' };
    case 'file': {
      const note = noteRefFor(plugin, node);
      if (note) return { kind: 'note', label: note.file.basename, type: note.type.name };
      const path = typeof data.file === 'string' ? data.file : '';
      const name = path.split('/').pop() ?? path;
      const ext = name.split('.').pop()?.toLowerCase() ?? '';
      return { kind: IMAGE_EXT.has(ext) ? 'image' : 'file', label: name || 'File' };
    }
    case 'link': {
      const url = typeof data.url === 'string' ? data.url : '';
      const name = getExtra(node, FIELD_LINK_NAME, data);
      return { kind: 'link', label: typeof name === 'string' && name.trim() ? name.trim() : url || 'Link', url };
    }
    default: {
      if (isAnchor(node)) return { kind: 'anchor', label: anchorLabel(node) || 'Untitled anchor' };
      const free = data[FIELD_KIND] === KIND_TEXT;
      const text = typeof data.text === 'string' ? data.text : '';
      const image = /^!\[([^\]]*)\]\(/.exec(text.trim());
      if (image) return { kind: 'image', label: image[1] || 'Image' };
      return { kind: free ? 'text' : 'card', label: firstLine(text) || (free ? 'Empty text' : 'Empty card') };
    }
  }
}

/** `outer` fully contains `inner`. An identical box doesn't count. */
function contains(outer: Box, inner: Box): boolean {
  const identical = outer.x === inner.x && outer.y === inner.y && outer.width === inner.width && outer.height === inner.height;
  return !identical
    && outer.x <= inner.x && outer.y <= inner.y
    && outer.x + outer.width >= inner.x + inner.width
    && outer.y + outer.height >= inner.y + inner.height;
}

/**
 * The group a box belongs to: the smallest of `groups` that fully contains it, other than `self`. This is how
 * the layers panel nests the canvas, and which group a presentation shows for an anchor.
 */
export function smallestContaining<T extends { box: Box }>(groups: Iterable<T>, box: Box, self?: T): T | undefined {
  const area = (b: Box): number => b.width * b.height;
  let found: T | undefined;
  for (const group of groups) {
    if (group !== self && contains(group.box, box) && (!found || area(group.box) < area(found.box))) found = group;
  }
  return found;
}

/** Top to bottom, then left to right. */
export const readingOrder = (a: { box: Box }, b: { box: Box }): number => a.box.y - b.box.y || a.box.x - b.box.x;

/**
 * Groups and what they contain. A node belongs to the smallest group that
 * fully contains it; children are in reading order (top to bottom, then left
 * to right).
 */
export function buildLayers(plugin: CanvasPlusPlugin, canvas: CanvasLike): Layer[] {
  const layers: Layer[] = [];
  for (const node of canvas.nodes?.values() ?? []) {
    const box = nodeBox(node);
    if (box) layers.push({ node, box, children: [], ...describe(plugin, node) });
  }
  const groups = layers.filter((l) => l.kind === 'group');
  const roots: Layer[] = [];
  for (const layer of layers) {
    const parent = smallestContaining(groups, layer.box, layer);
    (parent ? parent.children : roots).push(layer);
  }
  const sortAll = (list: Layer[]): void => {
    list.sort(readingOrder);
    for (const l of list) sortAll(l.children);
  };
  sortAll(roots);
  return roots;
}

// ── Search and filter ─────────────────────────────────────────────────────────

/** Filter values: `all`, `kind:<kind>` for a whole kind of layer, or `type:<name>` for notes of one note type. */
export const ALL_LAYERS = 'all';
const KIND_PREFIX = 'kind:';

/** The filter value that shows one kind of layer. */
export const kindFilter = (kind: LayerKind): string => `${KIND_PREFIX}${kind}`;

export interface FilterOption {
  value: string;
  label: string;
}

const KIND_ORDER: Array<{ kind: LayerKind; label: string }> = [
  { kind: 'group', label: 'Groups' },
  { kind: 'anchor', label: 'Anchors' },
  { kind: 'note', label: 'Notes' },
  { kind: 'text', label: 'Text' },
  { kind: 'card', label: 'Cards' },
  { kind: 'image', label: 'Images' },
  { kind: 'file', label: 'Files' },
  { kind: 'link', label: 'Links' },
  { kind: 'ink', label: 'Drawings' },
];

export function walk(layers: Layer[], visit: (layer: Layer) => void): void {
  for (const layer of layers) {
    visit(layer);
    walk(layer.children, visit);
  }
}

/** Whether any layer in `layers`, at any depth, passes `test`. */
export function someLayer(layers: Layer[], test: (layer: Layer) => boolean): boolean {
  return layers.some((l) => test(l) || someLayer(l.children, test));
}

/** The filters worth offering: only the kinds of layer and the note types that are actually on the canvas. */
export function filterOptions(layers: Layer[]): FilterOption[] {
  const kinds = new Set<LayerKind>();
  const types = new Set<string>();
  walk(layers, (l) => {
    kinds.add(l.kind);
    if (l.type) types.add(l.type);
  });
  const options: FilterOption[] = [{ value: ALL_LAYERS, label: 'All layers' }];
  for (const { kind, label } of KIND_ORDER) {
    if (!kinds.has(kind)) continue;
    options.push({ value: kindFilter(kind), label });
    // Each note type sits right after "Notes", so the two read as one list.
    if (kind === 'note') {
      for (const type of [...types].sort((a, b) => a.localeCompare(b))) options.push({ value: `type:${type}`, label: type });
    }
  }
  return options;
}

export function matchesFilter(layer: Layer, filter: string): boolean {
  if (filter === ALL_LAYERS) return true;
  if (filter.startsWith(KIND_PREFIX)) return layer.kind === filter.slice(KIND_PREFIX.length);
  if (filter.startsWith('type:')) return layer.type === filter.slice('type:'.length);
  return true;
}

/** The text a search looks at: the layer's name and, for a note, its type, or for a link, its URL. */
export function searchText(layer: Layer): string {
  return [layer.label, layer.type, layer.url !== layer.label ? layer.url : undefined].filter(Boolean).join(' ');
}

/**
 * Keep the layers that match, and the groups around them so a result still shows where it lives.
 * A group that doesn't match itself, but holds something that does, is kept and marked dimmed.
 * A group that matches keeps only its matching contents.
 */
export function filterLayers(layers: Layer[], keep: (layer: Layer) => boolean): Layer[] {
  return layers.flatMap((layer): Layer[] => {
    const children = filterLayers(layer.children, keep);
    const self = keep(layer);
    if (!self && children.length === 0) return [];
    return [{ ...layer, children, dimmed: !self }];
  });
}

/** The first layer that matches in its own right, top to bottom. */
export function firstMatch(layers: Layer[]): Layer | null {
  for (const layer of layers) {
    if (!layer.dimmed) return layer;
    const inside = firstMatch(layer.children);
    if (inside) return inside;
  }
  return null;
}

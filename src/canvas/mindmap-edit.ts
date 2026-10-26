import { parse } from 'pele';
import { NodeColor, colorFromToken, colorToken, isColorToken } from './node-colors.ts';
import { TextFormat, toggleFormat } from './mindmap-format.ts';

/** One node of a mindmap's source: the line that holds it and the lines under it. */
export interface MindmapItem {
  /** Index of its line in the source. */
  line: number;
  indent: number;
  /** Index in `items` of its parent, or -1 for the root. */
  parent: number;
  /** Index of the last line that belongs to it or to anything under it. */
  end: number;
  /** The id Pele draws it with (`data-id` in the SVG). */
  nodeId: string;
}

export interface Mindmap {
  lines: string[];
  items: MindmapItem[];
}

const SHAPE_RE = /^([^\s()[\]{}]*)(\(\(|\)\)|\{\{|\[|\(|\))(.*?)(\)\)|\(\(|\}\}|\]|\)|\()$/;
const INDENT_STEP = 2;
const NEW_LABEL = 'New idea';

const indentOf = (line: string): number => line.length - line.trimStart().length;
const isBlank = (line: string): boolean => line.trim() === '' || line.trim().startsWith('%%');
/** `::icon(...)` and `:::class` lines decorate the node above them. */
const isDecoration = (line: string): boolean => line.trim().startsWith('::');

/**
 * The nodes of a mindmap's source, in the order Pele draws them from, or null when the source can't be edited
 * this way: not a mindmap, a node Pele and this parser read differently (a label over several lines), or two
 * nodes with the same id, which can't be told apart in the drawing.
 */
export function readMindmap(source: string): Mindmap | null {
  const lines = source.split('\n');
  const header = lines.findIndex((l) => !isBlank(l));
  if (header < 0 || !/^mindmap\b/.test(lines[header].trim())) return null;
  let model;
  try {
    model = parse(source);
  } catch {
    return null;
  }
  if (model.type !== 'mindmap') return null;

  const items: MindmapItem[] = [];
  const stack: number[] = [];
  for (let i = header + 1; i < lines.length; i++) {
    const line = lines[i];
    if (isBlank(line)) continue;
    if (isDecoration(line)) {
      // It belongs to the node above, and so closes over every node that holds that one.
      for (let up = items.length - 1; up >= 0; up = items[up].parent) items[up].end = i;
      continue;
    }
    const indent = indentOf(line);
    while (stack.length > 0 && items[stack[stack.length - 1]].indent >= indent) stack.pop();
    const item: MindmapItem = { line: i, indent, parent: stack.length > 0 ? stack[stack.length - 1] : -1, end: i, nodeId: '' };
    // Everything under a node closes over its own end.
    for (const up of stack) items[up].end = i;
    stack.push(items.length);
    items.push(item);
  }
  if (items.length !== model.nodes.length || items.length === 0) return null;
  items.forEach((item, k) => { item.nodeId = model.nodes[k].nodeId; });
  if (new Set(items.map((i) => i.nodeId)).size !== items.length) return null;
  // Only one root: Mermaid takes a second top-level node as an error.
  if (items.filter((i) => i.parent < 0).length !== 1) return null;
  return { lines, items };
}

const joined = (lines: string[]): string => lines.join('\n');

const BREAK_RE = /<br\s*\/?>/gi;

/** What a node says as it is written in the source, without its id or the brackets round it. Line breaks are `<br/>`. */
function rawLabel(map: Mindmap, k: number): string {
  const text = map.lines[map.items[k].line].trim();
  const shaped = SHAPE_RE.exec(text);
  const label = shaped ? shaped[3] : text;
  return label.replace(/^"(.*)"$/, '$1');
}

/** What a node says, for editing: with real line breaks, and `**bold**` and `*italic*` as typed. */
export function labelOf(map: Mindmap, k: number): string {
  return fromStored(rawLabel(map, k).replace(BREAK_RE, '\n'));
}

const WIKILINK_SPLIT = /(\[\[[^\][]+\]\])/;

/**
 * Pele can't hold `[[` in a label that isn't quoted (and a quoted one needs a shape), but it draws any other
 * character. So a wikilink is kept in the source as `⟦Note⟧`, in a node that stays plain text, and is `[[Note]]`
 * wherever it is edited.
 */
const toStored = (label: string): string => label.replace(/\[\[([^\][]+)\]\]/g, '⟦$1⟧');
const fromStored = (label: string): string => label.replace(/⟦([^⟧]+)⟧/g, '[[$1]]');

/** Whether a label has a wikilink, in either form. */
export const hasWikilink = (label: string): boolean => /\[\[[^\][]+\]\]|⟦[^⟧]+⟧/.test(label);

/**
 * Text that is safe to write as a node's label: no brackets that would change its shape (a `[[wikilink]]` is
 * written as `⟦wikilink⟧`), and line breaks as `<br/>`.
 */
const clean = (text: string): string => text.split('\n')
  .map((line) => line.split(WIKILINK_SPLIT)
    .map((part, i) => (i % 2 === 1 ? toStored(part.replace(/["(){}]/g, '')) : part.replace(/[()[\]{}"]/g, '')))
    .join('')
    .replace(/\s+/g, ' ')
    .trim())
  .filter(Boolean)
  .join('<br/>');

/**
 * `label`, or the label with a number after it when another node already has it. Pele names a node by its text,
 * and can't tell two with the same name apart in the drawing.
 */
function unique(map: Mindmap, label: string, except = -1): string {
  const taken = new Set<string>();
  map.items.forEach((item, k) => {
    if (k === except) return;
    taken.add(item.nodeId);
    taken.add(rawLabel(map, k));
  });
  let candidate = label;
  for (let n = 2; taken.has(candidate); n++) candidate = `${label} ${n}`;
  return candidate;
}

export function rename(map: Mindmap, k: number, text: string): string {
  const cleaned = clean(text);
  if (!cleaned) return joined(map.lines);
  const label = unique(map, cleaned, k);
  const item = map.items[k];
  const line = map.lines[item.line];
  const body = line.trim();
  const shaped = SHAPE_RE.exec(body);
  const written = shaped && /^".*"$/.test(shaped[3]) ? `"${label}"` : label;
  const next = shaped ? `${shaped[1]}${shaped[2]}${written}${shaped[4]}` : label;
  const lines = [...map.lines];
  lines[item.line] = `${line.slice(0, item.indent)}${next}`;
  return joined(lines);
}

/** A new node under `k`, after its other children. Returns the new source and the new node's index. */
export function addChild(map: Mindmap, k: number): { source: string; index: number } {
  const item = map.items[k];
  const child = map.items.find((i) => i.parent === k);
  const lines = [...map.lines];
  lines.splice(item.end + 1, 0, `${' '.repeat(child ? child.indent : item.indent + INDENT_STEP)}${unique(map, NEW_LABEL)}`);
  // Items before the new line keep their index; the new one comes right after the last of this node's subtree.
  const index = map.items.filter((i) => i.line <= item.end).length;
  return { source: joined(lines), index };
}

/** A new node beside `k`, after it and what's under it (or before it).  The root has no siblings, so it gets a child. */
export function addSibling(map: Mindmap, k: number, before = false): { source: string; index: number } {
  const item = map.items[k];
  if (item.parent < 0) return addChild(map, k);
  const lines = [...map.lines];
  lines.splice(before ? item.line : item.end + 1, 0, `${' '.repeat(item.indent)}${unique(map, NEW_LABEL)}`);
  return { source: joined(lines), index: before ? k : map.items.filter((i) => i.line <= item.end).length };
}

/** Remove a node and everything under it. The root stays. Returns the node to select next. */
export function remove(map: Mindmap, k: number): { source: string; index: number } | null {
  const item = map.items[k];
  if (item.parent < 0) return null;
  const lines = [...map.lines];
  lines.splice(item.line, item.end - item.line + 1);
  const before = map.items.filter((i) => i.parent === item.parent && i.line < item.line);
  const target = before.length > 0 ? before[before.length - 1] : map.items[item.parent];
  return { source: joined(lines), index: map.items.indexOf(target) };
}

export type Direction = 'up' | 'down' | 'left' | 'right';

/** The node an arrow key moves to from `k`, or `k` when there is nowhere to go. */
export function neighbour(map: Mindmap, k: number, dir: Direction): number {
  const item = map.items[k];
  const siblings = map.items.map((_, i) => i).filter((i) => map.items[i].parent === item.parent);
  const at = siblings.indexOf(k);
  if (dir === 'left') return item.parent >= 0 ? item.parent : k;
  if (dir === 'right') return map.items.findIndex((i) => i.parent === k) >= 0 ? map.items.findIndex((i) => i.parent === k) : k;
  return siblings[Math.max(0, Math.min(siblings.length - 1, at + (dir === 'down' ? 1 : -1)))] ?? k;
}

const isDecorationLine = (line: string): boolean => line.trim().startsWith('::');
const isClassLine = (line: string): boolean => /^:::(?!:)/.test(line.trim());

/** Indexes of the lines that decorate node `k`: the `::icon` and `:::class` lines after its own, before the next node's. */
function decorationLines(map: Mindmap, k: number): number[] {
  const out: number[] = [];
  const stop = map.items[k + 1]?.line ?? map.lines.length;
  for (let i = map.items[k].line + 1; i < stop; i++) if (isDecorationLine(map.lines[i])) out.push(i);
  return out;
}

const classTokens = (line: string): string[] => line.trim().slice(3).trim().split(/\s+/).filter(Boolean);

export function colorOf(map: Mindmap, k: number): NodeColor | null {
  for (const i of decorationLines(map, k)) {
    if (!isClassLine(map.lines[i])) continue;
    for (const token of classTokens(map.lines[i])) {
      const color = colorFromToken(token);
      if (color) return color;
    }
  }
  return null;
}

/**
 * Give node `k` a colour, or none. Pele puts the classes of a `:::` line on the node, so the colour is one of
 * ours there; any other class the line has is kept.
 */
export function setColor(map: Mindmap, k: number, color: NodeColor | null): string {
  const token = colorToken(color);
  // A colour that isn't one changes nothing.
  if (color !== null && !token) return joined(map.lines);
  return editClasses(map, k, isColorToken, token);
}

/** Take the classes `drop` picks off node `k`'s `:::` lines, and put `add` on one, if there is one to add. */
function editClasses(map: Mindmap, k: number, drop: (token: string) => boolean, add: string): string {
  const lines = [...map.lines];
  const own = decorationLines(map, k).filter((i) => isClassLine(lines[i]));
  const kept = own.map((i) => classTokens(lines[i]).filter((t) => !drop(t)));
  const pad = ' '.repeat(map.items[k].indent + INDENT_STEP);
  const target = kept.findIndex((tokens) => tokens.length > 0);
  if (add) {
    if (target >= 0) kept[target].push(add);
    else if (own.length > 0) kept[0].push(add);
  }
  // From the bottom up, so the lines above keep their place.
  for (let n = own.length - 1; n >= 0; n--) {
    if (kept[n].length > 0) lines[own[n]] = `${pad}:::${kept[n].join(' ')}`;
    else lines.splice(own[n], 1);
  }
  if (add && own.length === 0) lines.splice(map.items[k].line + 1, 0, `${pad}:::${add}`);
  return joined(lines);
}

/** `setColor` for node `k` and everything under it. */
export function setBranchColor(source: string, k: number, color: NodeColor | null): string {
  let text = source;
  let map = readMindmap(text);
  if (!map) return source;
  const targets = map.items.map((_, i) => i).filter((i) => {
    for (let up = i; up >= 0; up = map!.items[up].parent) if (up === k) return true;
    return false;
  });
  for (const i of targets) {
    map = readMindmap(text);
    if (!map) return source;
    text = setColor(map, i, color);
  }
  return text;
}

export const MINDMAP_SHAPES = ['text', 'rounded', 'square', 'hexagon', 'cloud', 'bang', 'circle'] as const;
export type MindmapShape = typeof MINDMAP_SHAPES[number];

const DELIMITERS: Record<MindmapShape, [string, string]> = {
  text: ['', ''], rounded: ['(', ')'], square: ['[', ']'], hexagon: ['{{', '}}'], cloud: [')', '('], bang: ['))', '(('], circle: ['((', '))'],
};

export function shapeOf(map: Mindmap, k: number): MindmapShape {
  const shaped = SHAPE_RE.exec(map.lines[map.items[k].line].trim());
  const found = shaped ? MINDMAP_SHAPES.find((s) => DELIMITERS[s][0] === shaped[2]) : undefined;
  return found ?? 'text';
}

/** An id for a node that has none: its label's letters and digits, made different from every other node's. */
function freshId(map: Mindmap, label: string, except: number): string {
  const base = label.replace(/[^\p{L}\p{N}]+/gu, '') || 'node';
  const taken = new Set(map.items.filter((_, i) => i !== except).map((i) => i.nodeId));
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}${n}`;
  return id;
}

/** Change how node `k` is drawn. A plain-text node needs an id to carry a shape, and gives it up when it goes back to plain. */
export function setShape(map: Mindmap, k: number, shape: MindmapShape): string {
  const item = map.items[k];
  const line = map.lines[item.line];
  const body = line.trim();
  const shaped = SHAPE_RE.exec(body);
  const [open, close] = DELIMITERS[shape];
  let next: string;
  if (shape === 'text') {
    next = shaped ? toStored(rawLabel(map, k)) : body;
    // The label is now the node's id, so it can't be one another node already has.
    if (shaped && map.items.some((o, i) => i !== k && (o.nodeId === next || rawLabel(map, i) === next))) next = `${next} ${k}`;
  } else {
    next = `${shaped ? shaped[1] : freshId(map, body, k)}${open}${shaped ? shaped[3] : body}${close}`;
  }
  const lines = [...map.lines];
  lines[item.line] = `${line.slice(0, item.indent)}${next}`;
  return joined(lines);
}

const ICON_LINE_RE = /^::icon\(([^()]*)\)\s*$/;

/** The icon named on node `k`, as the source has it (`lucide-book`), or null. */
export function iconOf(map: Mindmap, k: number): string | null {
  for (const i of decorationLines(map, k)) {
    const found = ICON_LINE_RE.exec(map.lines[i].trim());
    if (found) return found[1].trim();
  }
  return null;
}

/** Give node `k` an icon, or none. Only plain names are written: nothing that could close the line's brackets early. */
export function setNodeIcon(map: Mindmap, k: number, name: string | null): string {
  if (name !== null && !/^[\w-]+$/.test(name)) return joined(map.lines);
  const lines = [...map.lines];
  const existing = decorationLines(map, k).find((i) => ICON_LINE_RE.test(lines[i].trim()));
  const pad = ' '.repeat(map.items[k].indent + INDENT_STEP);
  if (existing !== undefined) {
    if (name === null) lines.splice(existing, 1);
    else lines[existing] = `${pad}::icon(${name})`;
  } else if (name !== null) {
    lines.splice(map.items[k].line + 1, 0, `${pad}::icon(${name})`);
  }
  return joined(lines);
}

/** The indexes of node `k`'s siblings: the other children of its parent. The root has none. */
export function siblingsOf(map: Mindmap, k: number): number[] {
  const parent = map.items[k].parent;
  return parent < 0 ? [] : map.items.map((_, i) => i).filter((i) => i !== k && map.items[i].parent === parent);
}

/** Whether node `i` is node `k` or anywhere under it. */
export function isWithin(map: Mindmap, i: number, k: number): boolean {
  for (let up = i; up >= 0; up = map.items[up].parent) if (up === k) return true;
  return false;
}

/** Where a moved node goes: beside the target (before or after it), or inside it as its last child. */
export type Placement = 'before' | 'after' | 'inside';

/**
 * Move node `k`, with everything under it, to a place beside or inside `target`. Not into itself or what is under it,
 * and nothing goes beside the root. Returns the new source and where the node is in it, or null when that leaves it
 * where it was.
 */
export function moveNode(map: Mindmap, k: number, target: number, place: Placement): { source: string; index: number } | null {
  const item = map.items[k];
  const other = map.items[target];
  if (item.parent < 0 || isWithin(map, target, k)) return null;
  if (place !== 'inside' && other.parent < 0) return null;
  const block = map.lines.slice(item.line, item.end + 1);
  // The block takes the indent of the nodes it goes among: its new siblings, or the target's children.
  const firstChild = map.items.find((i) => i.parent === target);
  const indent = place === 'inside' ? (firstChild ? firstChild.indent : other.indent + INDENT_STEP) : other.indent;
  const shift = indent - item.indent;
  const moved = shift === 0 ? block : block.map((l) => (shift > 0 ? ' '.repeat(shift) + l : l.slice(Math.min(-shift, indentOf(l)))));
  const rest = [...map.lines.slice(0, item.line), ...map.lines.slice(item.end + 1)];
  const gone = item.end - item.line + 1;
  const spot = place === 'before' ? other.line : other.end + 1;
  const at = spot > item.line ? spot - gone : spot;
  rest.splice(at, 0, ...moved);
  const source = joined(rest);
  if (source === joined(map.lines)) return null;
  const next = readMindmap(source);
  const index = next ? next.items.findIndex((i) => i.line === at) : -1;
  return next && index >= 0 ? { source, index } : null;
}

/** Whether node `k`'s whole text has `format` on. */
export function isLabelFormatted(map: Mindmap, k: number, format: TextFormat): boolean {
  const label = labelOf(map, k);
  return toggleFormat(label, 0, label.length, format).value.length < label.length;
}

/** Turn `format` on or off for all of node `k`'s text. */
export function toggleLabelFormat(map: Mindmap, k: number, format: TextFormat): string {
  const label = labelOf(map, k);
  return rename(map, k, toggleFormat(label, 0, label.length, format).value);
}

/** Ways to move node `k` (with what is under it) among the nodes round it. */
export type Relocation = 'up' | 'down' | 'indent' | 'outdent';

/**
 * Move a node up or down among its siblings, in under the sibling above it (indent), or out to just after its
 * parent (outdent). Null where there is nowhere to go: the root, the first or last of its siblings, or a child
 * of the root, which has no siblings to go out to.
 */
export function relocate(map: Mindmap, k: number, kind: Relocation): { source: string; index: number } | null {
  const item = map.items[k];
  if (item.parent < 0) return null;
  const siblings = map.items.map((_, i) => i).filter((i) => map.items[i].parent === item.parent);
  const at = siblings.indexOf(k);
  if (kind === 'up') return at > 0 ? moveNode(map, k, siblings[at - 1], 'before') : null;
  if (kind === 'down') return at < siblings.length - 1 ? moveNode(map, k, siblings[at + 1], 'after') : null;
  if (kind === 'indent') return at > 0 ? moveNode(map, k, siblings[at - 1], 'inside') : null;
  return map.items[item.parent].parent >= 0 ? moveNode(map, k, item.parent, 'after') : null;
}

/** One line of an outline: how deep it is (0 for the shallowest), and its words. */
export interface OutlineEntry {
  depth: number;
  text: string;
}

const BULLET_RE = /^(\s*)(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/;

/**
 * Read pasted text as an outline: one node a line, nested by indentation (a tab counts as four spaces), with a
 * list's bullets, numbers and checkboxes dropped. Lines with nothing in them are skipped.
 */
export function parseOutline(text: string): OutlineEntry[] {
  const rows: Array<{ width: number; text: string }> = [];
  for (const line of text.replace(/\r/g, '').split('\n')) {
    const bullet = BULLET_RE.exec(line);
    const indent = (bullet ? bullet[1] : /^\s*/.exec(line)?.[0] ?? '').replace(/\t/g, '    ').length;
    const words = (bullet ? bullet[2] : line).trim();
    if (words) rows.push({ width: indent, text: words });
  }
  const stack: number[] = [];
  return rows.map(({ width, text: words }) => {
    while (stack.length > 0 && stack[stack.length - 1] >= width) stack.pop();
    stack.push(width);
    return { depth: stack.length - 1, text: words };
  });
}

/** Node `k` and what is under it as a markdown list, tab-indented, for the clipboard. */
export function outlineOf(map: Mindmap, k: number): string {
  const base = depthOf(map, k);
  return map.items
    .map((_, i) => i)
    .filter((i) => isWithin(map, i, k))
    .map((i) => `${'\t'.repeat(depthOf(map, i) - base)}- ${labelOf(map, i).replace(/\n/g, ' ')}`)
    .join('\n');
}

function depthOf(map: Mindmap, k: number): number {
  let depth = 0;
  for (let up = map.items[k].parent; up >= 0; up = map.items[up].parent) depth++;
  return depth;
}

/** Every name a node in `map` already has, which a new one can't take. */
function takenNames(map: Mindmap): Set<string> {
  const taken = new Set<string>();
  map.items.forEach((item, i) => {
    taken.add(item.nodeId);
    taken.add(rawLabel(map, i));
  });
  return taken;
}

function freeName(taken: Set<string>, name: string): string {
  let candidate = name;
  for (let n = 2; taken.has(candidate); n++) candidate = `${name} ${n}`;
  taken.add(candidate);
  return candidate;
}

/** An id (which can't hold a space) that is free: `id` with a number after it when it is taken. */
function freeId(taken: Set<string>, id: string): string {
  let candidate = id;
  for (let n = 2; taken.has(candidate); n++) candidate = `${id}${n}`;
  taken.add(candidate);
  return candidate;
}

/** The index the first node added under `k` will have: after every node that starts before the end of `k`'s block. */
const firstNewIndex = (map: Mindmap, k: number): number => map.items.filter((i) => i.line <= map.items[k].end).length;

/** Add an outline under node `k`, after its children. Returns the new source and the first new node's index. */
export function pasteOutline(map: Mindmap, k: number, entries: OutlineEntry[]): { source: string; index: number } | null {
  const item = map.items[k];
  const taken = takenNames(map);
  const child = map.items.find((i) => i.parent === k);
  const base = child ? child.indent : item.indent + INDENT_STEP;
  const added: string[] = [];
  const depths: number[] = [];
  for (const entry of entries) {
    const label = clean(entry.text);
    if (!label) continue;
    // A node can't be deeper than one below the one before it.
    const depth = Math.min(entry.depth, depths.length === 0 ? 0 : depths[depths.length - 1] + 1);
    depths.push(depth);
    added.push(`${' '.repeat(base + depth * INDENT_STEP)}${freeName(taken, label)}`);
  }
  if (added.length === 0) return null;
  const lines = [...map.lines];
  lines.splice(item.end + 1, 0, ...added);
  return { source: joined(lines), index: firstNewIndex(map, k) };
}

/** A copy of node `k` and what is under it, right after it. Each copy's name gets a number, so it is a different node. */
export function duplicateNode(map: Mindmap, k: number): { source: string; index: number } | null {
  const item = map.items[k];
  if (item.parent < 0) return null;
  const taken = takenNames(map);
  const lines = [...map.lines];
  const block = lines.slice(item.line, item.end + 1);
  map.items.forEach((other, i) => {
    if (!isWithin(map, i, k)) return;
    const at = other.line - item.line;
    const line = block[at];
    const body = line.trim();
    const shaped = SHAPE_RE.exec(body);
    const pad = line.slice(0, other.indent);
    if (shaped && shaped[1]) block[at] = `${pad}${freeId(taken, shaped[1])}${shaped[2]}${shaped[3]}${shaped[4]}`;
    else if (shaped) block[at] = `${pad}${shaped[1]}${shaped[2]}${freeName(taken, shaped[3])}${shaped[4]}`;
    else block[at] = `${pad}${freeName(taken, body)}`;
  });
  lines.splice(item.end + 1, 0, ...block);
  const source = joined(lines);
  const next = readMindmap(source);
  const index = next ? next.items.findIndex((i) => i.line === item.end + 1) : -1;
  return next && index >= 0 ? { source, index } : null;
}

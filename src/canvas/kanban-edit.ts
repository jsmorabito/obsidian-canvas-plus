import { parse } from 'pele';

/** A column or a card of a kanban's source: the line that holds it and the lines that go with it. */
interface KanbanNode {
  /** Index of its line in the source. */
  line: number;
  /** Index of the last line that belongs to it (its `::icon` and `:::class` lines), and for a column, to its cards. */
  end: number;
  indent: number;
  /** What comes before the text on the line (the id and the bracket that opens it); empty when the text stands alone. */
  head: string;
  /** The bracket that closes the text, and the `@{ … }` data after it. */
  tail: string;
  /** The text, as Pele draws it. */
  label: string;
  /** Whether the line writes the text in quotes. */
  quoted: boolean;
  /** The id the line gives, or empty. */
  id: string;
}

export interface KanbanColumn extends KanbanNode {
  /** Indexes in `Kanban.cards` of its cards, from top to bottom. */
  cards: number[];
}

export interface KanbanCard extends KanbanNode {
  /** Index in `Kanban.columns` of the column it is in. */
  column: number;
}

/** Pele draws columns and cards in the order the source has them, which is how the drawing is matched to the source. */
export interface Kanban {
  lines: string[];
  columns: KanbanColumn[];
  cards: KanbanCard[];
}

/** What is picked: a column, or a card, by its place in `Kanban.columns` or `Kanban.cards`. */
export interface Pick {
  kind: 'column' | 'card';
  i: number;
}

export interface Edit {
  source: string;
  pick: Pick;
}

export type Direction = 'up' | 'down' | 'left' | 'right';

const INDENT_STEP = 2;
const NEW_CARD = 'New card';
const NEW_COLUMN = 'New column';

const indentOf = (line: string): number => line.length - line.trimStart().length;
const isBlank = (line: string): boolean => line.trim() === '' || line.trim().startsWith('%%');
/** `::icon(...)` and `:::class` lines decorate the node above them. */
const isDecoration = (line: string): boolean => line.trim().startsWith('::');

const META_RE = /\s*(@\{.*\})\s*$/;
/** An id and a label in a bracket, as Pele reads them: `id[text]`, `id(text)`, `id((text))` and `{{text}}`. */
const SHAPE_RE = /^([^()[\]{}]*)(\[|\(\(|\(|\{\{)(.*)(\]|\)\)|\)|\}\})$/;
const CLOSES: Record<string, string> = { '[': ']', '((': '))', '(': ')', '{{': '}}' };

/** Whether text can stand alone on a line, which Pele would otherwise read as an id, a bracket, data or a decoration. */
function isPlain(text: string): boolean {
  return /^[^\s[\](){}@":%][^[\](){}@]*$/.test(text);
}

/** Text as one line, that Pele can draw. */
function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Parse one line of a column or a card. Null when it doesn't read the way Pele does. */
function parseLine(line: string, index: number): KanbanNode | null {
  const indent = indentOf(line);
  let body = line.trim();
  let data = '';
  const meta = META_RE.exec(body);
  if (meta) {
    // Pele wants the space before the data kept as it was written: `id[text]@{ … }` has none.
    data = meta[0].trimEnd();
    body = body.slice(0, meta.index);
  }
  const shape = SHAPE_RE.exec(body);
  let head = '';
  let tail = data;
  let label = body;
  let id = '';
  if (shape) {
    const open = shape[2];
    if (shape[4] !== CLOSES[open]) return null;
    id = shape[1].trim();
    head = shape[1] + open;
    tail = shape[4] + data;
    label = shape[3];
  }
  // Quotes only mean something inside a bracket; text standing alone keeps them.
  const quote = shape ? /^"(.*)"$/s.exec(label.trim()) : null;
  const quoted = !!quote;
  if (quote) label = quote[1];
  return { line: index, end: index, indent, head, tail, label: label.trim(), quoted, id };
}

/**
 * The columns and cards of a kanban's source, or null when the source can't be edited this way: not a kanban, one
 * Pele can't draw, or one this parser reads differently from Pele (a line it doesn't understand).
 */
export function readKanban(source: string): Kanban | null {
  if (reads.has(source)) return reads.get(source) ?? null;
  // A handful of boards at most are read over and over (on every sweep and pointer move), so the reads are kept.
  if (reads.size >= MAX_READS) reads.clear();
  const kanban = parseKanban(source);
  reads.set(source, kanban);
  return kanban;
}

const reads = new Map<string, Kanban | null>();
const MAX_READS = 16;

function parseKanban(source: string): Kanban | null {
  const lines = source.split('\n');
  let header = lines.findIndex((l) => !isBlank(l));
  // Front matter comes before the header.
  if (header >= 0 && lines[header].trim() === '---') {
    const close = lines.findIndex((l, i) => i > header && l.trim() === '---');
    if (close < 0) return null;
    header = lines.findIndex((l, i) => i > close && !isBlank(l));
  }
  if (header < 0 || !/^kanban\b/.test(lines[header].trim())) return null;
  let model;
  try {
    model = parse(source);
  } catch {
    return null;
  }
  if (model.type !== 'kanban') return null;

  const columns: KanbanColumn[] = [];
  const cards: KanbanCard[] = [];
  let columnIndent = -1;
  let last: KanbanNode | null = null;
  for (let i = header + 1; i < lines.length; i++) {
    const line = lines[i];
    if (isBlank(line)) continue;
    if (/\t/.test(line.slice(0, indentOf(line)))) return null;
    if (isDecoration(line)) {
      // It belongs to the node above, and so closes over the column that holds that one.
      if (!last) return null;
      last.end = i;
      columns[columns.length - 1].end = i;
      continue;
    }
    const node = parseLine(line, i);
    if (!node) return null;
    if (columnIndent < 0) columnIndent = node.indent;
    if (node.indent < columnIndent) return null;
    if (node.indent === columnIndent) {
      const column: KanbanColumn = { ...node, cards: [] };
      columns.push(column);
      last = column;
    } else {
      const column = columns[columns.length - 1];
      const card: KanbanCard = { ...node, column: columns.length - 1 };
      cards.push(card);
      column.cards.push(cards.length - 1);
      column.end = i;
      last = card;
    }
  }

  // The same columns and cards as Pele has, in the same order, or the drawing can't be matched to the source.
  const sections = model.sections;
  if (sections.length !== columns.length) return null;
  const same = sections.every((section, c) => (
    section.label === columns[c].label
    && section.items.length === columns[c].cards.length
    && section.items.every((item, n) => item.label === cards[columns[c].cards[n]].label)
  ));
  return same ? { lines, columns, cards } : null;
}

/** The text of a column or a card, as it is drawn. */
export function labelOf(k: Kanban, pick: Pick): string {
  return (pick.kind === 'column' ? k.columns[pick.i] : k.cards[pick.i]).label;
}

/** The line for a node with this text, keeping what the line had besides its text. */
function lineFor(k: Kanban, node: KanbanNode, text: string, taken?: Set<string>): string {
  const label = cleanText(text);
  const spaces = ' '.repeat(node.indent);
  if (node.head) {
    const bare = !/[[\](){}"]/.test(label);
    return `${spaces}${node.head}${node.quoted || !bare ? `"${label.replace(/"/g, "'")}"` : label}${node.tail}`;
  }
  if (isPlain(label)) return `${spaces}${label}${node.tail}`;
  // Text Pele would read as something else goes in quotes, which needs an id.
  return `${spaces}${freshId(k, taken)}["${label.replace(/"/g, "'")}"]${node.tail}`;
}

/** An id no column or card has, and none in `taken`, which it is added to (for several lines written together). */
function freshId(k: Kanban, taken = new Set<string>()): string {
  const used = new Set([...k.columns, ...k.cards].map((n) => n.id));
  let n = 1;
  while (used.has(`c${n}`) || taken.has(`c${n}`)) n++;
  taken.add(`c${n}`);
  return `c${n}`;
}

/** A new node's line: its text alone where that can be, else under an id. */
function newLine(k: Kanban, indent: number, text: string, taken?: Set<string>): string {
  return lineFor(k, { line: 0, end: 0, indent, head: '', tail: '', label: '', quoted: false, id: '' }, text, taken);
}

/** The read of `source`, picking the node that has `line`. A source that can't be read leaves the pick as it was. */
function pickAt(source: string, line: number, kind: Pick['kind'], fallback: Pick): Edit {
  const next = readKanban(source);
  const i = next ? (kind === 'column' ? next.columns : next.cards).findIndex((n) => n.line === line) : -1;
  return { source, pick: i >= 0 ? { kind, i } : fallback };
}

/** Change the text of a column or a card. Null when the text is empty or unchanged. */
export function rename(k: Kanban, pick: Pick, text: string): Edit | null {
  const node = pick.kind === 'column' ? k.columns[pick.i] : k.cards[pick.i];
  const label = cleanText(text);
  if (!label || label === node.label) return null;
  const lines = k.lines.slice();
  lines[node.line] = lineFor(k, node, label);
  return { source: lines.join('\n'), pick };
}

/**
 * Add a card to column `column`: under card `after` when given, else at the bottom of the column. The new card
 * is picked.
 */
export function addCard(k: Kanban, column: number, after?: number): Edit {
  const col = k.columns[column];
  const below = after !== undefined && k.cards[after]?.column === column ? k.cards[after] : null;
  const at = (below ?? col).end + 1;
  const indent = below ? below.indent : col.indent + INDENT_STEP;
  const lines = k.lines.slice();
  lines.splice(at, 0, newLine(k, indent, NEW_CARD));
  return pickAt(lines.join('\n'), at, 'card', { kind: 'column', i: column });
}

/**
 * Add cards with these texts to column `column`, above card `before` (a card of that column) or at the bottom when that
 * isn't given. Empty texts are left out. The first new card is picked. Null when there is nothing to add. With `keyed`,
 * every card is written under an id of its own, which comes back in `ids` in the order of the cards added: it is what
 * something is kept against.
 */
export function addCards(
  k: Kanban, column: number, texts: readonly string[], before?: number, keyed = false, data: readonly string[] = [],
): (Edit & { ids: string[] }) | null {
  // `data` is written after each keyed card: its `@{ … }` data.
  const entries = texts.map((text, n) => ({ text: cleanText(text), data: data[n] ?? '' })).filter((e) => e.text);
  const words = entries.map((e) => e.text);
  if (words.length === 0) return null;
  const col = k.columns[column];
  const target = before !== undefined && k.cards[before]?.column === column ? k.cards[before] : null;
  const last = col.cards.length > 0 ? k.cards[col.cards[col.cards.length - 1]] : null;
  const at = target ? target.line : col.end + 1;
  const indent = target?.indent ?? last?.indent ?? col.indent + INDENT_STEP;
  const taken = new Set<string>();
  const ids: string[] = [];
  const written = entries.map(({ text, data: extra }) => {
    if (!keyed) return newLine(k, indent, text, taken);
    const id = freshId(k, taken);
    ids.push(id);
    return `${' '.repeat(indent)}${id}["${text.replace(/"/g, "'")}"]${extra}`;
  });
  const lines = k.lines.slice();
  lines.splice(at, 0, ...written);
  return { ...pickAt(lines.join('\n'), at, 'card', { kind: 'column', i: column }), ids };
}

/** Add a card above card `before`. The new card is picked. */
export function addCardBefore(k: Kanban, before: number): Edit {
  const card = k.cards[before];
  const lines = k.lines.slice();
  lines.splice(card.line, 0, newLine(k, card.indent, NEW_CARD));
  return pickAt(lines.join('\n'), card.line, 'card', { kind: 'card', i: before });
}

/** Add a column to the right of column `after`, or at the end. The new column is picked. */
export function addColumn(k: Kanban, after?: number): Edit {
  const last = k.columns[after ?? k.columns.length - 1];
  const at = last ? last.end + 1 : k.lines.length;
  const lines = k.lines.slice();
  lines.splice(at, 0, newLine(k, last ? last.indent : INDENT_STEP, NEW_COLUMN));
  return pickAt(lines.join('\n'), at, 'column', { kind: 'column', i: after ?? 0 });
}

/** Remove a card, or a column with its cards (not the last one). Picks what is next to it. */
export function remove(k: Kanban, pick: Pick): Edit | null {
  // A kanban with no column isn't one Pele can draw.
  if (pick.kind === 'column' && k.columns.length < 2) return null;
  const node = pick.kind === 'column' ? k.columns[pick.i] : k.cards[pick.i];
  const lines = k.lines.slice();
  lines.splice(node.line, node.end - node.line + 1);
  const source = lines.join('\n');
  if (pick.kind === 'column') return { source, pick: { kind: 'column', i: Math.min(pick.i, k.columns.length - 2) } };
  const column = k.columns[(node as KanbanCard).column];
  const siblings = column.cards;
  const n = siblings.indexOf(pick.i);
  // The card that takes its place, else the one above it, else the column.
  const stay = siblings[n + 1] !== undefined ? pick.i : siblings[n - 1] !== undefined ? siblings[n - 1] : -1;
  return { source, pick: stay >= 0 ? { kind: 'card', i: stay } : { kind: 'column', i: (node as KanbanCard).column } };
}

/** `lines` with the block from `from` to `to` moved so that it starts at line `at` of the original. Null when it doesn't move. */
function relocate(lines: string[], from: number, to: number, at: number): { lines: string[]; start: number } | null {
  if (at >= from && at <= to + 1) return null;
  const block = lines.slice(from, to + 1);
  const rest = [...lines.slice(0, from), ...lines.slice(to + 1)];
  const start = at > to ? at - block.length : at;
  rest.splice(start, 0, ...block);
  return { lines: rest, start };
}

/**
 * Move a card into column `column`, above card `before` (a card of that column) or at the bottom when that isn't
 * given. Null when it stays where it is.
 */
export function moveCard(k: Kanban, card: number, column: number, before?: number): Edit | null {
  const moving = k.cards[card];
  if (before === card) return null;
  const target = before !== undefined && k.cards[before]?.column === column ? k.cards[before] : null;
  const at = target ? target.line : k.columns[column].end + 1;
  const moved = relocate(k.lines, moving.line, moving.end, at);
  if (!moved) return null;
  return pickAt(moved.lines.join('\n'), moved.start, 'card', { kind: 'card', i: card });
}

/** Move a column before column `before`, or to the end when that isn't given. Null when it stays where it is. */
export function moveColumn(k: Kanban, column: number, before?: number): Edit | null {
  const moving = k.columns[column];
  if (before === column) return null;
  const target = before !== undefined ? k.columns[before] ?? null : null;
  const at = target ? target.line : k.columns[k.columns.length - 1].end + 1;
  const moved = relocate(k.lines, moving.line, moving.end, at);
  if (!moved) return null;
  return pickAt(moved.lines.join('\n'), moved.start, 'column', { kind: 'column', i: column });
}

/** Move the picked card or column one place in a direction: a card within its column or into the next, a column along the row. */
export function shift(k: Kanban, pick: Pick, dir: Direction): Edit | null {
  if (pick.kind === 'column') {
    if (dir === 'left') return pick.i > 0 ? moveColumn(k, pick.i, pick.i - 1) : null;
    if (dir === 'right') return pick.i < k.columns.length - 1 ? moveColumn(k, pick.i, pick.i + 2 < k.columns.length ? pick.i + 2 : undefined) : null;
    return null;
  }
  const card = k.cards[pick.i];
  const own = k.columns[card.column].cards;
  const n = own.indexOf(pick.i);
  if (dir === 'up') return n > 0 ? moveCard(k, pick.i, card.column, own[n - 1]) : null;
  if (dir === 'down') return n < own.length - 1 ? moveCard(k, pick.i, card.column, own[n + 2]) : null;
  const column = card.column + (dir === 'left' ? -1 : 1);
  if (column < 0 || column >= k.columns.length) return null;
  // Across, it keeps its place from the top, as far as the other column goes.
  return moveCard(k, pick.i, column, k.columns[column].cards[n]);
}

/** The column or card to pick when the arrow keys move from `pick`. Stays put at an edge. */
export function neighbour(k: Kanban, pick: Pick, dir: Direction): Pick {
  if (pick.kind === 'column') {
    if (dir === 'left') return { kind: 'column', i: Math.max(pick.i - 1, 0) };
    if (dir === 'right') return { kind: 'column', i: Math.min(pick.i + 1, k.columns.length - 1) };
    const first = k.columns[pick.i].cards[0];
    return dir === 'down' && first !== undefined ? { kind: 'card', i: first } : pick;
  }
  const card = k.cards[pick.i];
  const own = k.columns[card.column].cards;
  const n = own.indexOf(pick.i);
  if (dir === 'up') return n > 0 ? { kind: 'card', i: own[n - 1] } : { kind: 'column', i: card.column };
  if (dir === 'down') return n < own.length - 1 ? { kind: 'card', i: own[n + 1] } : pick;
  const column = card.column + (dir === 'left' ? -1 : 1);
  if (column < 0 || column >= k.columns.length) return pick;
  const there = k.columns[column].cards;
  if (there.length === 0) return { kind: 'column', i: column };
  return { kind: 'card', i: there[Math.min(n, there.length - 1)] };
}

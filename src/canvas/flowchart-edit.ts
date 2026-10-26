/**
 * Editing a flowchart's Mermaid source as nodes and edges. The source is read into the places each node and edge
 * is written, and every change is a patch to those places, so whatever else the source holds (classDef, subgraphs,
 * comments, the way it is laid out) stays as it is. Source that uses what this can't patch safely (several nodes
 * joined with `&`, edge ids, the newer `@{ }` shapes) is not read, and the diagram stays editable as text only.
 */

export type FlowShape =
  | 'rect' | 'rounded' | 'stadium' | 'subroutine' | 'cylinder' | 'circle' | 'asymmetric' | 'diamond' | 'hexagon'
  | 'parallelogram' | 'parallelogram-alt' | 'trapezoid' | 'trapezoid-alt' | 'double-circle';

/** How a shape is written: its opening and closing marks. */
export const FLOW_SHAPES: Record<FlowShape, [string, string]> = {
  rect: ['[', ']'],
  rounded: ['(', ')'],
  stadium: ['([', '])'],
  subroutine: ['[[', ']]'],
  cylinder: ['[(', ')]'],
  circle: ['((', '))'],
  asymmetric: ['>', ']'],
  diamond: ['{', '}'],
  hexagon: ['{{', '}}'],
  parallelogram: ['[/', '/]'],
  'parallelogram-alt': ['[\\', '\\]'],
  trapezoid: ['[/', '\\]'],
  'trapezoid-alt': ['[\\', '/]'],
  'double-circle': ['(((', ')))'],
};

/** Longest first, so `[[` is not read as `[`. */
const OPENERS = Object.values(FLOW_SHAPES).map(([open]) => open).filter((o, i, all) => all.indexOf(o) === i).sort((a, b) => b.length - a.length);

const closersFor = (open: string): string[] => Object.values(FLOW_SHAPES).filter(([o]) => o === open).map(([, c]) => c);

function shapeOf(open: string, close: string): FlowShape {
  const found = (Object.keys(FLOW_SHAPES) as FlowShape[]).find((s) => FLOW_SHAPES[s][0] === open && FLOW_SHAPES[s][1] === close);
  return found ?? 'rect';
}

/** One place a node is written: its id, and its text when it is given one there. */
export interface Occurrence {
  id: string;
  /** The span of the line it takes: id, shape and `:::class`. */
  start: number;
  end: number;
  shape: { kind: FlowShape; open: string; close: string; textStart: number; textEnd: number } | null;
}

/** An edge as written: the span of its arrow and its `|label|`. */
export interface FlowEdge {
  /** Where the statement is, and which of its nodes it joins (`from` and `from + 1`). */
  statement: number;
  from: number;
  fromId: string;
  toId: string;
  op: string;
  opStart: number;
  /** After the arrow and any label. */
  end: number;
  label: { start: number; end: number; text: string } | null;
  /** The id Pele draws it with. */
  domId: string;
}

interface Statement {
  line: number;
  indent: number;
  occurrences: Occurrence[];
  edges: FlowEdge[];
}

/** A line about the diagram as a whole, which is kept as written and read only for the nodes and edges it names. */
interface Other {
  line: number;
  kind: 'class' | 'style' | 'linkStyle' | 'click' | 'other';
}

export interface Flowchart {
  lines: string[];
  /** Index of the `flowchart` line, and which way it runs. */
  header: number;
  direction: string;
  statements: Statement[];
  others: Other[];
  /** In order of appearance, which is the order Pele and `linkStyle` number them in. */
  edges: FlowEdge[];
  ids: Set<string>;
}

const ID_RE = /[\p{L}\p{N}_]+/uy;
const CLASS_SUFFIX_RE = /:::[\w-]+/y;
// An arrow needs a head, or three or more dashes to be a line: a bare `--` begins an arrow with text in it (`A -- yes --> B`),
// which is not read, rather than read as two nodes.
const OP_RE = /[ox<]?(?:-{2,}[>ox]|-{3,}|={2,}[>ox]|={3,}|-\.+-[>ox]?)/y;

function skipSpace(text: string, pos: number): number {
  let i = pos;
  while (i < text.length && (text[i] === ' ' || text[i] === '\t')) i++;
  return i;
}

/** The end of a shape's text: the first of its closing marks that is not inside quotes. */
function findClose(text: string, from: number, closes: string[]): { at: number; close: string } | null {
  let quoted = false;
  for (let i = from; i < text.length; i++) {
    if (text[i] === '"') {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    const close = closes.find((c) => text.startsWith(c, i));
    if (close) return { at: i, close };
  }
  return null;
}

function scanOccurrence(text: string, pos: number): Occurrence | null {
  ID_RE.lastIndex = pos;
  const id = ID_RE.exec(text);
  if (!id) return null;
  let end = pos + id[0].length;
  let shape: Occurrence['shape'] = null;
  const open = OPENERS.find((o) => text.startsWith(o, end));
  if (open) {
    const found = findClose(text, end + open.length, closersFor(open));
    if (!found) return null;
    shape = { kind: shapeOf(open, found.close), open, close: found.close, textStart: end + open.length, textEnd: found.at };
    end = found.at + found.close.length;
  }
  CLASS_SUFFIX_RE.lastIndex = end;
  const suffix = CLASS_SUFFIX_RE.exec(text);
  if (suffix) end += suffix[0].length;
  return { id: id[0], start: pos, end, shape };
}

/** Read one line as nodes joined by edges, or null when it holds something else. */
function scanStatement(text: string, offset: number, line: number, indent: number): Statement | null {
  const occurrences: Occurrence[] = [];
  const edges: FlowEdge[] = [];
  const pending: Array<{ op: string; opStart: number; end: number; label: FlowEdge['label'] }> = [];
  let pos = skipSpace(text, 0);
  for (;;) {
    const occurrence = scanOccurrence(text, pos);
    if (!occurrence) return null;
    occurrences.push({ ...occurrence, start: occurrence.start + offset, end: occurrence.end + offset, shape: occurrence.shape && {
      ...occurrence.shape, textStart: occurrence.shape.textStart + offset, textEnd: occurrence.shape.textEnd + offset,
    } });
    pos = skipSpace(text, occurrence.end);
    if (pos >= text.length) break;
    OP_RE.lastIndex = pos;
    const op = OP_RE.exec(text);
    if (!op) return null;
    const opStart = pos;
    pos += op[0].length;
    let label: FlowEdge['label'] = null;
    if (text[pos] === '|') {
      const close = text.indexOf('|', pos + 1);
      if (close < 0) return null;
      label = { start: pos + offset, end: close + 1 + offset, text: text.slice(pos + 1, close) };
      pos = close + 1;
    }
    pending.push({ op: op[0], opStart: opStart + offset, end: pos + offset, label });
    pos = skipSpace(text, pos);
  }
  pending.forEach((p, i) => {
    edges.push({
      statement: -1, from: i, fromId: occurrences[i].id, toId: occurrences[i + 1].id, op: p.op, opStart: p.opStart, end: p.end,
      label: p.label, domId: '',
    });
  });
  return { line, indent, occurrences, edges };
}

const HEADER_RE = /^(?:flowchart|graph)(?:-v2)?(?:\s+(TB|TD|BT|RL|LR))?\s*;?$/;

/**
 * Read flowchart source, or null when it isn't one, or uses what can't be patched safely. `problem`, given, says which
 * line (counting from 0) stopped it, or -1 when it is not a flowchart at all.
 */
export function readFlowchart(source: string, problem?: { line: number }): Flowchart | null {
  if (problem) problem.line = -1;
  const lines = source.split('\n');
  let i = 0;
  // Front matter, then the diagram's own first line.
  while (i < lines.length && lines[i].trim() === '') i++;
  if (lines[i]?.trim() === '---') {
    i++;
    while (i < lines.length && lines[i].trim() !== '---') i++;
    i++;
  }
  const isComment = (l: string): boolean => l.trim() === '' || l.trim().startsWith('%%');
  while (i < lines.length && isComment(lines[i])) i++;
  const head = HEADER_RE.exec(lines[i]?.trim() ?? '');
  if (!head) return null;
  const header = i;
  const statements: Statement[] = [];
  const others: Other[] = [];
  for (let n = header + 1; n < lines.length; n++) {
    const raw = lines[n];
    if (isComment(raw)) continue;
    const trimmed = raw.trim().replace(/;$/, '').trimEnd();
    const indent = raw.length - raw.trimStart().length;
    const word = /^[A-Za-z]+/.exec(trimmed)?.[0] ?? '';
    // A node id can be one of these words, but `end --> x` is not a statement of theirs.
    const asWord = /^(subgraph|end|direction|classDef|class|style|linkStyle|click|accTitle|accDescr|title)\b(?!\s*(?:-|=|o-|x-|<-))/.exec(trimmed);
    if (asWord) {
      const kind = word === 'class' || word === 'style' || word === 'linkStyle' || word === 'click' ? word : 'other';
      others.push({ line: n, kind });
      continue;
    }
    const statement = trimmed.includes('&') ? null : scanStatement(trimmed, indent, n, indent);
    if (!statement) {
      if (problem) problem.line = n;
      return null;
    }
    statements.push(statement);
  }
  const edges: FlowEdge[] = [];
  const pairs = new Map<string, number>();
  const ids = new Set<string>();
  statements.forEach((statement, s) => {
    for (const occurrence of statement.occurrences) ids.add(occurrence.id);
    for (const edge of statement.edges) {
      edge.statement = s;
      const pair = `${edge.fromId}\u0000${edge.toId}`;
      const count = pairs.get(pair) ?? 0;
      pairs.set(pair, count + 1);
      // Pele numbers the first edge between a pair 0, and the ones after it from 2.
      edge.domId = `L_${edge.fromId}_${edge.toId}_${count === 0 ? 0 : count + 1}`;
      edges.push(edge);
    }
  });
  return { lines, header, direction: head[1] ?? 'TB', statements, others, edges, ids };
}

// ── Reading a node ───────────────────────────────────────────────────────────

const unquote = (text: string): string => {
  const inner = text.trim().replace(/^"(.*)"$/s, '$1').replace(/^`(.*)`$/s, '$1');
  return inner.replace(/#quot;/g, '"').replace(/<br\s*\/?>/gi, '\n');
};

/** Every place node `id` is written. */
function occurrencesOf(flow: Flowchart, id: string): Array<{ statement: Statement; index: number; occurrence: Occurrence }> {
  const found: Array<{ statement: Statement; index: number; occurrence: Occurrence }> = [];
  for (const statement of flow.statements) {
    statement.occurrences.forEach((occurrence, index) => {
      if (occurrence.id === id) found.push({ statement, index, occurrence });
    });
  }
  return found;
}

/** What node `id` says, for editing: its text, with real line breaks, or its id when it has no text of its own. */
export function labelOf(flow: Flowchart, id: string): string {
  for (const { statement, occurrence } of occurrencesOf(flow, id)) {
    if (occurrence.shape) return unquote(flow.lines[statement.line].slice(occurrence.shape.textStart, occurrence.shape.textEnd));
  }
  return id;
}

export function shapeOfNode(flow: Flowchart, id: string): FlowShape {
  return occurrencesOf(flow, id).find((o) => o.occurrence.shape)?.occurrence.shape?.kind ?? 'rect';
}

/** Node ids in the order they first appear. */
export function nodeIds(flow: Flowchart): string[] {
  const ids: string[] = [];
  for (const statement of flow.statements) for (const o of statement.occurrences) if (!ids.includes(o.id)) ids.push(o.id);
  return ids;
}

// ── Patching ─────────────────────────────────────────────────────────────────

interface Patch {
  line: number;
  start: number;
  end: number;
  text: string;
}

function applyPatches(lines: string[], patches: Patch[]): string[] {
  const out = [...lines];
  // From the end backwards, so the places still to be patched have not moved.
  for (const p of [...patches].sort((a, b) => b.line - a.line || b.start - a.start)) {
    out[p.line] = out[p.line].slice(0, p.start) + p.text + out[p.line].slice(p.end);
  }
  return out;
}

const joined = (lines: string[]): string => lines.join('\n');

/** A label as it is written: quoted, so that any text is safe, with line breaks as `<br/>`. */
function writeLabel(text: string): string {
  const body = text.split('\n').map((l) => l.replace(/"/g, '#quot;').trim()).filter(Boolean).join('<br/>');
  return `"${body}"`;
}

/** An id no node has, `n1`, `n2`… */
export function freshId(flow: Flowchart): string {
  let n = 1;
  while (flow.ids.has(`n${n}`)) n++;
  return `n${n}`;
}

export function renameNode(flow: Flowchart, id: string, text: string): string {
  const written = writeLabel(text);
  if (written === '""') return joined(flow.lines);
  const places = occurrencesOf(flow, id);
  const patches: Patch[] = [];
  const shaped = places.filter((p) => p.occurrence.shape);
  for (const { statement, occurrence } of shaped) {
    const shape = occurrence.shape;
    if (shape) patches.push({ line: statement.line, start: shape.textStart, end: shape.textEnd, text: written });
  }
  if (shaped.length === 0 && places[0]) {
    // A node with no text of its own is called by its id: give its first mention a text.
    patches.push({ line: places[0].statement.line, start: places[0].occurrence.start + id.length, end: places[0].occurrence.start + id.length, text: `[${written}]` });
  }
  return joined(applyPatches(flow.lines, patches));
}

export function setNodeShape(flow: Flowchart, id: string, shape: FlowShape): string {
  const [open, close] = FLOW_SHAPES[shape];
  const places = occurrencesOf(flow, id);
  const patches: Patch[] = [];
  const shaped = places.filter((p) => p.occurrence.shape);
  for (const { statement, occurrence } of shaped) {
    const s = occurrence.shape;
    if (!s) continue;
    patches.push({ line: statement.line, start: s.textStart - s.open.length, end: s.textStart, text: open });
    patches.push({ line: statement.line, start: s.textEnd, end: s.textEnd + s.close.length, text: close });
  }
  if (shaped.length === 0 && places[0]) {
    const at = places[0].occurrence.start + id.length;
    patches.push({ line: places[0].statement.line, start: at, end: at, text: `${open}${writeLabel(id)}${close}` });
  }
  return joined(applyPatches(flow.lines, patches));
}

/** The indent new lines take: that of the diagram's first statement. */
function indentOf(flow: Flowchart): string {
  return ' '.repeat(flow.statements[0]?.indent ?? 2);
}

/** Add a line at the end of the diagram. */
function append(flow: Flowchart, text: string): string[] {
  const lines = [...flow.lines];
  let last = lines.length - 1;
  while (last > flow.header && lines[last].trim() === '') last--;
  lines.splice(last + 1, 0, `${indentOf(flow)}${text}`);
  return lines;
}

export type Branch = 'after' | 'before' | 'branch';

/**
 * A new node joined to `from`: after it (an edge out of it), before it (an edge into it), or as another branch
 * (an edge out of it, like `after`, but meant as one more of several). Returns the source and the new node's id.
 */
export function addNode(flow: Flowchart, from: string, branch: Branch, text = 'New node'): { source: string; id: string } {
  const id = freshId(flow);
  const node = `${id}[${writeLabel(text)}]`;
  const line = branch === 'before' ? `${node} --> ${from}` : `${from} --> ${node}`;
  return { source: joined(append(flow, line)), id };
}

/** A diagram with no nodes yet gets its first. */
export function addFirstNode(flow: Flowchart, text = 'New node'): { source: string; id: string } {
  const id = freshId(flow);
  return { source: joined(append(flow, `${id}[${writeLabel(text)}]`)), id };
}

export function addEdge(flow: Flowchart, from: string, to: string, text = ''): string {
  return joined(append(flow, `${from} -->${text ? `|${text}|` : ''} ${to}`));
}

// ── Rearranging ──────────────────────────────────────────────────────────────

/** The edges into node `id`, as indexes into `flow.edges`, not counting one from the node to itself. */
function incoming(flow: Flowchart, id: string): number[] {
  return flow.edges.map((e, i) => (e.toId === id && e.fromId !== id ? i : -1)).filter((i) => i >= 0);
}

/** The node a node hangs from, when exactly one edge goes into it. */
export function parentOf(flow: Flowchart, id: string): string | null {
  const into = incoming(flow, id);
  return into.length === 1 ? flow.edges[into[0]].fromId : null;
}

/** Other nodes that hang from the same parent. */
export function siblingsOf(flow: Flowchart, id: string): string[] {
  const parent = parentOf(flow, id);
  if (parent === null) return [];
  return flow.edges.filter((e) => e.fromId === parent && e.toId !== id && e.toId !== parent).map((e) => e.toId).filter((s, i, all) => all.indexOf(s) === i);
}

/** `id` and everything that can be reached by following edges out of it. */
export function descendantsOf(flow: Flowchart, id: string): Set<string> {
  const seen = new Set<string>([id]);
  const queue = [id];
  while (queue.length > 0) {
    const from = queue.shift();
    for (const e of flow.edges) {
      if (e.fromId === from && !seen.has(e.toId)) {
        seen.add(e.toId);
        queue.push(e.toId);
      }
    }
  }
  return seen;
}

/** The arrow of an edge as written, with its label: what a moved edge keeps. */
const arrowOf = (flow: Flowchart, index: number): string => {
  const edge = flow.edges[index];
  return flow.lines[flow.statements[edge.statement].line].slice(edge.opStart, edge.end);
};

/**
 * Hang node `id` from `newParent` instead: the edge into it moves, keeping its arrow and label. Only for a node with
 * exactly one edge into it, and not onto itself or anything below it.
 */
export function reparentNode(flow: Flowchart, id: string, newParent: string): string | null {
  const into = incoming(flow, id);
  if (into.length !== 1 || descendantsOf(flow, id).has(newParent) || flow.edges[into[0]].fromId === newParent) return null;
  const arrow = arrowOf(flow, into[0]);
  // The node is written again with its new edge; the old parent stays where it was written.
  const after = readFlowchart(removeEdge(flow, into[0], [id]));
  return after ? joined(append(after, `${newParent} ${arrow} ${id}`)) : null;
}

/**
 * Move node `id` before or after its sibling `target` (another child of the same parent). Pele orders a rank by the
 * order the edges are written in, so the edge into `id` is written again beside the one into `target`.
 */
export function moveAmongSiblings(flow: Flowchart, id: string, target: string, before: boolean): string | null {
  const into = incoming(flow, id);
  if (into.length !== 1 || id === target) return null;
  const parent = flow.edges[into[0]].fromId;
  if (!flow.edges.some((e) => e.fromId === parent && e.toId === target)) return null;
  const arrow = arrowOf(flow, into[0]);
  const after = readFlowchart(removeEdge(flow, into[0], [id, parent]));
  const beside = after?.edges.find((e) => e.fromId === parent && e.toId === target);
  if (!after || !beside) return null;
  const statement = after.statements[beside.statement];
  const lines = [...after.lines];
  lines.splice(before ? statement.line : statement.line + 1, 0, `${' '.repeat(statement.indent)}${parent} ${arrow} ${id}`);
  const source = joined(lines);
  return source === joined(flow.lines) ? null : source;
}

/** The text of `occurrence` and of the arrows it is joined by, as it was written. */
const slice = (flow: Flowchart, statement: Statement, start: number, end: number): string => flow.lines[statement.line].slice(start, end);

/**
 * Rewrite a statement keeping some of its nodes and edges. What is kept in runs stays joined as it was; a node that
 * is left alone is written on its own only if it has text there or is not written anywhere else.
 */
function rewriteStatement(
  flow: Flowchart, statement: Statement, keepNode: (i: number) => boolean, keepEdge: (i: number) => boolean,
  elsewhere: (id: string) => boolean,
): string[] {
  const indent = ' '.repeat(statement.indent);
  const out: string[] = [];
  const text = (i: number): string => slice(flow, statement, statement.occurrences[i].start, statement.occurrences[i].end);
  let run: string[] = [];
  let runEdges = 0;
  const flush = (lastIndex: number): void => {
    if (run.length > 0) {
      const lone = runEdges === 0;
      const occurrence = statement.occurrences[lastIndex];
      if (!lone || occurrence.shape || !elsewhere(occurrence.id)) out.push(`${indent}${run.join(' ')}`);
    }
    run = [];
    runEdges = 0;
  };
  statement.occurrences.forEach((_, i) => {
    if (!keepNode(i)) {
      flush(i - 1);
      return;
    }
    run.push(text(i));
    const edge = statement.edges[i];
    if (edge && keepEdge(i) && keepNode(i + 1)) {
      run.push(slice(flow, statement, edge.opStart, edge.end));
      runEdges++;
    } else {
      flush(i);
    }
  });
  flush(statement.occurrences.length - 1);
  return out;
}

/** `linkStyle` lines name edges by their number: take `removed` out of them, and renumber the ones after it. */
function patchLinkStyles(flow: Flowchart, removed: number[]): Map<number, string | null> {
  const changes = new Map<number, string | null>();
  for (const other of flow.others) {
    if (other.kind !== 'linkStyle') continue;
    const line = flow.lines[other.line];
    const found = /^(\s*linkStyle\s+)([\d,\s]+)(\s.*)$/.exec(line);
    if (!found) continue;
    const kept = found[2].split(',').map((n) => parseInt(n, 10)).filter((n) => !removed.includes(n))
      .map((n) => n - removed.filter((r) => r < n).length);
    changes.set(other.line, kept.length > 0 ? `${found[1]}${kept.join(',')}${found[3]}` : null);
  }
  return changes;
}

/** Rebuild the source with some statements rewritten, some lines removed, and `class` lines for `gone` dropped. */
function rebuild(flow: Flowchart, rewrites: Map<number, string[]>, drop: (line: number, text: string) => string | null | undefined, removedEdges: number[]): string {
  const linkStyles = patchLinkStyles(flow, removedEdges);
  const out: string[] = [];
  flow.lines.forEach((text, n) => {
    if (rewrites.has(n)) {
      out.push(...(rewrites.get(n) ?? []));
      return;
    }
    if (linkStyles.has(n)) {
      const next = linkStyles.get(n);
      if (next !== null && next !== undefined) out.push(next);
      return;
    }
    const changed = drop(n, text);
    if (changed === undefined) out.push(text);
    else if (changed !== null) out.push(changed);
  });
  return joined(out);
}

/** The own `class` lines: `class ID tokens`, which this module writes. */
const OWN_CLASS_RE = /^\s*class\s+(\S+)\s+(ffc-(?:c|hex)-[\w-]+)\s*;?\s*$/;

/** What `class A,B name` and `style A …` and `click A …` lines name, with `gone` taken out. */
function dropMentions(flow: Flowchart, gone: Set<string>): (line: number, text: string) => string | null | undefined {
  const kinds = new Map(flow.others.map((o) => [o.line, o.kind]));
  return (line, text) => {
    const kind = kinds.get(line);
    if (kind === 'class') {
      const found = /^(\s*class\s+)(\S+)(\s+\S+\s*;?\s*)$/.exec(text);
      if (!found) return undefined;
      const ids = found[2].split(',');
      const kept = ids.filter((i) => !gone.has(i));
      if (kept.length === ids.length) return undefined;
      return kept.length > 0 ? `${found[1]}${kept.join(',')}${found[3]}` : null;
    }
    if (kind === 'style' || kind === 'click') {
      const id = /^\s*(?:style|click)\s+(\S+)/.exec(text)?.[1];
      return id && gone.has(id) ? null : undefined;
    }
    return undefined;
  };
}

/** Remove a node and every edge to or from it. A node that was only there as the other end of one stays. */
export function removeNode(flow: Flowchart, id: string): string {
  const rewrites = new Map<number, string[]>();
  const removedEdges: number[] = [];
  // How many times each node is written once this node and its edges are gone, to tell which would be lost.
  const left = new Map<string, number>();
  const touches = (statement: Statement): boolean => statement.occurrences.some((o) => o.id === id);
  for (const statement of flow.statements) {
    if (touches(statement)) continue;
    for (const o of statement.occurrences) left.set(o.id, (left.get(o.id) ?? 0) + 1);
  }
  flow.edges.forEach((edge, i) => {
    if (edge.fromId === id || edge.toId === id) removedEdges.push(i);
  });
  for (const statement of flow.statements) {
    if (!touches(statement)) continue;
    const lines = rewriteStatement(
      flow, statement,
      (i) => statement.occurrences[i].id !== id,
      (i) => statement.edges[i].fromId !== id && statement.edges[i].toId !== id,
      (other) => (left.get(other) ?? 0) > 0,
    );
    rewrites.set(statement.line, lines);
  }
  return rebuild(flow, rewrites, dropMentions(flow, new Set([id])), removedEdges);
}

/** `readdedElsewhere`: nodes that are about to be written again, which needn't be kept on a line of their own. */
export function removeEdge(flow: Flowchart, index: number, readdedElsewhere: string[] = []): string {
  const edge = flow.edges[index];
  if (!edge) return joined(flow.lines);
  const statement = flow.statements[edge.statement];
  const elsewhere = (other: string): boolean => readdedElsewhere.includes(other)
    || flow.statements.some((s) => s !== statement && s.occurrences.some((o) => o.id === other));
  const lines = rewriteStatement(flow, statement, () => true, (i) => i !== edge.from, elsewhere);
  return rebuild(flow, new Map([[statement.line, lines]]), () => undefined, [index]);
}

export type EdgeStyle = 'arrow' | 'line' | 'dotted' | 'thick';

const EDGE_OPS: Record<EdgeStyle, string> = { arrow: '-->', line: '---', dotted: '-.->', thick: '==>' };

export function edgeStyleOf(edge: FlowEdge): EdgeStyle {
  if (edge.op.includes('=')) return 'thick';
  if (edge.op.includes('.')) return 'dotted';
  return edge.op.endsWith('>') ? 'arrow' : 'line';
}

export function setEdgeStyle(flow: Flowchart, index: number, style: EdgeStyle): string {
  const edge = flow.edges[index];
  if (!edge) return joined(flow.lines);
  const statement = flow.statements[edge.statement];
  return joined(applyPatches(flow.lines, [{ line: statement.line, start: edge.opStart, end: edge.opStart + edge.op.length, text: EDGE_OPS[style] }]));
}

export function setEdgeLabel(flow: Flowchart, index: number, text: string): string {
  const edge = flow.edges[index];
  if (!edge) return joined(flow.lines);
  const statement = flow.statements[edge.statement];
  const label = text.replace(/[|\n]/g, ' ').replace(/\s+/g, ' ').trim();
  const opEnd = edge.opStart + edge.op.length;
  const patch: Patch = edge.label
    ? { line: statement.line, start: edge.label.start, end: edge.label.end, text: label ? `|${label}|` : '' }
    : { line: statement.line, start: opEnd, end: opEnd, text: label ? `|${label}|` : '' };
  return joined(applyPatches(flow.lines, [patch]));
}

export function edgeLabelOf(edge: FlowEdge): string {
  return edge.label?.text ?? '';
}

export function setDirection(flow: Flowchart, direction: string): string {
  const lines = [...flow.lines];
  lines[flow.header] = lines[flow.header].replace(/^(\s*(?:flowchart|graph)(?:-v2)?)(?:\s+(?:TB|TD|BT|RL|LR))?/, `$1 ${direction}`);
  return joined(lines);
}

// ── Colour ───────────────────────────────────────────────────────────────────

/** The class a node's colour is written as: `ffc-c-red`, or `ffc-hex-12ab34` for one of the user's own. */
export function colorClassOf(flow: Flowchart, id: string): string | null {
  for (const other of flow.others) {
    if (other.kind !== 'class') continue;
    const found = OWN_CLASS_RE.exec(flow.lines[other.line]);
    if (found && found[1].split(',').includes(id)) return found[2];
  }
  return null;
}

/** Give node `id` a colour class, or none: one `class ID name` line each, which replaces the node's earlier one. */
export function setNodeColorClass(flow: Flowchart, id: string, className: string | null): string {
  const own = flow.others.filter((o) => o.kind === 'class' && OWN_CLASS_RE.exec(flow.lines[o.line])?.[1] === id).map((o) => o.line);
  const lines = flow.lines.filter((_, n) => !own.includes(n));
  const shifted: Flowchart = { ...flow, lines };
  return joined(className ? append(shifted, `class ${id} ${className}`) : lines);
}

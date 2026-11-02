import { CanvasNodeLike, getExtra } from './adapter.ts';
import { FIELD_DIAGRAM } from './constants.ts';
import type { TrayItem } from './tray-items.ts';

/** Where a link in a node's text goes when it isn't a note: the text of the link, by its web address. */
export type DiagramLinks = Record<string, string>;

/** Canvas cards a diagram holds, by the id of the node in its source that stands for each. They come back out as they were. */
export type DiagramHeld = Record<string, TrayItem>;

/** What a diagram card saves: the Mermaid source, which Pele draws each time, the web addresses its links go to, and the cards it holds. */
export interface DiagramData {
  source: string;
  links?: DiagramLinks;
  held?: DiagramHeld;
}

/** A canvas file can come from anyone, so only a web address is ever opened. */
const WEB_URL_RE = /^https?:\/\//i;

/** The diagram a node holds, or null. A malformed field (hand-edited, or from another exporter) counts as not a diagram. */
export function readDiagram(node: CanvasNodeLike, data?: Record<string, unknown>): DiagramData | null {
  const v = getExtra(node, FIELD_DIAGRAM, data) as Partial<DiagramData> | undefined;
  if (!v || typeof v !== 'object' || typeof v.source !== 'string') return null;
  const links: DiagramLinks = {};
  if (v.links && typeof v.links === 'object') {
    for (const [text, url] of Object.entries(v.links)) if (typeof url === 'string' && WEB_URL_RE.test(url)) links[text] = url;
  }
  const held: DiagramHeld = {};
  if (v.held && typeof v.held === 'object') {
    for (const [id, item] of Object.entries(v.held)) if (isHeldItem(item)) held[id] = item;
  }
  return {
    source: v.source,
    ...(Object.keys(links).length > 0 ? { links } : {}),
    ...(Object.keys(held).length > 0 ? { held } : {}),
  };
}

/** A held card as the canvas file has it: a node (with what it holds) and the edges that touched them. */
function isHeldItem(o: unknown): o is TrayItem {
  const item = o as TrayItem | null;
  if (typeof item !== 'object' || item === null || typeof item.id !== 'string' || !Array.isArray(item.nodes) || !Array.isArray(item.edges)) return false;
  // What a canvas file holds can be anything: every node and edge must be an object for the card to be put back.
  const isObject = (v: unknown): boolean => typeof v === 'object' && v !== null;
  return item.nodes.length > 0 && item.nodes.every(isObject) && item.edges.every(isObject);
}

/** The cards a diagram keeps once its source has changed: a card is held only while the source still has the node that stands for it, written `id[`. */
export function keepHeld(source: string, held: DiagramHeld | undefined): DiagramHeld | undefined {
  if (!held) return undefined;
  const kept: DiagramHeld = {};
  for (const [id, item] of Object.entries(held)) {
    if (new RegExp(`(?:^|\\s)${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\[`, 'm').test(source)) kept[id] = item;
  }
  return Object.keys(kept).length > 0 ? kept : undefined;
}

/** The fields a diagram node is saved with: its data, and the markdown that stock Obsidian draws it from. */
export function diagramFields(source: string, links?: DiagramLinks, held?: DiagramHeld): Record<string, unknown> {
  const data: DiagramData = {
    source,
    ...(links && Object.keys(links).length > 0 ? { links } : {}),
    ...(held && Object.keys(held).length > 0 ? { held } : {}),
  };
  return { [FIELD_DIAGRAM]: data, text: diagramText(source) };
}

/** The markdown the node holds besides its field, so stock Obsidian still draws the diagram, with Mermaid. */
export function diagramText(source: string): string {
  const fence = source.includes('```') ? '~~~~' : '```';
  return `${fence}mermaid\n${source.trim()}\n${fence}`;
}

export interface DiagramTemplate {
  name: string;
  icon: string;
  source: string;
}

export const DIAGRAM_TEMPLATES: readonly DiagramTemplate[] = [
  { name: 'Mindmap', icon: 'network', source: 'mindmap\n  root((Topic))\n    Idea one\n      Detail\n    Idea two\n    Idea three' },
  { name: 'Flowchart', icon: 'workflow', source: 'flowchart LR\n  A[Start] --> B{Decision}\n  B -->|Yes| C[Do it]\n  B -->|No| D[Skip it]\n  C --> E[Done]\n  D --> E' },
  { name: 'Sequence', icon: 'arrow-right-left', source: 'sequenceDiagram\n  participant A as Alice\n  participant B as Bob\n  A->>B: Hello\n  B-->>A: Hi back' },
  { name: 'State', icon: 'circle-dot', source: 'stateDiagram-v2\n  [*] --> Draft\n  Draft --> Review\n  Review --> Done\n  Review --> Draft\n  Done --> [*]' },
  { name: 'Class', icon: 'boxes', source: 'classDiagram\n  class Animal {\n    +name\n    +speak()\n  }\n  Animal <|-- Dog\n  Animal <|-- Cat' },
  { name: 'Entity relationship', icon: 'database', source: 'erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER ||--|{ ITEM : contains' },
  { name: 'Gantt', icon: 'gantt-chart', source: 'gantt\n  title Plan\n  dateFormat YYYY-MM-DD\n  section Build\n  Design :a1, 2026-01-01, 7d\n  Implement :after a1, 14d' },
  { name: 'Timeline', icon: 'history', source: 'timeline\n  title History\n  2024 : First idea\n  2025 : Prototype\n  2026 : Launch' },
  { name: 'Kanban', icon: 'columns-3', source: 'kanban\n  Todo\n    Write the spec\n  Doing\n    Build it\n  Done\n    Sketch it' },
  { name: 'Pie chart', icon: 'pie-chart', source: 'pie title Time spent\n  "Reading" : 40\n  "Writing" : 35\n  "Thinking" : 25' },
  { name: 'Quadrant chart', icon: 'layout-grid', source: 'quadrantChart\n  title Priorities\n  x-axis Low effort --> High effort\n  y-axis Low impact --> High impact\n  Quick win: [0.2, 0.8]\n  Big bet: [0.8, 0.85]\n  Fill-in: [0.3, 0.25]' },
  { name: 'XY chart', icon: 'bar-chart-2', source: 'xychart-beta\n  title "Sales"\n  x-axis [jan, feb, mar, apr]\n  y-axis "Units" 0 --> 100\n  bar [30, 55, 70, 90]\n  line [30, 55, 70, 90]' },
  { name: 'Git graph', icon: 'git-branch', source: 'gitGraph\n  commit\n  branch feature\n  commit\n  checkout main\n  merge feature' },
];

import { CanvasNodeLike, getExtra } from './adapter.ts';
import { FIELD_DIAGRAM } from './constants.ts';

/** Where a link in a node's text goes when it isn't a note: the text of the link, by its web address. */
export type DiagramLinks = Record<string, string>;

/** What a diagram card saves: the Mermaid source, which Pele draws each time, and the web addresses its links go to. */
export interface DiagramData {
  source: string;
  links?: DiagramLinks;
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
  return Object.keys(links).length > 0 ? { source: v.source, links } : { source: v.source };
}

/** The fields a diagram node is saved with: its data, and the markdown that stock Obsidian draws it from. */
export function diagramFields(source: string, links?: DiagramLinks): Record<string, unknown> {
  const data: DiagramData = links && Object.keys(links).length > 0 ? { source, links } : { source };
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

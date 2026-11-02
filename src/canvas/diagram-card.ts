import { getIcon } from 'obsidian';
import { mount, Mounted } from 'pele';
import type { CanvasPlusPlugin } from '../main.ts';
import { CanvasLike, CanvasNodeLike } from './adapter.ts';
import { DiagramHeld, DiagramLinks, readDiagram } from './diagram-data.ts';
import { DiagramEditor } from './diagram-editor.ts';
import { paintHeld } from './kanban-held.ts';
import { readKanban } from './kanban-edit.ts';
import { TextPart, stripWikilinks } from './wikilink-text.ts';

const CLASS = 'ffc-diagram';
const ERROR_CLASS = 'ffc-diagram-error';

interface Drawn {
  host: HTMLElement;
  mounted: Mounted;
  source: string;
  links: DiagramLinks;
  /** The canvas cards the diagram holds, and the ids of its cards in the order they are drawn (for a kanban that holds any). */
  held?: DiagramHeld;
  ids: string[];
  idsFor: string;
}

/** Pele's drawing in each diagram card, kept so an unchanged diagram isn't redrawn every sweep. */
const drawn = new WeakMap<CanvasNodeLike, Drawn>();

/** Nodes whose text editing was turned off here: double-click opens the diagram's source instead. */
const locked = new WeakSet<CanvasNodeLike>();

/** Obsidian's own icon of that name, as the inside of an SVG, for Pele to draw beside a node. */
function iconMarkup(name: string): string | null {
  const icon = getIcon(name);
  if (!icon) return null;
  // Pele draws an icon on a 24 x 24 grid. Obsidian's own are, but those added by plugins are on a 100 x 100 one.
  const box = icon.getAttribute('viewBox');
  return !box || box === '0 0 24 24' ? icon.innerHTML : `<svg width="24" height="24" viewBox="${box}">${icon.innerHTML}</svg>`;
}

/** A node's own colour is a `ffc-hex-rrggbb` class; hand the colour to the node as a variable for the styles to use. */
function applyCustomColors(host: HTMLElement): void {
  for (const el of Array.from(host.querySelectorAll('.pele-node'))) {
    const hex = /(?:^|\s)ffc-hex-([0-9a-f]{6})(?:\s|$)/i.exec(el.getAttribute('class') ?? '')?.[1];
    if (hex) (el as SVGElement).setCssProps({ '--ffc-mm-color': `#${hex}` });
  }
}

/**
 * Pele draws a node's text as it was written, so a wikilink shows its brackets. Show it as the link's name (or
 * alias) instead, tagged with where it goes: the editor opens it on a click. A node whose text wraps is drawn a label
 * to a line, and is one link across them. In a plain node, the text stays where a plain node's text starts, as the
 * brackets it loses were part of its width.
 */
function decorateLinks(host: HTMLElement, links: DiagramLinks): void {
  const nodes = new Map<Element, SVGGraphicsElement[]>();
  for (const label of Array.from(host.querySelectorAll<SVGGraphicsElement>('.pele-label'))) {
    // The lines of a node's text are its labels; a label outside a node stands alone.
    const node = label.closest('.pele-node') ?? label;
    nodes.set(node, [...(nodes.get(node) ?? []), label]);
  }
  for (const lines of nodes.values()) decorateNodeLinks(lines, links);
}

/** Show the wikilink in a node's `lines` as a link, or a web address typed in the text as one. */
function decorateNodeLinks(lines: SVGGraphicsElement[], links: DiagramLinks): void {
  const runs: Text[] = [];
  const parts: TextPart[] = [];
  for (const line of lines) {
    const walker = line.ownerDocument.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    let lineStart = true;
    for (let run = walker.nextNode(); run; run = walker.nextNode()) {
      runs.push(run as Text);
      parts.push({ text: run.nodeValue ?? '', lineStart });
      lineStart = false;
    }
  }
  const words = lines.map((line) => line.textContent ?? '').join(' ');
  const wikilinked = words.includes('[[') || words.includes('⟦');
  const before = wikilinked ? lines.map((line) => line.getBBox?.().width ?? 0) : [];
  const { texts, target } = wikilinked ? stripWikilinks(parts) : { texts: [], target: null };
  texts.forEach((text, n) => { if (runs[n].nodeValue !== text) runs[n].nodeValue = text; });

  if (!target) {
    // A web address typed in the text is a link too, and stays as it is written.
    const url = /https?:\/\/[^\s<>"]+/i.exec(words)?.[0].replace(/[.,;:!?)]+$/, '');
    if (!url) return;
    for (const line of lines) {
      line.addClass('ffc-mm-link');
      line.setAttribute('data-ffc-link', url);
      line.setAttribute('data-ffc-url', url);
    }
    return;
  }
  // A link with a web address of its own (an issue's) goes there instead of to a note.
  const url = links[target];
  const plain = lines[0].closest('.pele-node')?.classList.contains('pele-shape-text');
  lines.forEach((line, n) => {
    line.addClass('ffc-mm-link');
    line.setAttribute('data-ffc-link', target);
    if (url) line.setAttribute('data-ffc-url', url);
    if (!plain) return;
    const lost = before[n] - (line.getBBox?.().width ?? before[n]);
    if (lost > 0) line.setAttribute('transform', `translate(${-lost / 2} 0)`);
  });
}

/**
 * A flowchart's lines are a pixel or two wide, which is hard to click: give each a wider path that draws nothing and
 * takes the clicks, so an edge can be picked.
 */
function addEdgeHits(host: HTMLElement): void {
  for (const edge of Array.from(host.querySelectorAll('.pele-edge'))) {
    const line = edge.querySelector('path:not(.pele-marker):not(.ffc-edge-hit)');
    const d = line?.getAttribute('d');
    if (d && !edge.querySelector('.ffc-edge-hit')) edge.createSvg('path', { cls: 'ffc-edge-hit', attr: { d } });
  }
}

/** Draw `source` into `host`, showing the problem there instead when it can't be drawn. Returns what to destroy. */
export function mountDiagram(host: HTMLElement, source: string, links: () => DiagramLinks = () => ({}), drawn?: () => void): Mounted {
  return mount(host, source, {
    zoom: false,
    // Pele turns a flowchart from left-to-right to top-to-bottom on a narrow card. The direction the source says is the
    // one the editor works with, and the one the card's direction menu sets, so the drawing keeps to it.
    autoDirection: false,
    icons: iconMarkup,
    onRender: () => {
      host.querySelector(`.${ERROR_CLASS}`)?.remove();
      applyCustomColors(host);
      decorateLinks(host, links());
      addEdgeHits(host);
      drawn?.();
    },
    onError: (error) => {
      host.querySelector(`.${ERROR_CLASS}`)?.remove();
      host.createDiv({ cls: ERROR_CLASS, text: error instanceof Error ? error.message : 'This diagram can’t be drawn.' });
    },
  });
}

/**
 * Dress text nodes that hold a diagram: Pele's drawing of the Mermaid source in place of the node's own text.
 * Idempotent, so safe to run on a timer.
 */
export function decorateDiagrams(plugin: CanvasPlusPlugin, canvas: CanvasLike, onChanged: () => void): void {
  for (const node of canvas.nodes?.values() ?? []) {
    const el = node.nodeEl;
    if (!el) continue;
    const diagram = readDiagram(node);
    const container = el.querySelector<HTMLElement>('.canvas-node-container');
    if (!diagram || !container) {
      clearDiagram(node);
      continue;
    }
    // Obsidian takes a node's element out of the page while it is off screen. Drawing into it then would only pile
    // up drawings nothing shows, so the node is drawn when it comes back.
    if (!el.isConnected) continue;
    el.setAttribute('data-ffc-diagram', '');
    el.toggleAttribute('data-ffc-mindmap', /^\s*mindmap\b/.test(diagram.source));
    const body = diagram.source.replace(/^\s*---[\s\S]*?\n---/, '');
    el.toggleAttribute('data-ffc-flowchart', /^\s*(?:flowchart|graph)\b/.test(body));
    el.toggleAttribute('data-ffc-kanban', /^\s*kanban\b/.test(body));
    if (!locked.has(node)) {
      locked.add(node);
      node.startEditing = () => new DiagramEditor(plugin, canvas, node, onChanged).open();
    }

    const current = drawn.get(node);
    if (current?.host.isConnected) {
      current.held = diagram.held;
      if (current.source !== diagram.source || JSON.stringify(current.links) !== JSON.stringify(diagram.links ?? {})) {
        current.source = diagram.source;
        current.links = diagram.links ?? {};
        current.mounted.update(diagram.source);
      }
      // What the services return changes without the diagram, so a kanban's cards are filled in on every sweep.
      paintBoard(plugin, current);
      continue;
    }
    // Obsidian rebuilds a node's content when its text changes, which takes the drawing with it.
    current?.mounted.destroy();
    current?.host.remove();
    // Any drawing left from before (this node's, or a previous load of the plugin's) would sit under the new one.
    for (const stale of Array.from(container.querySelectorAll(`:scope > .${CLASS}`))) stale.remove();
    const host = container.createDiv({ cls: CLASS });
    const entry: Drawn = {
      host, mounted: undefined as unknown as Mounted, source: diagram.source, links: diagram.links ?? {}, held: diagram.held, ids: [], idsFor: '',
    };
    entry.mounted = mountDiagram(host, diagram.source, () => entry.links, () => paintBoard(plugin, entry));
    drawn.set(node, entry);
  }
}

/** Fill in what a kanban's held cards say, from what the services have returned. */
function paintBoard(plugin: CanvasPlusPlugin, entry: Drawn): void {
  if (!entry.held) return;
  if (entry.idsFor !== entry.source) {
    entry.ids = readKanban(entry.source)?.cards.map((c) => c.id) ?? [];
    entry.idsFor = entry.source;
  }
  paintHeld(plugin, entry.host, entry.ids, entry.held);
}

function clearDiagram(node: CanvasNodeLike): void {
  if (locked.delete(node)) Reflect.deleteProperty(node, 'startEditing');
  const el = node.nodeEl;
  const current = drawn.get(node);
  if (current) {
    current.mounted.destroy();
    current.host.remove();
    drawn.delete(node);
  }
  el?.removeAttribute('data-ffc-diagram');
  el?.removeAttribute('data-ffc-mindmap');
  el?.removeAttribute('data-ffc-flowchart');
  el?.removeAttribute('data-ffc-kanban');
}

export function clearDiagrams(canvas: CanvasLike): void {
  for (const node of canvas.nodes?.values() ?? []) clearDiagram(node);
}

/** The element a node's diagram is drawn in, or null when it isn't drawn. */
export function diagramHost(node: CanvasNodeLike): HTMLElement | null {
  const host = drawn.get(node)?.host;
  return host?.isConnected ? host : null;
}

import { getIcon } from 'obsidian';
import { mount, Mounted } from 'pele';
import type { CanvasPlusPlugin } from '../main.ts';
import { CanvasLike, CanvasNodeLike } from './adapter.ts';
import { DiagramLinks, readDiagram } from './diagram-data.ts';
import { DiagramEditor } from './diagram-editor.ts';

const CLASS = 'ffc-diagram';
const ERROR_CLASS = 'ffc-diagram-error';

interface Drawn {
  host: HTMLElement;
  mounted: Mounted;
  source: string;
  links: DiagramLinks;
}

/** Pele's drawing in each diagram card, kept so an unchanged diagram isn't redrawn every sweep. */
const drawn = new WeakMap<CanvasNodeLike, Drawn>();

/** Nodes whose text editing was turned off here: double-click opens the diagram's source instead. */
const locked = new WeakSet<CanvasNodeLike>();

/** Obsidian's own icon of that name, as the inside of an SVG, for Pele to draw beside a node. */
function iconMarkup(name: string): string | null {
  return getIcon(name)?.innerHTML ?? null;
}

/** A node's own colour is a `ffc-hex-rrggbb` class; hand the colour to the node as a variable for the styles to use. */
function applyCustomColors(host: HTMLElement): void {
  for (const el of Array.from(host.querySelectorAll('.pele-node'))) {
    const hex = /(?:^|\s)ffc-hex-([0-9a-f]{6})(?:\s|$)/i.exec(el.getAttribute('class') ?? '')?.[1];
    if (hex) (el as SVGElement).setCssProps({ '--ffc-mm-color': `#${hex}` });
  }
}

/** A wikilink as it is drawn: `⟦Note⟧` in a plain node, or `[[Note]]` in a quoted label from an earlier version. */
const WIKILINK = /\[\[([^\][|]+)(?:\|([^\][]+))?\]\]|⟦([^⟧|]+)(?:\|([^⟧]+))?⟧/g;

/**
 * Pele draws a node's text as it was written, so a wikilink shows its brackets. Show it as the link's name (or
 * alias) instead, tagged with where it goes: the editor opens it on a click. In a plain node, the text stays where
 * a plain node's text starts, as the brackets it loses were part of its width.
 */
function decorateLinks(host: HTMLElement, links: DiagramLinks): void {
  for (const label of Array.from(host.querySelectorAll('.pele-label'))) {
    const before = (label as SVGGraphicsElement).getBBox?.().width ?? 0;
    const walker = label.ownerDocument.createTreeWalker(label, NodeFilter.SHOW_TEXT);
    let target: string | null = null;
    for (let part = walker.nextNode(); part; part = walker.nextNode()) {
      const text = part.nodeValue ?? '';
      if (!text.includes('[[') && !text.includes('⟦')) continue;
      part.nodeValue = text.replace(WIKILINK, (_match, a?: string, b?: string, c?: string, d?: string) => {
        const link = (a ?? c ?? '').trim();
        target ??= link;
        return (b ?? d ?? link).trim();
      });
    }
    if (!target) {
      // A web address typed in the text is a link too, and stays as it is written.
      const url = /https?:\/\/[^\s<>"]+/i.exec(label.textContent ?? '')?.[0].replace(/[.,;:!?)]+$/, '');
      if (url) {
        label.addClass('ffc-mm-link');
        label.setAttribute('data-ffc-link', url);
        label.setAttribute('data-ffc-url', url);
      }
      continue;
    }
    label.addClass('ffc-mm-link');
    label.setAttribute('data-ffc-link', target);
    // A link with a web address of its own (an issue's) goes there instead of to a note.
    const url = links[target];
    if (url) label.setAttribute('data-ffc-url', url);
    if (label.closest('.pele-node')?.classList.contains('pele-shape-text')) {
      const lost = before - ((label as SVGGraphicsElement).getBBox?.().width ?? before);
      if (lost > 0) label.setAttribute('transform', `translate(${-lost / 2} 0)`);
    }
  }
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
export function mountDiagram(host: HTMLElement, source: string, links: () => DiagramLinks = () => ({})): Mounted {
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
    el.toggleAttribute('data-ffc-flowchart', /^\s*(?:flowchart|graph)\b/.test(diagram.source.replace(/^\s*---[\s\S]*?\n---/, '')));
    if (!locked.has(node)) {
      locked.add(node);
      node.startEditing = () => new DiagramEditor(plugin, canvas, node, onChanged).open();
    }

    const current = drawn.get(node);
    if (current?.host.isConnected) {
      if (current.source !== diagram.source || JSON.stringify(current.links) !== JSON.stringify(diagram.links ?? {})) {
        current.source = diagram.source;
        current.links = diagram.links ?? {};
        current.mounted.update(diagram.source);
      }
      continue;
    }
    // Obsidian rebuilds a node's content when its text changes, which takes the drawing with it.
    current?.mounted.destroy();
    current?.host.remove();
    // Any drawing left from before (this node's, or a previous load of the plugin's) would sit under the new one.
    for (const stale of Array.from(container.querySelectorAll(`:scope > .${CLASS}`))) stale.remove();
    const host = container.createDiv({ cls: CLASS });
    const entry: Drawn = { host, mounted: undefined as unknown as Mounted, source: diagram.source, links: diagram.links ?? {} };
    entry.mounted = mountDiagram(host, diagram.source, () => entry.links);
    drawn.set(node, entry);
  }
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
}

export function clearDiagrams(canvas: CanvasLike): void {
  for (const node of canvas.nodes?.values() ?? []) clearDiagram(node);
}

/** The element a node's diagram is drawn in, or null when it isn't drawn. */
export function diagramHost(node: CanvasNodeLike): HTMLElement | null {
  const host = drawn.get(node)?.host;
  return host?.isConnected ? host : null;
}

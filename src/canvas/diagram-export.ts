import { Menu, Notice } from 'obsidian';
import type { CanvasPlusPlugin } from '../main.ts';
import { CanvasLike, CanvasNodeLike, CanvasViewLike, canvasFilePath, isElement } from './adapter.ts';
import { diagramHost } from './diagram-card.ts';
import { DiagramEditor } from './diagram-editor.ts';
import { readDiagram } from './diagram-data.ts';
import { describe } from './layers-tree.ts';
import { titleFromText } from './note-name.ts';

/** What the drawing's colours and type come from: the styles that apply to each of its parts, as they are now. */
const STYLE_PROPS = [
  'fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin',
  'opacity', 'font-family', 'font-size', 'font-weight', 'font-style', 'text-decoration', 'text-anchor', 'letter-spacing',
];

/** Classes that only show what is picked or being dragged, which a saved drawing shouldn't have. */
const TRANSIENT = ['ffc-mm-active', 'ffc-mm-drop-target', 'ffc-mm-dragging', 'ffc-mm-editing'];

/**
 * The diagram as a standalone SVG, looking as it does now in this theme. Pele draws with CSS variables and the
 * plugin styles parts of it from a style sheet, neither of which a file on its own has, so each part's computed
 * styles are written onto it.
 */
export function diagramSvg(host: HTMLElement): string | null {
  const svg = host.querySelector<SVGSVGElement>('svg.pele');
  if (!svg) return null;
  const marked = TRANSIENT.flatMap((cls) => Array.from(svg.querySelectorAll(`.${cls}`)).map((el) => ({ el, cls })));
  for (const { el, cls } of marked) el.removeClass(cls);
  try {
    const clone = svg.cloneNode(true) as SVGSVGElement;
    // The wider paths that take clicks draw nothing, so they are left out of the copy, and out of the matching of the
    // two trees part by part. The drawing in the card keeps them.
    for (const hit of Array.from(clone.querySelectorAll('.ffc-edge-hit'))) hit.remove();
    const from = [svg, ...Array.from(svg.querySelectorAll('*')).filter((el) => !el.classList.contains('ffc-edge-hit'))];
    const to = [clone, ...Array.from(clone.querySelectorAll('*'))];
    from.forEach((el, i) => {
      const computed = window.getComputedStyle(el);
      to[i].setAttribute('style', STYLE_PROPS.map((p) => `${p}:${computed.getPropertyValue(p)}`).join(';'));
      for (const attr of Array.from(to[i].attributes)) if (attr.name.startsWith('data-ffc')) to[i].removeAttribute(attr.name);
    });
    return new XMLSerializer().serializeToString(clone);
  } finally {
    for (const { el, cls } of marked) el.addClass(cls);
  }
}

/** A name for a saved file: the diagram's title, or what kind it is, without what a file name can't hold. */
function fileName(plugin: CanvasPlusPlugin, node: CanvasNodeLike): string {
  return titleFromText(describe(plugin, node).label) || 'Diagram';
}

/** Put `text` on the clipboard and say so, or say it couldn't be (the window not in focus, or no permission). */
export async function copyText(text: string, done: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    new Notice(done);
  } catch {
    new Notice('Could not copy to the clipboard.');
  }
}

/** Items for copying a diagram's source or drawing, or saving the drawing as an SVG in the vault. */
export function addExportItems(menu: Menu, plugin: CanvasPlusPlugin, canvas: CanvasLike, node: CanvasNodeLike): void {
  const source = readDiagram(node)?.source;
  if (!source) return;
  const svgOf = (): string | null => {
    const host = diagramHost(node);
    return host ? diagramSvg(host) : null;
  };
  menu.addItem((item) => item.setSection('export').setTitle('Copy as Mermaid').setIcon('copy').onClick(() => {
    void copyText(`\`\`\`mermaid\n${source.trim()}\n\`\`\``, 'Copied the diagram as Mermaid.');
  }));
  menu.addItem((item) => item.setSection('export').setTitle('Copy as SVG').setIcon('code-xml').onClick(() => {
    const svg = svgOf();
    if (svg) void copyText(svg, 'Copied the diagram as SVG.');
    else new Notice('The diagram isn’t drawn yet.');
  }));
  menu.addItem((item) => item.setSection('export').setTitle('Save as SVG').setIcon('download').onClick(() => {
    const svg = svgOf();
    if (!svg) {
      new Notice('The diagram isn’t drawn yet.');
      return;
    }
    void (async () => {
      try {
        const path = await plugin.app.fileManager.getAvailablePathForAttachment(`${fileName(plugin, node)}.svg`, canvasFilePath(plugin.app, canvas));
        const file = await plugin.app.vault.create(path, svg);
        new Notice(`Saved ${file.path}.`);
      } catch (err) {
        new Notice(`Could not save the SVG: ${(err as Error).message}`);
      }
    })();
  }));
}

/**
 * Right-click on a diagram card, away from a mindmap's nodes (those have their own menu): edit its source, or
 * export it. Returns what removes the listener.
 */
export function attachDiagramMenu(
  plugin: CanvasPlusPlugin, view: CanvasViewLike, onChanged: () => void, extend: (menu: Menu, node: CanvasNodeLike) => void = () => { /* nothing more */ },
): () => void {
  const canvas = view.canvas;
  if (!canvas) return () => { /* no canvas */ };
  const wrapper = canvas.wrapperEl;
  const handler = (e: MouseEvent): void => {
    if (e.defaultPrevented || !isElement(e.target)) return;
    const el = e.target.closest<HTMLElement>('.canvas-node[data-ffc-diagram]');
    const node = el && [...(canvas.nodes?.values() ?? [])].find((n) => n.nodeEl === el);
    if (!node) return;
    // Past core's own menu for the card.
    e.preventDefault();
    e.stopPropagation();
    if (!canvas.selection?.has(node) || canvas.selection.size > 1) canvas.selectOnly?.(node);
    const menu = new Menu();
    if (!canvas.readonly) {
      menu.addItem((item) => item.setSection('edit').setTitle('Edit source…').setIcon('code').onClick(() => new DiagramEditor(plugin, canvas, node, onChanged).open()));
    }
    extend(menu, node);
    addExportItems(menu, plugin, canvas, node);
    menu.showAtMouseEvent(e);
  };
  wrapper.addEventListener('contextmenu', handler, true);
  return () => wrapper.removeEventListener('contextmenu', handler, true);
}

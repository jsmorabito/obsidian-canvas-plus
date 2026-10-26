import { CanvasViewLike, isElement } from './adapter.ts';
import type { DiagramLinks } from './diagram-data.ts';
import { Keymap } from 'obsidian';

/** A node's text as plain words: without its markup, and with a link as its name. */
export function plainText(label: string): string {
  return label
    .replace(/\[\[([^\][|]+)(?:\|([^\][]+))?\]\]/g, (_m, target: string, alias?: string) => alias ?? target)
    .replace(/<\/?(?:u|b|i|em|strong|code|br\s*\/?)>|\*+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The links that stay once a diagram's source has changed: a link's web address is kept only while a link of that
 * text is still in the source, written `[[text]]` (or `⟦text⟧` in a mindmap).
 */
export function keepLinks(source: string, links: DiagramLinks): DiagramLinks {
  const kept: DiagramLinks = {};
  for (const [text, url] of Object.entries(links)) {
    const written = [`⟦${text}⟧`, `⟦${text}|`, `[[${text}]]`, `[[${text}|`];
    if (written.some((w) => source.includes(w))) kept[text] = url;
  }
  return kept;
}

/** The link in the node under `target` (one `decorateLinks` marked), in the cards `cardSelector` picks out. */
export function linkUnder(target: EventTarget | null, cardSelector: string): { el: Element; target: string; url: string | null } | null {
  if (!isElement(target) || target.closest('.ffc-mm-tools, .ffc-mm-toolbar, .ffc-mm-input') || !target.closest(cardSelector)) return null;
  const el = target.closest('.pele-node')?.querySelector('.ffc-mm-link');
  const name = el?.getAttribute('data-ffc-link');
  return el && name ? { el, target: name, url: el.getAttribute('data-ffc-url') } : null;
}

/** Open a link: an issue's address in the browser, a note in Obsidian (in a new tab when the click asks for one). */
export function openLink(view: CanvasViewLike, link: { target: string; url: string | null }, e: MouseEvent): void {
  if (link.url && /^https?:\/\//i.test(link.url)) {
    window.open(link.url, '_blank', 'noopener');
    return;
  }
  void view.app.workspace.openLinkText(link.target, view.file?.path ?? '', Keymap.isModEvent(e));
}

/** Hovering a node's link shows the note's preview, as a link does in a note (when Page preview is on, and with its key held). */
export function hoverLink(view: CanvasViewLike, link: { el: Element; target: string; url: string | null }, e: MouseEvent): void {
  if (link.url) return;
  view.app.workspace.trigger('hover-link', {
    event: e,
    source: 'canvas',
    hoverParent: view,
    targetEl: link.el,
    linktext: link.target,
    sourcePath: view.file?.path ?? '',
  });
}

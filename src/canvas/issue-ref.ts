import { CanvasNodeLike } from './adapter.ts';
import { FIELD_LINEAR } from './constants.ts';

/** What a node saves of the Linear issue it shows. The rest comes from Linear. */
export interface LinearRef {
  id: string;
  identifier: string;
  title: string;
  url: string;
}

/** A canvas file can come from anyone, so only a Linear address is ever opened or linked to. */
const LINEAR_URL_RE = /^https:\/\/linear\.app\//;

/**
 * The issue a node shows, or null. `data` is the node's `getData()`, when the caller has already read it; without
 * it only the node's bag of extra fields is read, which is what this plugin's fields live in and costs no copy,
 * since this runs for every node on every sweep.
 */
export function readLinearRef(node: CanvasNodeLike, data?: Record<string, unknown>): LinearRef | null {
  const v = (data ? data[FIELD_LINEAR] : (node.unknownData ?? node.getData?.())?.[FIELD_LINEAR]) as Partial<LinearRef> | undefined;
  return v && typeof v.id === 'string' && typeof v.identifier === 'string' && typeof v.url === 'string' && LINEAR_URL_RE.test(v.url)
    ? { id: v.id, identifier: v.identifier, url: v.url, title: typeof v.title === 'string' ? v.title : '' }
    : null;
}

/** The markdown a node holds besides its field, so it still reads as a link where this plugin isn't running. */
export function linearNodeText(ref: Pick<LinearRef, 'identifier' | 'title' | 'url'>): string {
  const label = `${ref.identifier} ${ref.title}`.trim().replace(/[[\]]/g, '');
  return `[${label}](${ref.url})`;
}

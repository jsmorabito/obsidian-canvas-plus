import { PROVIDERS, PROVIDER_IDS } from '../issues/providers.ts';
import type { ProviderId } from '../issues/types.ts';
import { CanvasNodeLike } from './adapter.ts';

/** What a node saves of the issue it shows. The rest comes from the issue's service. */
export interface IssueRef {
  provider: ProviderId;
  id: string;
  identifier: string;
  title: string;
  url: string;
}

/** A canvas file can come from anyone, so only a web address is ever opened or linked to. */
const WEB_URL_RE = /^https?:\/\//;

/**
 * The issue a node shows, or null. `data` is the node's `getData()`, when the caller has already read it; without
 * it only the node's bag of extra fields is read, which is what this plugin's fields live in and costs no copy,
 * since this runs for every node on every sweep.
 */
export function readIssueRef(node: CanvasNodeLike, data?: Record<string, unknown>): IssueRef | null {
  const bag = data ?? node.unknownData ?? node.getData?.();
  if (!bag) return null;
  for (const provider of PROVIDER_IDS) {
    const v = bag[PROVIDERS[provider].field] as Partial<IssueRef> | undefined;
    if (v && typeof v.id === 'string' && typeof v.identifier === 'string' && typeof v.url === 'string' && WEB_URL_RE.test(v.url)
      // Linear's issues all live at one address; a Task App server's is wherever its owner put it.
      && (provider !== 'linear' || v.url.startsWith('https://linear.app/'))) {
      return { provider, id: v.id, identifier: v.identifier, url: v.url, title: typeof v.title === 'string' ? v.title : '' };
    }
  }
  return null;
}

/** The markdown a node holds besides its field, so it still reads as a link where this plugin isn't running. */
export function issueNodeText(ref: Pick<IssueRef, 'identifier' | 'title' | 'url'>): string {
  const label = `${ref.identifier} ${ref.title}`.trim().replace(/[[\]]/g, '');
  return `[${label}](${ref.url})`;
}

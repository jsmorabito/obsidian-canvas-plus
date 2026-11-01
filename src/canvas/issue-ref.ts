import { PROVIDERS, PROVIDER_IDS } from '../issues/providers.ts';
import type { ProviderId } from '../issues/types.ts';
import { CanvasNodeLike } from './adapter.ts';

/** What a node saves of the issue it shows. The rest comes from the issue's service. */
export interface IssueRef {
  provider: ProviderId;
  /** A project is saved the same way as an issue, with no identifier. */
  kind: 'issue' | 'project';
  id: string;
  identifier: string;
  title: string;
  url: string;
}

/** A canvas file can come from anyone, so only a web address is ever opened or linked to. */
const WEB_URL_RE = /^https?:\/\//;

/** Linear's issues and projects all live at one address; a Task App server's is wherever its owner put it. */
function isOurs(provider: ProviderId, url: string): boolean {
  return WEB_URL_RE.test(url) && (provider !== 'linear' || url.startsWith('https://linear.app/'));
}

/**
 * The issue a node shows, or null. `data` is the node's `getData()`, when the caller has already read it; without
 * it only the node's bag of extra fields is read, which is what this plugin's fields live in and costs no copy,
 * since this runs for every node on every sweep.
 */
export function readIssueRef(node: CanvasNodeLike, data?: Record<string, unknown>): IssueRef | null {
  const bag = data ?? node.unknownData ?? node.getData?.();
  if (!bag) return null;
  for (const provider of PROVIDER_IDS) {
    const project = bag[PROVIDERS[provider].projectField] as Partial<IssueRef> | undefined;
    if (project && typeof project.id === 'string' && typeof project.url === 'string' && isOurs(provider, project.url)) {
      return { provider, kind: 'project', id: project.id, identifier: '', url: project.url, title: typeof project.title === 'string' ? project.title : '' };
    }
    const v = bag[PROVIDERS[provider].field] as Partial<IssueRef> | undefined;
    if (v && typeof v.id === 'string' && typeof v.identifier === 'string' && typeof v.url === 'string' && isOurs(provider, v.url)) {
      return { provider, kind: 'issue', id: v.id, identifier: v.identifier, url: v.url, title: typeof v.title === 'string' ? v.title : '' };
    }
  }
  return null;
}

/** A ref as it is saved in a canvas file: the field it is saved under says what kind it is. */
export function storedRef(ref: IssueRef): Omit<IssueRef, 'kind'> {
  const { kind: _kind, ...rest } = ref;
  return rest;
}

/** The markdown a node holds besides its field, so it still reads as a link where this plugin isn't running. */
export function issueNodeText(ref: Pick<IssueRef, 'identifier' | 'title' | 'url'>): string {
  const label = `${ref.identifier} ${ref.title}`.trim().replace(/[[\]]/g, '');
  return `[${label}](${ref.url})`;
}

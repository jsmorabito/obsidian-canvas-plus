import { CanvasNodeLike, getExtra } from './adapter.ts';
import { FIELD_LINEAR } from './constants.ts';

/** What a node saves of the Linear issue it shows. The rest comes from Linear. */
export interface LinearRef {
  id: string;
  identifier: string;
  title: string;
  url: string;
}

export function readLinearRef(node: CanvasNodeLike, data?: Record<string, unknown>): LinearRef | null {
  const v = getExtra(node, FIELD_LINEAR, data) as Partial<LinearRef> | undefined;
  return v && typeof v.id === 'string' && typeof v.identifier === 'string' && typeof v.url === 'string'
    ? { id: v.id, identifier: v.identifier, url: v.url, title: typeof v.title === 'string' ? v.title : '' }
    : null;
}

/** The markdown a node holds besides its field, so it still reads as a link where this plugin isn't running. */
export function linearNodeText(ref: Pick<LinearRef, 'identifier' | 'title' | 'url'>): string {
  const label = `${ref.identifier} ${ref.title}`.trim().replace(/[[\]]/g, '');
  return `[${label}](${ref.url})`;
}

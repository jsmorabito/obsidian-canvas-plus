import type { RefItem } from '../issues/types.ts';

const LABEL = { project: 'Project', initiative: 'Initiative', issue: 'Issue' } as const;

/** What a card calls what it shows: "Issue", "Project" or "Initiative". */
export function refLabel(kind: RefItem['kind']): string {
  return LABEL[kind];
}

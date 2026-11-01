import type { Initiative, ProjectStatusType } from '../issues/types.ts';
import { statusMarker } from './project-card.ts';
import type { RefFacts } from './ref-card.ts';

// A Linear initiative drawn the way an issue is, with the initiative's own facts.

/** Linear's words for an initiative's status, as the project statuses that look the same. */
const STATUS: Record<string, ProjectStatusType> = {
  proposed: 'backlog', planned: 'planned', active: 'started', completed: 'completed', canceled: 'canceled',
};

/** Initiatives have no status colour, so the marker keeps the default one. */
export function initiativeMarker(parent: HTMLElement, initiative: Initiative | undefined): void {
  statusMarker(parent, initiative ? { name: initiative.status, type: STATUS[initiative.status.toLowerCase()] ?? 'backlog', color: '' } : null);
}

export function initiativeFacts(initiative: Initiative): RefFacts {
  const count = initiative.projects.length;
  const chips = [initiative.status, initiative.owner?.name, count > 0 ? `${count} ${count === 1 ? 'project' : 'projects'}` : null, initiative.targetDate]
    .filter((c): c is string => !!c);
  const props: RefFacts['props'] = [['Status', initiative.status]];
  if (initiative.owner) props.push(['Owner', initiative.owner.name]);
  if (initiative.targetDate) props.push(['Target', initiative.targetDate]);
  if (count > 0) props.push(['Projects', initiative.projects.join(', ')]);
  return { name: initiative.name, mark: (el) => initiativeMarker(el, initiative), chips, props, body: initiative.content || initiative.description };
}

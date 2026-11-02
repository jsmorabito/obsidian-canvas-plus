import type { Initiative } from '../issues/types.ts';
import { statusMarker } from './project-card.ts';
import type { RefFacts } from './ref-card.ts';
import { initiativeStatusMarker } from './status-marker.ts';

// A Linear initiative drawn the way an issue is, with the initiative's own facts.

/** Initiatives have no status colour, so the marker keeps the default one. */
export function initiativeMarker(parent: HTMLElement, initiative: Initiative | undefined): void {
  statusMarker(parent, initiative ? initiativeStatusMarker(initiative.status) : null);
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

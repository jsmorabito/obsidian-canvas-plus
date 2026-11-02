import type { Project } from '../issues/types.ts';
import { stateDot } from './issue-card.ts';
import type { RefFacts } from './ref-card.ts';
import { Marker, projectStatusMarker } from './status-marker.ts';

// A Linear project drawn the way an issue is: the same card, full view and link, with the project's own facts.

/** The marker for a status of a project or an initiative. */
export function statusMarker(parent: HTMLElement, marker: Marker | null): void {
  stateDot(parent, marker);
}

export function projectMarker(parent: HTMLElement, project: Project | undefined): void {
  statusMarker(parent, projectStatusMarker(project?.status ?? null));
}

function percent(project: Project): string | null {
  return project.progress === null ? null : `${Math.round(project.progress * 100)}%`;
}

export function projectFacts(project: Project): RefFacts {
  const done = percent(project);
  const chips = [project.status?.name, done, project.lead?.name, project.targetDate].filter((c): c is string => !!c);
  const props: RefFacts['props'] = [];
  if (project.status) props.push(['Status', project.status.name]);
  if (done) props.push(['Progress', done]);
  if (project.lead) props.push(['Lead', project.lead.name]);
  if (project.startDate) props.push(['Start', project.startDate]);
  if (project.targetDate) props.push(['Target', project.targetDate]);
  if (project.teams.length > 0) props.push(['Teams', project.teams.map((t) => t.name).join(', ')]);
  return { name: project.name, mark: (el) => projectMarker(el, project), chips, props, body: project.content || project.description };
}

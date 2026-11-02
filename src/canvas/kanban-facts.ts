import type { RefItem } from '../issues/types.ts';
import { refLabel } from './ref-label.ts';
import { Marker, initiativeStatusMarker, issueMarker, projectStatusMarker } from './status-marker.ts';

/** What a board's card says about the issue, project or initiative it holds, besides its title. */
export interface CardFacts {
  /** The line at the bottom left: an issue's id, or what a project or initiative is and its status. */
  ticket?: string;
  /** The status marker before that line. */
  marker?: Marker;
  /** How far a project is, from 0 to 1, where the service tracks it. */
  progress?: number;
  /** The line at the bottom right: who it is assigned to or led by. */
  assigned?: string;
  /** An issue's priority: 0 for none, then 1 urgent to 4 low. */
  priority?: number;
}

/** The facts of what the service returned, or none while it has not loaded. */
export function factsOf(found: RefItem | undefined): CardFacts {
  if (!found) return {};
  if (found.kind === 'issue') {
    const { identifier, assignee, priority, state } = found.item;
    return { ticket: identifier, assigned: assignee?.name, priority, marker: issueMarker(state) ?? undefined };
  }
  if (found.kind === 'project') {
    const { status, lead, progress } = found.item;
    return { ticket: kindAndStatus('project', status?.name), assigned: lead?.name, marker: projectStatusMarker(status) ?? undefined, progress: progress ?? undefined };
  }
  const { status, owner } = found.item;
  return { ticket: kindAndStatus('initiative', status), assigned: owner?.name, marker: initiativeStatusMarker(status) };
}

/** What a project or initiative is, then its status: "Project · In Progress". */
function kindAndStatus(kind: 'project' | 'initiative', status: string | undefined): string {
  return status ? `${refLabel(kind)} · ${status}` : refLabel(kind);
}

/** Text as Pele reads it in the quoted value of a card's data. */
const quoted = (text: string): string => text.replace(/["\n]/g, ' ').trim();

/**
 * The data a held card is written with, which gives the card its second line (what `factsOf` fills in once it is
 * drawn) and the service's icon: `@{ ticket: "ENG-12", icon: "ffc-linear" }`. `ticket` is what the card says until the
 * service has answered.
 */
export function metaFor(ticket: string, icon: string): string {
  return `@{ ticket: "${quoted(ticket)}", icon: "${quoted(icon)}" }`;
}

/** How a priority is drawn: the bar's colour and its strength, or none for no priority and medium. */
export function priorityBar(priority: number | undefined): { stroke: string; opacity: string } | null {
  // Pele's own variable, as it falls back to a theme colour.
  const critical = 'var(--pele-critical, var(--color-red))';
  if (priority === 1) return { stroke: critical, opacity: '1' };
  if (priority === 2) return { stroke: critical, opacity: '0.5' };
  if (priority === 4) return { stroke: 'var(--_m)', opacity: '0.5' };
  return null;
}

/** A name that fits the line, cut short with an ellipsis. */
export function shortName(name: string, max = 16): string {
  return name.length > max ? `${name.slice(0, max - 1).trimEnd()}…` : name;
}

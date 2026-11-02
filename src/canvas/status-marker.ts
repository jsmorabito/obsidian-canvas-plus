import type { Issue, Project, ProjectStatusType, StateType } from '../issues/types.ts';

/** What a status marker is drawn from: how far along it is, and the colour the service gives it (none for a default). */
export interface Marker {
  type: StateType;
  color: string;
}

/** The marker for a project's status, using the issue markers: a ring, half full or full. */
const PROJECT_MARKER: Record<ProjectStatusType, StateType> = {
  backlog: 'backlog', planned: 'unstarted', started: 'started', paused: 'started', completed: 'completed', canceled: 'canceled',
};

/** Linear's words for an initiative's status, as the project statuses that look the same. */
const INITIATIVE_STATUS: Record<string, ProjectStatusType> = {
  proposed: 'backlog', planned: 'planned', active: 'started', completed: 'completed', canceled: 'canceled',
};

/** The marker for an issue's state, or none while it has none. */
export function issueMarker(state: Issue['state']): Marker | null {
  return state ? { type: state.type, color: state.color } : null;
}

/** The marker for a project's status, or none while it has none. */
export function projectStatusMarker(status: Project['status']): Marker | null {
  return status ? { type: PROJECT_MARKER[status.type] ?? 'backlog', color: status.color } : null;
}

/** The marker for an initiative's status, which has no colour of its own. */
export function initiativeStatusMarker(status: string): Marker {
  return { type: PROJECT_MARKER[INITIATIVE_STATUS[status.toLowerCase()] ?? 'backlog'], color: '' };
}

import type { Project, ProjectStatusType } from '../issues/types.ts';

// What Task App sends for a project, and how it becomes the plugin's `Project`.

export interface RawProject {
  id: string;
  name: string;
  description?: string | null;
  /** One line: the outcome the project is after. */
  goal?: string | null;
  status?: string;
  startDate?: string | null;
  targetDate?: string | null;
  updatedAt?: string;
  deletedAt?: string | null;
}

const STATUS_NAMES: Record<string, string> = { planned: 'Planned', started: 'Started', paused: 'Paused', completed: 'Completed', canceled: 'Canceled' };

/** A project is asked for by its id, which the server only accepts as a UUID. */
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `web` is the address of the web app, where the project's page is. */
export function toProject(raw: RawProject, web: string): Project {
  const type = (raw.status && raw.status in STATUS_NAMES ? raw.status : 'planned') as ProjectStatusType;
  return {
    id: raw.id,
    name: raw.name,
    url: `${web}/project/${raw.id}`,
    description: raw.goal ?? '',
    content: raw.description ?? '',
    icon: null,
    color: null,
    // Task App doesn't work a project's progress out.
    progress: null,
    startDate: raw.startDate ?? null,
    targetDate: raw.targetDate ?? null,
    updatedAt: raw.updatedAt ?? '',
    status: { name: STATUS_NAMES[type], type, color: '' },
    lead: null,
    teams: [],
  };
}

/** The projects whose name or goal has every word of `term`, in the order given. Task App can't search them itself. */
export function matchProjects(projects: Project[], term: string): Project[] {
  const words = term.toLowerCase().split(/\s+/).filter(Boolean);
  return projects.filter((p) => {
    const text = `${p.name} ${p.description}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

/** The project id in a page path, `/project/<id>`. */
export function projectIdOf(pathname: string): string | null {
  return /^\/project\/([0-9a-f-]{36})\/?$/i.exec(pathname)?.[1] ?? null;
}

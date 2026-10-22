// ─── Issue providers ─────────────────────────────────────────────────────────
//
// Linear and Task App both give the canvas issues, and the canvas code (cards, picker, widget, create) doesn't care
// which. Each provider's client turns its own API into these shapes.

export type ProviderId = 'linear' | 'taskapp';

export interface IssueTeam {
  id: string;
  key: string;
  name: string;
}

export type StateType = 'triage' | 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled';

export interface Issue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  description: string;
  /** 0 is no priority, then 1 urgent to 4 low. */
  priority: number;
  priorityLabel: string;
  dueDate: string | null;
  estimate: number | null;
  updatedAt: string;
  state: { name: string; type: StateType; color: string } | null;
  assignee: { name: string; avatarUrl: string | null } | null;
  team: IssueTeam | null;
  project: { name: string } | null;
  labels: Array<{ name: string; color: string }>;
}

export interface IssueInput {
  teamId: string;
  title: string;
  description?: string;
}

/** An error to show the user as it is: the service's own message, or a note on what went wrong. */
export class IssueError extends Error {}

/** What the canvas asks of an issue service. */
export interface IssueClient {
  /** Turned on and signed in (or keyed), so it can be asked. */
  readonly configured: boolean;
  teams(): Promise<IssueTeam[]>;
  /** The issues touched most recently, for when nothing has been searched for yet. */
  recent(): Promise<Issue[]>;
  search(term: string): Promise<Issue[]>;
  /** One issue by its identifier (`ENG-123`), or null if there is none. */
  byIdentifier(identifier: string): Promise<Issue | null>;
  byIds(ids: string[]): Promise<Issue[]>;
  create(input: IssueInput): Promise<Issue>;
  /** The identifier in `ENG-123` or one of this service's issue URLs, upper-cased; null when the text is neither. */
  parseRef(text: string): string | null;
}

export const IDENTIFIER_RE = /^[A-Za-z][A-Za-z0-9]*-\d+$/;

/** How a provider shows up in the interface and in canvas files. */
export interface ProviderInfo {
  id: ProviderId;
  name: string;
  /** Icon id, registered in icons.ts. */
  icon: string;
  /** Extra field on a `text` node showing one of its issues. Stored in canvas files, so it must not change. */
  field: string;
  /** The widget's view type. */
  viewType: string;
}

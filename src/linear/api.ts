import { requestUrl } from 'obsidian';
import type { LinearAuth } from './oauth.ts';

// ─── Linear GraphQL client ───────────────────────────────────────────────────
//
// The only code that talks to Linear. Requests go to api.linear.app, and only
// when a Linear feature is used with an API key set in the plugin's settings.

const ENDPOINT = 'https://api.linear.app/graphql';

export interface LinearTeam {
  id: string;
  key: string;
  name: string;
}

export type StateType = 'triage' | 'backlog' | 'unstarted' | 'started' | 'completed' | 'canceled';

export interface LinearIssue {
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
  team: { id: string; key: string; name: string } | null;
  project: { name: string } | null;
  labels: Array<{ name: string; color: string }>;
}

interface RawIssue extends Omit<LinearIssue, 'description' | 'labels'> {
  description: string | null;
  labels?: { nodes: Array<{ name: string; color: string }> };
}

const ISSUE_FIELDS = `fragment IssueFields on Issue {
  id identifier title url description priority priorityLabel dueDate estimate updatedAt
  state { name type color }
  assignee { name avatarUrl }
  team { id key name }
  project { name }
  labels { nodes { name color } }
}`;

function toIssue(raw: RawIssue): LinearIssue {
  return { ...raw, description: raw.description ?? '', labels: raw.labels?.nodes ?? [] };
}

/** An error to show the user as it is: Linear's own message, or a note on what went wrong. */
export class LinearError extends Error {}

export interface IssueInput {
  teamId: string;
  title: string;
  description?: string;
}

interface Body<T> {
  data?: T;
  errors?: Array<{ message?: string }>;
}

function parseBody<T>(res: { json: unknown }): Body<T> | null {
  try { return res.json as Body<T>; } catch { return null; }
}

export class LinearClient {
  constructor(private readonly auth: LinearAuth) {}

  get configured(): boolean {
    return this.auth.configured;
  }

  private async request<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const authorization = await this.auth.header();
    if (!authorization) throw new LinearError('Sign in to Linear in the Canvas Plus settings.');
    const res = await requestUrl({
      url: ENDPOINT,
      method: 'POST',
      contentType: 'application/json',
      headers: { Authorization: authorization },
      body: JSON.stringify({ query, variables }),
      throw: false,
    });
    const body = parseBody<T>(res);
    const message = body?.errors?.[0]?.message;
    if (message) throw new LinearError(message);
    if (res.status === 401 || res.status === 403) throw new LinearError('Linear did not accept the sign-in. Sign in again in the Canvas Plus settings.');
    if (res.status >= 400 || !body?.data) throw new LinearError(`Linear returned an error (HTTP ${res.status}).`);
    return body.data;
  }

  async teams(): Promise<LinearTeam[]> {
    const data = await this.request<{ teams: { nodes: LinearTeam[] } }>('query { teams(first: 100) { nodes { id key name } } }');
    return data.teams.nodes;
  }

  /** The issues touched most recently, for when nothing has been searched for yet. */
  async recent(): Promise<LinearIssue[]> {
    const data = await this.request<{ issues: { nodes: RawIssue[] } }>(
      `query { issues(first: 25, orderBy: updatedAt) { nodes { ...IssueFields } } } ${ISSUE_FIELDS}`,
    );
    return data.issues.nodes.map(toIssue);
  }

  async search(term: string): Promise<LinearIssue[]> {
    const data = await this.request<{ searchIssues: { nodes: RawIssue[] } }>(
      `query($term: String!) { searchIssues(term: $term, first: 25) { nodes { ...IssueFields } } } ${ISSUE_FIELDS}`,
      { term },
    );
    return data.searchIssues.nodes.map(toIssue);
  }

  /** One issue by its identifier (`ENG-123`), or null if there is none. */
  async byIdentifier(identifier: string): Promise<LinearIssue | null> {
    try {
      const data = await this.request<{ issue: RawIssue | null }>(
        `query($id: String!) { issue(id: $id) { ...IssueFields } } ${ISSUE_FIELDS}`,
        { id: identifier },
      );
      return data.issue ? toIssue(data.issue) : null;
    } catch (err) {
      if (err instanceof LinearError && /not found/i.test(err.message)) return null;
      throw err;
    }
  }

  async byIds(ids: string[]): Promise<LinearIssue[]> {
    if (ids.length === 0) return [];
    const data = await this.request<{ issues: { nodes: RawIssue[] } }>(
      `query($ids: [ID!]) { issues(first: ${ids.length}, filter: { id: { in: $ids } }) { nodes { ...IssueFields } } } ${ISSUE_FIELDS}`,
      { ids },
    );
    return data.issues.nodes.map(toIssue);
  }

  async create(input: IssueInput): Promise<LinearIssue> {
    const data = await this.request<{ issueCreate: { success: boolean; issue: RawIssue | null } }>(
      `mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { ...IssueFields } } } ${ISSUE_FIELDS}`,
      { input },
    );
    if (!data.issueCreate.success || !data.issueCreate.issue) throw new LinearError('Linear did not create the issue.');
    return toIssue(data.issueCreate.issue);
  }
}

const IDENTIFIER_RE = /^[A-Za-z][A-Za-z0-9]*-\d+$/;
const ISSUE_URL_RE = /^https:\/\/linear\.app\/[^/]+\/issue\/([A-Za-z][A-Za-z0-9]*-\d+)(?:[/?#]|$)/;

/** The identifier in `ENG-123` or an issue's URL, upper-cased; null when the text is neither. */
export function parseIssueRef(text: string): string | null {
  const t = text.trim();
  const id = IDENTIFIER_RE.test(t) ? t : ISSUE_URL_RE.exec(t)?.[1];
  return id ? id.toUpperCase() : null;
}

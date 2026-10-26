import { requestUrl } from 'obsidian';
import { IDENTIFIER_RE, Issue, IssueClient, IssueError, IssueInput, IssueTeam } from '../issues/types.ts';
import type { LinearAuth } from './oauth.ts';

// ─── Linear GraphQL client ───────────────────────────────────────────────────
//
// The only code that talks to Linear. Requests go to api.linear.app, and only
// when a Linear feature is used with an API key set in the plugin's settings.

const ENDPOINT = 'https://api.linear.app/graphql';

interface RawIssue extends Omit<Issue, 'description' | 'labels'> {
  description: string | null;
  labels?: { nodes: Array<{ name: string; color: string }> };
}

const FIELD_LIST = `id identifier title url description priority priorityLabel dueDate estimate updatedAt
  state { name type color }
  assignee { name avatarUrl }
  team { id key name }
  project { name }
  labels { nodes { name color } }`;

const ISSUE_FIELDS = `fragment IssueFields on Issue { ${FIELD_LIST} }`;
// searchIssues returns IssueSearchResult, which an Issue fragment can't be spread on.
const SEARCH_FIELDS = `fragment SearchFields on IssueSearchResult { ${FIELD_LIST} }`;

function toIssue(raw: RawIssue): Issue {
  return { ...raw, description: raw.description ?? '', labels: raw.labels?.nodes ?? [] };
}

interface Body<T> {
  data?: T;
  errors?: Array<{ message?: string }>;
}

function parseBody<T>(res: { json: unknown }): Body<T> | null {
  try { return res.json as Body<T>; } catch { return null; }
}

export class LinearClient implements IssueClient {
  constructor(private readonly auth: LinearAuth) {}

  get configured(): boolean {
    return this.auth.configured;
  }

  private async request<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    const authorization = await this.auth.header();
    if (!authorization) throw new IssueError('Sign in to Linear in the Canvas Plus settings.');
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
    if (message) throw new IssueError(message);
    if (res.status === 401 || res.status === 403) throw new IssueError('Linear did not accept the sign-in. Sign in again in the Canvas Plus settings.');
    if (res.status >= 400 || !body?.data) throw new IssueError(`Linear returned an error (HTTP ${res.status}).`);
    return body.data;
  }

  async teams(): Promise<IssueTeam[]> {
    const data = await this.request<{ teams: { nodes: IssueTeam[] } }>('query { teams(first: 100) { nodes { id key name } } }');
    return data.teams.nodes;
  }

  /** The issues touched most recently, for when nothing has been searched for yet. */
  async recent(): Promise<Issue[]> {
    const data = await this.request<{ issues: { nodes: RawIssue[] } }>(
      `query { issues(first: 25, orderBy: updatedAt) { nodes { ...IssueFields } } } ${ISSUE_FIELDS}`,
    );
    return data.issues.nodes.map(toIssue);
  }

  async search(term: string): Promise<Issue[]> {
    const data = await this.request<{ searchIssues: { nodes: RawIssue[] } }>(
      `query($term: String!) { searchIssues(term: $term, first: 25) { nodes { ...SearchFields } } } ${SEARCH_FIELDS}`,
      { term },
    );
    return data.searchIssues.nodes.map(toIssue);
  }

  /** One issue by its identifier (`ENG-123`), or null if there is none. */
  async byIdentifier(identifier: string): Promise<Issue | null> {
    try {
      const data = await this.request<{ issue: RawIssue | null }>(
        `query($id: String!) { issue(id: $id) { ...IssueFields } } ${ISSUE_FIELDS}`,
        { id: identifier },
      );
      return data.issue ? toIssue(data.issue) : null;
    } catch (err) {
      if (err instanceof IssueError && /not found/i.test(err.message)) return null;
      throw err;
    }
  }

  async byIds(ids: string[]): Promise<Issue[]> {
    if (ids.length === 0) return [];
    const data = await this.request<{ issues: { nodes: RawIssue[] } }>(
      `query($ids: [ID!]) { issues(first: ${ids.length}, filter: { id: { in: $ids } }) { nodes { ...IssueFields } } } ${ISSUE_FIELDS}`,
      { ids },
    );
    return data.issues.nodes.map(toIssue);
  }

  async create(input: IssueInput): Promise<Issue> {
    const data = await this.request<{ issueCreate: { success: boolean; issue: RawIssue | null } }>(
      `mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { ...IssueFields } } } ${ISSUE_FIELDS}`,
      { input },
    );
    if (!data.issueCreate.success || !data.issueCreate.issue) throw new IssueError('Linear did not create the issue.');
    return toIssue(data.issueCreate.issue);
  }

  parseRef(text: string): string | null {
    const t = text.trim();
    const id = IDENTIFIER_RE.test(t) ? t : ISSUE_URL_RE.exec(t)?.[1];
    return id ? id.toUpperCase() : null;
  }
}

const ISSUE_URL_RE = /^https:\/\/linear\.app\/[^/]+\/issue\/([A-Za-z][A-Za-z0-9]*-\d+)(?:[/?#]|$)/;

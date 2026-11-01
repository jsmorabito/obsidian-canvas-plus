import { requestUrl } from 'obsidian';
import { IDENTIFIER_RE, Issue, IssueClient, IssueError, IssueInput, IssueTeam, Initiative, InitiativeClient, Project, ProjectClient } from '../issues/types.ts';
import { INITIATIVE_FIELDS, INITIATIVE_URL_RE, RawInitiative, toInitiative } from './initiatives.ts';
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

interface RawProject extends Omit<Project, 'description' | 'content' | 'teams' | 'progress'> {
  description: string | null;
  content: string | null;
  progress: number | null;
  teams?: { nodes: IssueTeam[] };
}

const PROJECT_FIELD_LIST = `id name url description content icon color progress startDate targetDate updatedAt
  status { name type color }
  lead { name avatarUrl }
  teams { nodes { id key name } }`;
const PROJECT_FIELDS = `fragment ProjectFields on Project { ${PROJECT_FIELD_LIST} }`;
const PROJECT_SEARCH_FIELDS = `fragment ProjectSearchFields on ProjectSearchResult { ${PROJECT_FIELD_LIST} }`;

function toProject(raw: RawProject): Project {
  return { ...raw, description: raw.description ?? '', content: raw.content ?? '', progress: raw.progress ?? 0, teams: raw.teams?.nodes ?? [] };
}

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

/** A lookup that finds nothing comes back from Linear as a 'not found' error; that is a null here, and any other error stays one. */
async function orNull<T>(lookup: Promise<T | null>): Promise<T | null> {
  try {
    return await lookup;
  } catch (err) {
    if (err instanceof IssueError && /not found/i.test(err.message)) return null;
    throw err;
  }
}

/** A URL's last part ends in the short id, after the last hyphen, which is what Linear looks a project or initiative up by. */
function shortId(slug: string): string {
  return slug.slice(slug.lastIndexOf('-') + 1);
}

export class LinearClient implements IssueClient, ProjectClient, InitiativeClient {
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
    const data = await orNull(this.request<{ issue: RawIssue | null }>(
      `query($id: String!) { issue(id: $id) { ...IssueFields } } ${ISSUE_FIELDS}`,
      { id: identifier },
    ));
    return data?.issue ? toIssue(data.issue) : null;
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

  async recentProjects(): Promise<Project[]> {
    const data = await this.request<{ projects: { nodes: RawProject[] } }>(
      `query { projects(first: 25, orderBy: updatedAt) { nodes { ...ProjectFields } } } ${PROJECT_FIELDS}`,
    );
    return data.projects.nodes.map(toProject);
  }

  async searchProjects(term: string): Promise<Project[]> {
    const data = await this.request<{ searchProjects: { nodes: RawProject[] } }>(
      `query($term: String!) { searchProjects(term: $term, first: 25) { nodes { ...ProjectSearchFields } } } ${PROJECT_SEARCH_FIELDS}`,
      { term },
    );
    return data.searchProjects.nodes.map(toProject);
  }

  async projectByRef(ref: string): Promise<Project | null> {
    const data = await orNull(this.request<{ project: RawProject | null }>(
      `query($id: String!) { project(id: $id) { ...ProjectFields } } ${PROJECT_FIELDS}`,
      { id: ref },
    ));
    return data?.project ? toProject(data.project) : null;
  }

  async projectsByIds(ids: string[]): Promise<Project[]> {
    if (ids.length === 0) return [];
    const data = await this.request<{ projects: { nodes: RawProject[] } }>(
      `query($ids: [ID!]) { projects(first: ${ids.length}, filter: { id: { in: $ids } }) { nodes { ...ProjectFields } } } ${PROJECT_FIELDS}`,
      { ids },
    );
    return data.projects.nodes.map(toProject);
  }

  async recentInitiatives(): Promise<Initiative[]> {
    const data = await this.request<{ initiatives: { nodes: RawInitiative[] } }>(
      `query { initiatives(first: 25, orderBy: updatedAt) { nodes { ...InitiativeFields } } } ${INITIATIVE_FIELDS}`,
    );
    return data.initiatives.nodes.map(toInitiative);
  }

  /** Linear has no search for initiatives, so this matches their names. */
  async searchInitiatives(term: string): Promise<Initiative[]> {
    const data = await this.request<{ initiatives: { nodes: RawInitiative[] } }>(
      `query($term: String!) { initiatives(first: 25, orderBy: updatedAt, filter: { name: { containsIgnoreCase: $term } }) { nodes { ...InitiativeFields } } } ${INITIATIVE_FIELDS}`,
      { term },
    );
    return data.initiatives.nodes.map(toInitiative);
  }

  async initiativeByRef(ref: string): Promise<Initiative | null> {
    const data = await orNull(this.request<{ initiative: RawInitiative | null }>(
      `query($id: String!) { initiative(id: $id) { ...InitiativeFields } } ${INITIATIVE_FIELDS}`,
      { id: ref },
    ));
    if (data?.initiative) return toInitiative(data.initiative);
    // The short id from a URL may not be one that lookup takes, so ask for it as the initiative's slug too.
    try {
      const found = await this.request<{ initiatives: { nodes: RawInitiative[] } }>(
        `query($ref: String!) { initiatives(first: 1, filter: { slugId: { eq: $ref } }) { nodes { ...InitiativeFields } } } ${INITIATIVE_FIELDS}`,
        { ref },
      );
      return found.initiatives.nodes[0] ? toInitiative(found.initiatives.nodes[0]) : null;
    } catch {
      return null;
    }
  }

  async initiativesByIds(ids: string[]): Promise<Initiative[]> {
    if (ids.length === 0) return [];
    const data = await this.request<{ initiatives: { nodes: RawInitiative[] } }>(
      `query($ids: [ID!]) { initiatives(first: ${ids.length}, filter: { id: { in: $ids } }) { nodes { ...InitiativeFields } } } ${INITIATIVE_FIELDS}`,
      { ids },
    );
    return data.initiatives.nodes.map(toInitiative);
  }

  parseInitiativeRef(text: string): string | null {
    const slug = INITIATIVE_URL_RE.exec(text.trim())?.[1];
    return slug ? shortId(slug) : null;
  }

  parseProjectRef(text: string): string | null {
    const slug = PROJECT_URL_RE.exec(text.trim())?.[1];
    return slug ? shortId(slug) : null;
  }

  parseRef(text: string): string | null {
    const t = text.trim();
    const id = IDENTIFIER_RE.test(t) ? t : ISSUE_URL_RE.exec(t)?.[1];
    return id ? id.toUpperCase() : null;
  }
}

const ISSUE_URL_RE = /^https:\/\/linear\.app\/[^/]+\/issue\/([A-Za-z][A-Za-z0-9]*-\d+)(?:[/?#]|$)/;
const PROJECT_URL_RE = /^https:\/\/linear\.app\/[^/]+\/project\/([^/?#]+)/;

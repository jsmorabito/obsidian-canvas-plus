import { requestUrl } from 'obsidian';
import { IDENTIFIER_RE, Issue, IssueClient, IssueError, IssueInput, IssueTeam, StateType } from '../issues/types.ts';

// ─── Task App client ─────────────────────────────────────────────────────────
//
// The only code that talks to Task App (the self-hosted app in Task-App-1.0). Requests go to the server address set
// in the plugin's settings, with the API token, and only when a Task App feature is used. The server's API is tRPC
// over HTTP with superjson, which needs nothing but `fetch`: a query is a GET with its input in the URL, a mutation
// a POST, and several queries can share a request.

export interface TaskAppConfig {
  /** The Task App features are turned on in the settings. Off, nothing is asked of Task App. */
  enabled(): boolean;
  /** Where the API runs, e.g. `https://tasks.example.com` or `http://localhost:4100`. */
  serverUrl(): string;
  /** Where the web app runs, for links to issues. Empty means the same place as the API. */
  webUrl(): string;
  /** The API token (the server's `API_TOKEN`), from secret storage. A local server with sign-in off needs none. */
  token(): string | null;
}

/** Issues asked for in one request, so the address stays short enough for any proxy in front of the server. */
const BATCH_SIZE = 20;
const RECENT_COUNT = 25;
/** Task App has no "recently updated" list, so look at this many of the newest and sort them. */
const RECENT_POOL = 100;

const PRIORITY_LABELS = ['No priority', 'Urgent', 'High', 'Medium', 'Low'];
const STATE_TYPES = new Set<string>(['backlog', 'unstarted', 'started', 'completed', 'canceled']);

interface RawIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string | null;
  priority?: number;
  dueDate?: string | null;
  estimate?: number | null;
  updatedAt?: string;
  deletedAt?: string | null;
  state?: { name: string; type: string; color?: string } | null;
  team?: { id: string; key: string; name: string } | null;
  project?: { name: string } | null;
  labels?: Array<{ name: string; color?: string }>;
}

interface TrpcFailure {
  json?: { message?: string; data?: { code?: string } };
}

interface TrpcReply<T> {
  result?: { data?: { json?: T } };
  error?: TrpcFailure;
}

/** The text with trailing slashes cut, when it is an http(s) address; otherwise ''. */
export function cleanUrl(text: string): string {
  const t = text.trim().replace(/\/+$/, '');
  return /^https?:\/\/[^/\s]+/i.test(t) ? t : '';
}

export class TaskAppClient implements IssueClient {
  constructor(private readonly config: TaskAppConfig) {}

  get configured(): boolean {
    return this.config.enabled() && !!this.base();
  }

  private base(): string {
    return cleanUrl(this.config.serverUrl());
  }

  private web(): string {
    return cleanUrl(this.config.webUrl()) || this.base();
  }

  private async send<T>(path: string, query: string, body?: unknown): Promise<TrpcReply<T>[]> {
    const token = this.config.token();
    const base = this.base();
    if (!this.config.enabled() || !base) throw new IssueError('Set the Task App server address in the Canvas Plus settings.');
    let res;
    try {
      res = await requestUrl({
        url: `${base}/trpc/${path}${query}`,
        method: body === undefined ? 'GET' : 'POST',
        contentType: 'application/json',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: body === undefined ? undefined : JSON.stringify(body),
        throw: false,
      });
    } catch {
      throw new IssueError(`Could not reach Task App at ${base}.`);
    }
    if (res.status === 401) throw new IssueError(token ? 'Task App did not accept the API token. Check it in the Canvas Plus settings.' : 'Task App needs an API token. Set it in the Canvas Plus settings.');
    let json: unknown;
    try { json = res.json; } catch { json = null; }
    const replies = (Array.isArray(json) ? json : [json]) as Array<TrpcReply<T> | null>;
    if (!replies[0] || (res.status >= 400 && !replies[0].error)) throw new IssueError(`Task App returned an error (HTTP ${res.status}).`);
    return replies as TrpcReply<T>[];
  }

  private static unwrap<T>(reply: TrpcReply<T>): T {
    const failure = reply.error?.json;
    if (failure) throw new IssueError(failure.message || 'Task App returned an error.');
    return reply.result?.data?.json as T;
  }

  private async query<T>(procedure: string, input?: unknown): Promise<T> {
    const query = input === undefined ? '' : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`;
    return TaskAppClient.unwrap((await this.send<T>(procedure, query))[0]);
  }

  private async mutate<T>(procedure: string, input: unknown): Promise<T> {
    return TaskAppClient.unwrap((await this.send<T>(procedure, '', { json: input }))[0]);
  }

  private toIssue(raw: RawIssue): Issue {
    const type = raw.state && STATE_TYPES.has(raw.state.type) ? (raw.state.type as StateType) : 'backlog';
    const priority = raw.priority ?? 0;
    return {
      id: raw.id,
      identifier: raw.identifier,
      title: raw.title,
      url: `${this.web()}/issue/${raw.identifier}`,
      description: raw.description ?? '',
      priority,
      priorityLabel: PRIORITY_LABELS[priority] ?? PRIORITY_LABELS[0],
      dueDate: raw.dueDate ?? null,
      estimate: raw.estimate ?? null,
      updatedAt: raw.updatedAt ?? '',
      state: raw.state ? { name: raw.state.name, type, color: raw.state.color ?? '' } : null,
      // Task App has one owner, so there is never an assignee to show.
      assignee: null,
      team: raw.team ? { id: raw.team.id, key: raw.team.key, name: raw.team.name } : null,
      project: raw.project ? { name: raw.project.name } : null,
      labels: (raw.labels ?? []).map((l) => ({ name: l.name, color: l.color ?? '' })),
    };
  }

  async teams(): Promise<IssueTeam[]> {
    const teams = await this.query<IssueTeam[]>('team.list');
    return teams.map(({ id, key, name }) => ({ id, key, name }));
  }

  async recent(): Promise<Issue[]> {
    const rows = await this.query<RawIssue[]>('issue.list', { limit: RECENT_POOL });
    return rows
      .map((r) => this.toIssue(r))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, RECENT_COUNT);
  }

  async search(term: string): Promise<Issue[]> {
    const rows = await this.query<RawIssue[]>('issue.list', { query: term, limit: RECENT_COUNT });
    return rows.map((r) => this.toIssue(r));
  }

  async byIdentifier(identifier: string): Promise<Issue | null> {
    try {
      const raw = await this.query<RawIssue>('issue.get', { ref: identifier });
      return raw && !raw.deletedAt ? this.toIssue(raw) : null;
    } catch (err) {
      if (err instanceof IssueError && /not found/i.test(err.message)) return null;
      throw err;
    }
  }

  async byIds(ids: string[]): Promise<Issue[]> {
    const found: Issue[] = [];
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const chunk = ids.slice(i, i + BATCH_SIZE);
      // One request for the chunk: the procedure path lists a call for each, and the input is keyed by position.
      const input: Record<string, unknown> = {};
      chunk.forEach((ref, n) => { input[n] = { json: { ref } }; });
      const path = chunk.map(() => 'issue.get').join(',');
      const replies = await this.send<RawIssue>(path, `?batch=1&input=${encodeURIComponent(JSON.stringify(input))}`);
      // An issue that is gone fails on its own; the others still come.
      for (const reply of replies) {
        const raw = reply.result?.data?.json;
        if (raw && !raw.deletedAt) found.push(this.toIssue(raw));
      }
    }
    return found;
  }

  async create(input: IssueInput): Promise<Issue> {
    const raw = await this.mutate<RawIssue>('issue.create', {
      teamId: input.teamId,
      title: input.title,
      description: input.description,
    });
    return this.toIssue(raw);
  }

  parseRef(text: string): string | null {
    const t = text.trim();
    if (IDENTIFIER_RE.test(t)) return t.toUpperCase();
    // One of this server's issue pages: `<web address>/issue/TSK-12`.
    let url: URL;
    try { url = new URL(t); } catch { return null; }
    const ours = [this.web(), this.base()].filter(Boolean).map((u) => new URL(u).origin);
    if (!ours.includes(url.origin)) return null;
    const id = /^\/issue\/([A-Za-z][A-Za-z0-9]*-\d+)\/?$/.exec(url.pathname)?.[1];
    return id ? id.toUpperCase() : null;
  }
}

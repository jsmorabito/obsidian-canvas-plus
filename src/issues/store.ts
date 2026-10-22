import type { Issue, IssueClient } from './types.ts';

/** How long a fetched issue is shown before it is fetched again. */
const TTL_MS = 5 * 60_000;
/** How long after a failed fetch (or an issue that came back missing) to leave it alone. */
const RETRY_MS = 60_000;
/** Issues asked for in one go, collected over this long. */
const BATCH_DELAY_MS = 50;
/** Issues asked for in one request. */
const BATCH_SIZE = 50;

/**
 * Issues on canvases, kept in memory. A node saves only the issue's identity; what its card shows (status,
 * assignee, description…) is fetched, and fetched again once it is older than a few minutes.
 */
export class IssueStore {
  private cache = new Map<string, { issue: Issue; at: number }>();
  private queued = new Set<string>();
  private inflight = new Set<string>();
  private retryAt = new Map<string, number>();
  private listeners = new Set<() => void>();
  private timer: number | null = null;

  constructor(private client: IssueClient) {}

  get(id: string): Issue | undefined {
    return this.cache.get(id)?.issue;
  }

  /** Remember an issue just fetched or created. */
  put(issue: Issue): void {
    this.cache.set(issue.id, { issue, at: Date.now() });
    this.retryAt.delete(issue.id);
    this.notify();
  }

  /** Call `cb` whenever issues have been loaded. Returns a function that stops it. */
  onUpdate(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  /** Ask for an issue to be fetched if it is missing or stale. Cheap to call over and over. */
  request(id: string): void {
    if (!this.client.configured || this.queued.has(id) || this.inflight.has(id)) return;
    const now = Date.now();
    if ((this.retryAt.get(id) ?? 0) > now) return;
    const cached = this.cache.get(id);
    if (cached && now - cached.at < TTL_MS) return;
    this.queued.add(id);
    this.timer ??= window.setTimeout(() => { void this.flush(); }, BATCH_DELAY_MS);
  }

  private async flush(): Promise<void> {
    this.timer = null;
    const all = [...this.queued];
    this.queued.clear();
    for (const id of all) this.inflight.add(id);
    // A page of results is at most 250 for Linear, so ask in smaller batches, each failing or loading on its own.
    for (let i = 0; i < all.length; i += BATCH_SIZE) await this.fetch(all.slice(i, i + BATCH_SIZE));
  }

  private async fetch(ids: string[]): Promise<void> {
    try {
      const found = await this.client.byIds(ids);
      const now = Date.now();
      for (const issue of found) this.cache.set(issue.id, { issue, at: now });
      const got = new Set(found.map((i) => i.id));
      for (const id of ids) if (!got.has(id)) this.retryAt.set(id, now + RETRY_MS);
      if (found.length > 0) this.notify();
    } catch {
      const until = Date.now() + RETRY_MS;
      for (const id of ids) this.retryAt.set(id, until);
    } finally {
      for (const id of ids) this.inflight.delete(id);
    }
  }

  private notify(): void {
    for (const cb of [...this.listeners]) cb();
  }

  destroy(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    this.listeners.clear();
    this.queued.clear();
  }
}

import { App, Notice, ObsidianProtocolData, Platform, requestUrl } from 'obsidian';

// ─── Linear sign-in (OAuth 2.0 with PKCE) ────────────────────────────────────
//
// Authorization code flow with PKCE, so no client secret is needed or kept. The browser comes back to
// `obsidian://canvas-plus-linear`, which Obsidian hands to the protocol handler registered in main.ts. The tokens
// live in Obsidian's secret storage. Without a sign-in, a personal API key set in the settings is used instead.

export const PROTOCOL_ACTION = 'canvas-plus-linear';
export const REDIRECT_URI = `obsidian://${PROTOCOL_ACTION}`;
const AUTHORIZE_URL = 'https://linear.app/oauth/authorize';
const TOKEN_URL = 'https://api.linear.app/oauth/token';
const REVOKE_URL = 'https://api.linear.app/oauth/revoke';
const SCOPES = 'read,write';

const ACCESS_SECRET = 'canvas-plus-linear-access';
const REFRESH_SECRET = 'canvas-plus-linear-refresh';
/** Refresh a little before the token runs out. */
const EXPIRY_MARGIN_MS = 60_000;
/** How long a sign-in started in the browser stays open to be finished. */
const PENDING_MS = 10 * 60_000;

export interface AuthStore {
  /** The Linear features are turned on in the settings. Off, nothing is asked of Linear. */
  enabled(): boolean;
  /** The OAuth app's client ID, from the settings. */
  clientId(): string;
  /** The personal API key, if one is set. */
  apiKey(): string | null;
  expiresAt(): number;
  setExpiresAt(at: number): void;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomString(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function challengeFor(verifier: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(hash));
}

/**
 * Open a page in the system browser. `window.open` can land in Obsidian's own web viewer, which can't pass the
 * `obsidian://` redirect back to the app, so on desktop ask the system to open it.
 */
function openInBrowser(url: string): void {
  if (Platform.isDesktopApp) {
    try {
      const { shell } = (window as unknown as { require: (id: string) => { shell: { openExternal: (url: string) => unknown } } }).require('electron');
      void shell.openExternal(url);
      return;
    } catch { /* fall back below */ }
  }
  window.open(url);
}

export class LinearAuth {
  private pending: { state: string; verifier: string; at: number } | null = null;
  private refreshing: Promise<string | null> | null = null;
  private listeners = new Set<() => void>();

  constructor(private app: App, private store: AuthStore) {}

  /** Signed in with OAuth. */
  get signedIn(): boolean {
    return !!this.app.secretStorage.getSecret(REFRESH_SECRET) || !!this.app.secretStorage.getSecret(ACCESS_SECRET);
  }

  /** Something to ask Linear with: a sign-in, or an API key. */
  get configured(): boolean {
    return this.store.enabled() && (this.signedIn || !!this.store.apiKey());
  }

  /** Call `cb` when signing in or out. Returns a function that stops it. */
  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }

  private changed(): void {
    // A copy: a listener may unsubscribe and subscribe again (the settings tab does), and a Set visits what is added while it is walked.
    for (const cb of [...this.listeners]) cb();
  }

  /** The Authorization header for a request, refreshing the token first if it has run out. */
  async header(): Promise<string | null> {
    if (!this.store.enabled()) return null;
    if (this.signedIn) {
      const token = await this.accessToken();
      if (token) return `Bearer ${token}`;
    }
    const key = this.store.apiKey();
    return key ? (key.startsWith('lin_oauth_') ? `Bearer ${key}` : key) : null;
  }

  private async accessToken(): Promise<string | null> {
    const access = this.app.secretStorage.getSecret(ACCESS_SECRET);
    if (access && Date.now() < this.store.expiresAt() - EXPIRY_MARGIN_MS) return access;
    this.refreshing ??= this.refresh().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  private async refresh(): Promise<string | null> {
    const refresh = this.app.secretStorage.getSecret(REFRESH_SECRET);
    const clientId = this.store.clientId();
    if (!refresh || !clientId) return this.app.secretStorage.getSecret(ACCESS_SECRET);
    const res = await this.post(TOKEN_URL, { grant_type: 'refresh_token', refresh_token: refresh, client_id: clientId });
    if (!res.access_token) {
      // The grant was revoked or has expired: sign in again.
      if (res.error === 'invalid_grant') this.clear();
      return null;
    }
    this.save(res);
    return res.access_token;
  }

  /** Open Linear in the browser to approve access. The browser returns through `finish`. */
  async start(): Promise<void> {
    const clientId = this.store.clientId();
    if (!clientId) {
      new Notice('Enter the OAuth client ID first.');
      return;
    }
    const verifier = randomString();
    const state = randomString();
    this.pending = { state, verifier, at: Date.now() };
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: SCOPES,
      state,
      code_challenge: await challengeFor(verifier),
      code_challenge_method: 'S256',
    });
    openInBrowser(`${AUTHORIZE_URL}?${params.toString()}`);
  }

  /** The browser came back to Obsidian: trade the code for tokens. */
  async finish(data: ObsidianProtocolData): Promise<void> {
    const pending = this.pending;
    this.pending = null;
    if (!pending || Date.now() - pending.at > PENDING_MS || data.state !== pending.state) {
      new Notice('Linear sign-in was not started here, or took too long. Try again.');
      return;
    }
    if (data.error || !data.code) {
      new Notice(`Linear sign-in failed: ${data.error_description ?? data.error ?? 'no code returned'}.`);
      return;
    }
    const res = await this.post(TOKEN_URL, {
      grant_type: 'authorization_code',
      code: data.code,
      redirect_uri: REDIRECT_URI,
      client_id: this.store.clientId(),
      code_verifier: pending.verifier,
    });
    if (!res.access_token) {
      new Notice(`Linear sign-in failed: ${res.error_description ?? res.error ?? 'no token returned'}.`);
      return;
    }
    this.save(res);
    new Notice('Signed in to Linear.');
  }

  async signOut(): Promise<void> {
    const token = this.app.secretStorage.getSecret(ACCESS_SECRET);
    this.clear();
    if (token) await this.post(REVOKE_URL, { token, token_type_hint: 'access_token' }).catch(() => undefined);
  }

  private save(res: TokenResponse): void {
    this.app.secretStorage.setSecret(ACCESS_SECRET, res.access_token ?? '');
    // A refresh may not send a new refresh token; keep the one we have.
    if (res.refresh_token) this.app.secretStorage.setSecret(REFRESH_SECRET, res.refresh_token);
    this.store.setExpiresAt(Date.now() + (res.expires_in ?? 0) * 1000);
    this.changed();
  }

  private clear(): void {
    this.app.secretStorage.setSecret(ACCESS_SECRET, '');
    this.app.secretStorage.setSecret(REFRESH_SECRET, '');
    this.store.setExpiresAt(0);
    this.changed();
  }

  private async post(url: string, form: Record<string, string>): Promise<TokenResponse> {
    const res = await requestUrl({
      url,
      method: 'POST',
      contentType: 'application/x-www-form-urlencoded',
      body: new URLSearchParams(form).toString(),
      throw: false,
    });
    try { return res.json as TokenResponse; } catch { return { error: `HTTP ${res.status}` }; }
  }
}

// Google sign-in through Google Identity Services (token model).
//
// GIS gives the browser short-lived access tokens (about an hour) and no
// refresh token. A "silent" refresh is still a popup, which browsers only allow
// straight after a tap, so when the token runs out outside a tap we ask Rob for
// one tap on a Reconnect banner instead of letting a blocked popup fail.

import { GOOGLE_CLIENT_ID, GOOGLE_SCOPES, TOKEN_MARGIN_MS } from '../config';
import { kvDelete, kvGet, kvSet } from '../db';
import { prefersRedirect, startRedirect, takeRedirectResult } from './redirect';

const GIS_SRC = 'https://accounts.google.com/gsi/client';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const SESSION_KEY = 'auth.session';

export interface Session {
  accessToken: string;
  expiresAt: number;
  email: string;
  name: string;
  picture?: string;
}

export type AuthState = 'signed-out' | 'signed-in' | 'needs-tap';

export class NeedsTapError extends Error {
  constructor() {
    super('Google sign-in expired. Tap Reconnect to continue.');
    this.name = 'NeedsTapError';
  }
}

// Minimal typings for the parts of GIS we use.
interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}
interface TokenClient {
  requestAccessToken(overrides?: { prompt?: string; login_hint?: string }): void;
}
interface Gis {
  accounts: {
    oauth2: {
      initTokenClient(config: {
        client_id: string;
        scope: string;
        callback: (r: TokenResponse) => void;
        error_callback?: (e: { type: string; message?: string }) => void;
      }): TokenClient;
      revoke(token: string, done?: () => void): void;
    };
  };
}
declare global {
  interface Window {
    google?: Gis;
  }
}

type Listener = (state: AuthState) => void;

export class GoogleAuth {
  private session: Session | null = null;
  private needsTap = false;
  private client: TokenClient | null = null;
  private pending: { resolve: (r: TokenResponse) => void; reject: (e: Error) => void } | null = null;
  private inflight: Promise<string> | null = null;
  private readonly listeners = new Set<Listener>();

  /** Use full-page sign-in instead of popups (iPhone home-screen app, or chosen on the sign-in screen). */
  useRedirect = prefersRedirect();
  /** Set when a redirect sign-in came back with a problem. */
  redirectError?: string;

  async load(): Promise<AuthState> {
    this.session = (await kvGet<Session>(SESSION_KEY)) ?? null;
    const back = takeRedirectResult();
    if (back) await this.finishRedirect(back);
    if (this.session && !this.tokenValid()) this.needsTap = true;
    void loadGis().catch(() => {}); // warm up; errors surface on sign-in
    return this.state;
  }

  get state(): AuthState {
    if (!this.session) return 'signed-out';
    return this.needsTap ? 'needs-tap' : 'signed-in';
  }

  get user(): Pick<Session, 'email' | 'name' | 'picture'> | null {
    return this.session && { email: this.session.email, name: this.session.name, picture: this.session.picture };
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Call from a click handler (first sign-in or Reconnect). */
  async signIn(): Promise<void> {
    await this.requestToken(this.session ? '' : 'consent');
  }

  /**
   * Call from a tap: if the token would expire within `ms`, get a new one now
   * (a brief sign-in flash) so a long job or listen doesn't stall later when
   * no tap is possible. Tokens last about an hour, so longer needs can't be met.
   */
  async ensureFresh(ms: number): Promise<void> {
    if (!this.session || this.session.expiresAt - Date.now() > ms) return;
    await this.requestToken('');
  }

  /** A valid access token, refreshing silently if the browser allows it. */
  getToken = async (): Promise<string> => {
    if (this.session && this.tokenValid()) return this.session.accessToken;
    return this.refreshToken();
  };

  /** Forces a new token (used after a 401). */
  refreshToken = async (): Promise<string> => {
    if (!this.session) throw new NeedsTapError();
    if (!hasUserActivation()) {
      this.setNeedsTap(true);
      throw new NeedsTapError();
    }
    return this.requestToken('');
  };

  async signOut(revoke: boolean): Promise<void> {
    const token = this.session?.accessToken;
    if (revoke && token) {
      await loadGis();
      await new Promise<void>((r) => window.google!.accounts.oauth2.revoke(token, r));
    }
    this.session = null;
    this.needsTap = false;
    await kvDelete(SESSION_KEY);
    this.emit();
  }

  private tokenValid(): boolean {
    return !!this.session && this.session.expiresAt - TOKEN_MARGIN_MS > Date.now();
  }

  private requestToken(prompt: '' | 'consent'): Promise<string> {
    this.inflight ??= this.doRequestToken(prompt).finally(() => (this.inflight = null));
    return this.inflight;
  }

  private async finishRedirect(r: ReturnType<typeof takeRedirectResult> & object): Promise<void> {
    try {
      if (r.error) throw new Error(r.error === 'access_denied' ? 'Sign-in was cancelled.' : r.error === 'state_mismatch' ? 'Sign-in reply did not match; please try again.' : `Sign-in failed (${r.error}).`);
      if (!r.accessToken) throw new Error('Sign-in failed.');
      if (!r.scope?.split(' ').includes(DRIVE_SCOPE)) throw new Error('Noteable needs access to your Google Drive. Sign in again and tick the Drive box.');
      const profile = await fetchProfile(r.accessToken);
      this.session = { accessToken: r.accessToken, expiresAt: Date.now() + (r.expiresIn ?? 3600) * 1000, ...profile };
      await kvSet(SESSION_KEY, this.session);
      this.needsTap = false;
      this.useRedirect = true; // it worked this way; keep using it on this device
    } catch (err) {
      this.redirectError = (err as Error).message;
    }
  }

  private async doRequestToken(prompt: '' | 'consent'): Promise<string> {
    if (!GOOGLE_CLIENT_ID) throw new Error('Google client ID is not configured in src/config.ts');
    if (this.useRedirect) return startRedirect({ clientId: GOOGLE_CLIENT_ID, scope: GOOGLE_SCOPES, loginHint: this.session?.email, consent: prompt === 'consent' });
    await loadGis();
    this.client ??= window.google!.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: GOOGLE_SCOPES,
      callback: (r) => this.pending?.resolve(r),
      error_callback: (e) =>
        this.pending?.reject(new Error(e.type === 'popup_closed' ? 'Sign-in window was closed.' : `Sign-in failed (${e.type}).`)),
    });

    const response = await new Promise<TokenResponse>((resolve, reject) => {
      this.pending = { resolve, reject };
      this.client!.requestAccessToken({ prompt, login_hint: this.session?.email });
    }).finally(() => (this.pending = null));

    if (response.error || !response.access_token) {
      throw new Error(response.error_description || response.error || 'Sign-in failed.');
    }
    if (!response.scope?.split(' ').includes(DRIVE_SCOPE)) {
      throw new Error('Noteable needs access to your Google Drive. Sign in again and tick the Drive box.');
    }

    const expiresAt = Date.now() + (response.expires_in ?? 3600) * 1000;
    const profile = await fetchProfile(response.access_token);
    this.session = { accessToken: response.access_token, expiresAt, ...profile };
    await kvSet(SESSION_KEY, this.session);
    this.setNeedsTap(false);
    return response.access_token;
  }

  private setNeedsTap(value: boolean): void {
    if (this.needsTap === value) return;
    this.needsTap = value;
    this.emit();
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.state);
  }
}

async function fetchProfile(token: string): Promise<Pick<Session, 'email' | 'name' | 'picture'>> {
  const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Could not read your Google profile (${res.status}).`);
  const body = (await res.json()) as { email: string; name?: string; picture?: string };
  return { email: body.email, name: body.name ?? body.email, picture: body.picture };
}

function hasUserActivation(): boolean {
  // Without the User Activation API we can't tell; try and let GIS report a blocked popup.
  return navigator.userActivation?.isActive ?? true;
}

let gisPromise: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  gisPromise ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      gisPromise = null;
      reject(new Error('Could not load Google sign-in. Are you online?'));
    };
    document.head.append(s);
  });
  return gisPromise;
}

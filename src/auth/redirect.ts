// Full-page sign-in, for where Google's popup is unreliable (iPhone home-screen
// apps). OAuth implicit grant: Google sends the browser back to the app with the
// token in the URL fragment (#access_token=…), which the app reads and clears.

const STATE_KEY = 'noteable.oauthState';

export function redirectUri(): string {
  return new URL(import.meta.env.BASE_URL, location.origin).href;
}

export function buildAuthUrl(opts: { clientId: string; scope: string; redirectUri: string; state: string; loginHint?: string; consent?: boolean }): string {
  const p = new URLSearchParams({
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    response_type: 'token',
    scope: opts.scope,
    include_granted_scopes: 'true',
    state: opts.state,
  });
  if (opts.loginHint) p.set('login_hint', opts.loginHint);
  if (opts.consent) p.set('prompt', 'consent');
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

export interface RedirectResult {
  accessToken?: string;
  expiresIn?: number;
  scope?: string;
  state?: string;
  error?: string;
}

/** Reads a token (or error) from the URL fragment; null when the fragment isn't an OAuth reply. */
export function parseRedirectHash(hash: string): RedirectResult | null {
  const h = hash.replace(/^#/, '');
  if (!/(^|&)(access_token|error)=/.test(h)) return null;
  const p = new URLSearchParams(h);
  return {
    accessToken: p.get('access_token') ?? undefined,
    expiresIn: p.has('expires_in') ? Number(p.get('expires_in')) : undefined,
    scope: p.get('scope') ?? undefined,
    state: p.get('state') ?? undefined,
    error: p.get('error') ?? undefined,
  };
}

/** iPhone/iPad running from the home screen, where popups misbehave. */
export function prefersRedirect(): boolean {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = (navigator as Navigator & { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches;
  return ios && standalone;
}

export function startRedirect(opts: { clientId: string; scope: string; loginHint?: string; consent?: boolean }): Promise<never> {
  const state = crypto.randomUUID();
  try {
    localStorage.setItem(STATE_KEY, state);
  } catch {
    // Without storage we can't check the reply; sign-in will fail safely.
  }
  location.assign(buildAuthUrl({ ...opts, redirectUri: redirectUri(), state }));
  return new Promise<never>(() => {}); // the page is leaving
}

/** If the page is Google's reply: checks the state, clears the URL, returns the result. */
export function takeRedirectResult(): RedirectResult | null {
  const r = parseRedirectHash(location.hash);
  if (!r) return null;
  history.replaceState(null, '', `${location.pathname}${location.search}#/`);
  let expected: string | null = null;
  try {
    expected = localStorage.getItem(STATE_KEY);
    localStorage.removeItem(STATE_KEY);
  } catch {
    // fall through to the mismatch error
  }
  if (!r.error && (!expected || r.state !== expected)) return { error: 'state_mismatch' };
  return r;
}

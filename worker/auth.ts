// Google sign-in for the desktop worker: OAuth "Desktop app" client, loopback
// redirect with PKCE. The refresh token is kept encrypted (DPAPI) in
// %APPDATA%\Noteable\token.bin.
//
// While the Cloud project is in Testing mode, Google expires refresh tokens
// after 7 days, so the worker asks to sign in again about once a week.

import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { TOKEN_FILE, type WorkerConfig } from './config';
import { protect, unprotect } from './dpapi';
import { log } from './log';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/drive';

export class SignInNeeded extends Error {
  constructor(reason: string) {
    super(`Google sign-in needed: ${reason}`);
    this.name = 'SignInNeeded';
  }
}

interface Saved {
  refreshToken: string;
  savedAt: string;
}

export class DesktopAuth {
  private refresh: string | null = null;
  private access: { token: string; expiresAt: number } | null = null;
  private signingIn: Promise<void> | null = null;
  onChange?: () => void;

  constructor(
    private readonly cfg: WorkerConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (existsSync(TOKEN_FILE)) {
      try {
        const saved = JSON.parse(unprotect(readFileSync(TOKEN_FILE, 'utf8'))) as Saved;
        this.refresh = saved.refreshToken;
      } catch (err) {
        log('Could not read the saved sign-in; you will need to sign in again.', err);
      }
    }
  }

  get signedIn(): boolean {
    return !!this.refresh;
  }

  getToken = async (): Promise<string> => {
    if (this.access && this.access.expiresAt - 60_000 > Date.now()) return this.access.token;
    return this.refreshToken();
  };

  refreshToken = async (): Promise<string> => {
    if (!this.refresh) throw new SignInNeeded('not signed in yet');
    const res = await this.fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret, refresh_token: this.refresh, grant_type: 'refresh_token' }),
    });
    const body = (await res.json()) as { access_token?: string; expires_in?: number; error?: string; error_description?: string };
    if (!res.ok || !body.access_token) {
      if (body.error === 'invalid_grant') {
        // Expired (7 days in Testing mode) or revoked.
        this.forget();
        throw new SignInNeeded('the saved sign-in has expired');
      }
      throw new Error(`Token refresh failed: ${body.error_description ?? body.error ?? res.status}`);
    }
    this.access = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
    return this.access.token;
  };

  /** Opens the browser for Google sign-in and waits for it to finish. */
  signIn(): Promise<void> {
    this.signingIn ??= this.doSignIn().finally(() => (this.signingIn = null));
    return this.signingIn;
  }

  forget(): void {
    this.refresh = null;
    this.access = null;
    rmSync(TOKEN_FILE, { force: true });
    this.onChange?.();
  }

  private async doSignIn(): Promise<void> {
    const verifier = randomBytes(48).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const state = randomBytes(16).toString('hex');

    const code = await new Promise<{ code: string; redirect: string }>((resolve, reject) => {
      const server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        const err = url.searchParams.get('error');
        const got = url.searchParams.get('code');
        if (url.pathname !== '/' || (!got && !err)) {
          res.writeHead(404).end();
          return;
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><title>Noteable</title><body style="font:16px system-ui;background:#0b0d10;color:#e9edf2;padding:40px">
          <h1>${got ? 'Signed in' : 'Sign-in cancelled'}</h1><p>${got ? 'The Noteable desktop worker can use your Drive now. You can close this tab.' : 'You can close this tab and try again from the tray icon.'}</p></body>`);
        server.close();
        clearTimeout(timer);
        if (err || url.searchParams.get('state') !== state) reject(new Error(err ?? 'State mismatch'));
        else resolve({ code: got!, redirect });
      });
      let redirect = '';
      const timer = setTimeout(() => {
        server.close();
        reject(new Error('Sign-in timed out after 5 minutes'));
      }, 5 * 60_000);
      server.listen(0, '127.0.0.1', () => {
        redirect = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
        const url = new URL(AUTH_URL);
        url.search = new URLSearchParams({
          client_id: this.cfg.clientId,
          redirect_uri: redirect,
          response_type: 'code',
          scope: SCOPE,
          access_type: 'offline',
          prompt: 'consent',
          code_challenge: challenge,
          code_challenge_method: 'S256',
          state,
        }).toString();
        log('Opening the browser for Google sign-in…');
        openBrowser(url.toString());
      });
    });

    const res = await this.fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.cfg.clientId,
        client_secret: this.cfg.clientSecret,
        code: code.code,
        code_verifier: verifier,
        grant_type: 'authorization_code',
        redirect_uri: code.redirect,
      }),
    });
    const body = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string; error_description?: string; error?: string };
    if (!res.ok || !body.refresh_token) throw new Error(`Sign-in failed: ${body.error_description ?? body.error ?? 'no refresh token returned'}`);
    if (!body.scope?.split(' ').includes(SCOPE)) throw new Error('Drive access was not granted. Sign in again and allow Drive.');
    this.refresh = body.refresh_token;
    this.access = body.access_token ? { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 } : null;
    const saved: Saved = { refreshToken: body.refresh_token, savedAt: new Date().toISOString() };
    writeFileSync(TOKEN_FILE, protect(JSON.stringify(saved)));
    log('Signed in; sign-in saved (encrypted for this Windows user).');
    this.onChange?.();
  }
}

export function openBrowser(url: string): void {
  // `start` needs an empty title argument before a quoted URL.
  spawn('cmd.exe', ['/c', 'start', '""', url.replace(/&/g, '^&')], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

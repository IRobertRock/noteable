import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { GoogleAuth, NeedsTapError } from './auth/google';
import { ROOT_FOLDER } from './config';
import { currentJob } from './generate/jobs';
import { DEFAULT_VOICE, toVoiceId } from './model/voices';
import { DriveStorage } from './storage/DriveStorage';
import { readJson } from './storage/Storage';
import { ensureLayout, type LayoutStatus } from './storage/bootstrap';
import { homeScreen } from './ui/home';
import { h, mount } from './ui/h';
import { inboxScreen } from './ui/inbox';
import { itemScreen } from './ui/item';
import { libraryScreen } from './ui/library';
import { signInScreen } from './ui/signin';

registerSW({ immediate: true });

const root = document.getElementById('app')!;
const auth = new GoogleAuth();
const storage = new DriveStorage({
  getToken: auth.getToken,
  refreshToken: auth.refreshToken,
  rootName: ROOT_FOLDER,
});

const ui = {
  busy: false,
  error: undefined as string | undefined,
  layout: null as LayoutStatus[] | null,
  layoutError: undefined as string | undefined,
};

let leaveFns: (() => void)[] = [];

type Route = { name: 'library' } | { name: 'inbox' } | { name: 'account' } | { name: 'item'; path: string };

function route(): Route {
  const hash = location.hash.replace(/^#\/?/, '');
  if (hash.startsWith('item/')) return { name: 'item', path: decodeURIComponent(hash.slice(5)) };
  if (hash === 'inbox') return { name: 'inbox' };
  if (hash === 'account') return { name: 'account' };
  return { name: 'library' };
}

export function go(hash: string): void {
  location.hash = hash;
}

const openItem = (path: string) => go(`#/item/${encodeURIComponent(path)}`);

async function defaultVoice(): Promise<string> {
  try {
    const settings = await readJson<{ voice?: string }>(storage, 'State/settings.json');
    return toVoiceId(settings.voice) ?? DEFAULT_VOICE;
  } catch {
    return DEFAULT_VOICE;
  }
}

function render(): void {
  for (const fn of leaveFns) fn();
  leaveFns = [];

  const user = auth.user;
  if (auth.state === 'signed-out' || !user) {
    mount(root, signInScreen({ busy: ui.busy, error: ui.error, onSignIn: signIn }));
    return;
  }

  const r = route();
  let screen: HTMLElement;
  switch (r.name) {
    case 'inbox':
      screen = inboxScreen({ storage, defaultVoice, openItem });
      break;
    case 'item':
      screen = itemScreen({ storage, itemPath: r.path, onLeave: (fn) => leaveFns.push(fn), reconnect: reconnectNow });
      break;
    case 'account':
      screen = homeScreen({
        user,
        layout: ui.layout,
        layoutError: ui.layoutError,
        duplicateRoot: storage.duplicateRoot,
        onRetry: () => void checkLayout(),
        onSignOut: (revoke) => void signOut(revoke),
      });
      break;
    default:
      screen = libraryScreen({ storage, openItem });
  }

  mount(
    root,
    banners(),
    screen,
    h(
      'nav',
      { class: 'tabs' },
      tab('#/', 'Library', r.name === 'library' || r.name === 'item'),
      tab('#/inbox', 'Inbox', r.name === 'inbox'),
      tab('#/account', 'Account', r.name === 'account'),
    ),
  );
}

function tab(href: string, label: string, active: boolean): HTMLElement {
  return h('a', { href, class: active ? 'active' : undefined, 'aria-current': active ? 'page' : undefined }, label);
}

function banners(): HTMLElement {
  return h(
    'div',
    { class: 'banners' },
    !navigator.onLine && h('div', { class: 'banner' }, 'Offline.'),
    auth.state === 'needs-tap' &&
      h('div', { class: 'banner action' }, h('span', null, 'Google sign-in expired.'), h('button', { class: 'primary small', onclick: reconnect }, 'Reconnect')),
  );
}

async function signIn(): Promise<void> {
  ui.busy = true;
  ui.error = undefined;
  render();
  try {
    await auth.signIn();
    ui.busy = false;
    await checkLayout();
  } catch (err) {
    ui.busy = false;
    ui.error = errorText(err);
    render();
  }
}

function reconnect(): void {
  auth.signIn().then(checkLayout, (err) => {
    ui.layoutError = errorText(err);
    render();
  });
}

/** For buttons that need Drive right now: reconnect first if the token has lapsed. */
async function reconnectNow(): Promise<void> {
  if (auth.state === 'needs-tap') await auth.signIn();
}

async function checkLayout(): Promise<void> {
  if (auth.state === 'signed-out') return;
  ui.layoutError = undefined;
  if (route().name === 'account') render();
  if (!navigator.onLine) return;
  try {
    ui.layout = await ensureLayout(storage);
  } catch (err) {
    if (!(err instanceof NeedsTapError)) ui.layoutError = errorText(err);
  }
  if (route().name === 'account') render();
}

async function signOut(revoke: boolean): Promise<void> {
  await auth.signOut(revoke);
  storage.clearCache();
  ui.layout = null;
  ui.layoutError = undefined;
  render();
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

auth.onChange(render);
window.addEventListener('hashchange', render);
window.addEventListener('online', () => void checkLayout());
window.addEventListener('offline', render);
window.addEventListener('beforeunload', (e) => {
  if (currentJob()?.running) e.preventDefault();
});

void auth.load().then(() => {
  render();
  if (auth.state === 'signed-in') void checkLayout();
});

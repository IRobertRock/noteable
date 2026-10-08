import './style.css';
import { registerSW } from 'virtual:pwa-register';
import type { App } from './app';
import { itemHash } from './app';
import { GoogleAuth, NeedsTapError } from './auth/google';
import { ROOT_FOLDER } from './config';
import { currentJob, deviceName } from './generate/jobs';
import { LibraryIndex } from './library/libraryIndex';
import { DEFAULT_VOICE, toVoiceId } from './model/voices';
import { Downloads } from './offline/downloads';
import { Player } from './player/player';
import { DriveStorage } from './storage/DriveStorage';
import { readJson } from './storage/Storage';
import { ensureLayout, type LayoutStatus } from './storage/bootstrap';
import { StateStore } from './sync/state';
import { homeScreen } from './ui/home';
import { h, mount } from './ui/h';
import { inboxScreen } from './ui/inbox';
import { itemScreen } from './ui/item';
import { libraryScreen } from './ui/library';
import { miniPlayer, playerScreen } from './ui/player';
import { readerScreen } from './ui/reader';
import { settingsSection } from './ui/settings';
import { signInScreen } from './ui/signin';

registerSW({ immediate: true });

const root = document.getElementById('app')!;
const auth = new GoogleAuth();
const storage = new DriveStorage({
  getToken: auth.getToken,
  refreshToken: auth.refreshToken,
  rootName: ROOT_FOLDER,
});
const state = new StateStore(storage, deviceName());
const library = new LibraryIndex(storage);
const downloads = new Downloads(storage);
const player = new Player(downloads, state, new URL(`${import.meta.env.BASE_URL}pwa-512x512.png`, location.href).href);

let leaveFns: (() => void)[] = [];

const app: App = {
  storage,
  auth,
  state,
  library,
  downloads,
  player,
  go: (hash) => (location.hash = hash),
  onLeave: (fn) => leaveFns.push(fn),
  reconnectNow,
  freshFor: (minutes) => auth.ensureFresh(Math.min(55, minutes) * 60_000).catch(() => {}),
  defaultVoice,
};

const ui = {
  busy: false,
  error: undefined as string | undefined,
  layout: null as LayoutStatus[] | null,
  layoutError: undefined as string | undefined,
};

type Route =
  | { name: 'library' }
  | { name: 'inbox' }
  | { name: 'account' }
  | { name: 'player' }
  | { name: 'item'; path: string }
  | { name: 'read'; path: string };

function route(): Route {
  const hash = location.hash.replace(/^#\/?/, '');
  if (hash.startsWith('item/')) return { name: 'item', path: decodeURIComponent(hash.slice(5)) };
  if (hash.startsWith('read/')) return { name: 'read', path: decodeURIComponent(hash.slice(5)) };
  if (hash === 'inbox') return { name: 'inbox' };
  if (hash === 'account') return { name: 'account' };
  if (hash === 'player') return { name: 'player' };
  return { name: 'library' };
}

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
      screen = inboxScreen({ storage, defaultVoice, openItem: (path) => app.go(itemHash(path)) });
      break;
    case 'item':
      screen = itemScreen(app, r.path);
      break;
    case 'read':
      screen = readerScreen(app, r.path);
      break;
    case 'player':
      screen = playerScreen(app);
      break;
    case 'account':
      screen = homeScreen({
        user,
        layout: ui.layout,
        layoutError: ui.layoutError,
        duplicateRoot: storage.duplicateRoot,
        onRetry: () => void checkLayout(),
        onSignOut: (revoke) => void signOut(revoke),
        settings: settingsSection(app),
      });
      break;
    default:
      screen = libraryScreen(app);
  }

  const inLibrary = r.name === 'library' || r.name === 'item' || r.name === 'read';
  mount(
    root,
    banners(),
    screen,
    h(
      'div',
      { class: 'dock' },
      r.name !== 'player' ? miniPlayer(app) : h('span'),
      h(
        'nav',
        { class: 'tabs' },
        tab('#/', 'Library', inLibrary),
        tab('#/player', 'Player', r.name === 'player'),
        tab('#/inbox', 'Inbox', r.name === 'inbox'),
        tab('#/account', 'Account', r.name === 'account'),
      ),
    ),
  );
  window.scrollTo(0, 0);
}

function tab(href: string, label: string, active: boolean): HTMLElement {
  return h('a', { href, class: active ? 'active' : undefined, 'aria-current': active ? 'page' : undefined }, label);
}

function banners(): HTMLElement {
  return h(
    'div',
    { class: 'banners' },
    !navigator.onLine && h('div', { class: 'banner' }, 'Offline. Downloaded items still play; progress syncs when you reconnect.'),
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
    await afterSignIn();
  } catch (err) {
    ui.busy = false;
    ui.error = errorText(err);
    render();
  }
}

function reconnect(): void {
  auth.signIn().then(afterSignIn, (err) => {
    ui.layoutError = errorText(err);
    render();
  });
}

async function reconnectNow(): Promise<void> {
  if (auth.state === 'needs-tap') await auth.signIn();
}

async function afterSignIn(): Promise<void> {
  await checkLayout();
  void syncAll();
}

/** Pull the latest library and playback state from Drive (and push local changes). */
async function syncAll(): Promise<void> {
  if (!navigator.onLine || auth.state !== 'signed-in') return;
  await Promise.allSettled([state.sync(), library.refresh()]);
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
  player.pause();
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
window.addEventListener('online', () => {
  render();
  void checkLayout();
  void syncAll();
});
window.addEventListener('offline', render);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void syncAll();
});
window.addEventListener('beforeunload', (e) => {
  if (currentJob()?.running) e.preventDefault();
});

void (async () => {
  await Promise.all([auth.load(), state.load(), library.load(), downloads.load()]);
  render();
  if (auth.state === 'signed-in') {
    void checkLayout();
    void syncAll();
  }
})();

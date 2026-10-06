import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { GoogleAuth, NeedsTapError } from './auth/google';
import { ROOT_FOLDER } from './config';
import { DriveStorage } from './storage/DriveStorage';
import { ensureLayout, type LayoutStatus } from './storage/bootstrap';
import { homeScreen } from './ui/home';
import { mount } from './ui/h';
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

function render(): void {
  const user = auth.user;
  if (auth.state === 'signed-out' || !user) {
    mount(root, signInScreen({ busy: ui.busy, error: ui.error, onSignIn: signIn }));
    return;
  }
  mount(
    root,
    homeScreen({
      user,
      layout: ui.layout,
      layoutError: ui.layoutError,
      duplicateRoot: storage.duplicateRoot,
      needsTap: auth.state === 'needs-tap',
      online: navigator.onLine,
      onReconnect: reconnect,
      onRetry: () => void checkLayout(),
      onSignOut: (revoke) => void signOut(revoke),
    }),
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

async function checkLayout(): Promise<void> {
  if (auth.state === 'signed-out') return;
  ui.layoutError = undefined;
  render();
  if (!navigator.onLine) return;
  try {
    ui.layout = await ensureLayout(storage);
  } catch (err) {
    if (!(err instanceof NeedsTapError)) ui.layoutError = errorText(err);
  }
  render();
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
window.addEventListener('online', () => void checkLayout());
window.addEventListener('offline', render);

void auth.load().then(() => {
  render();
  if (auth.state === 'signed-in') void checkLayout();
});

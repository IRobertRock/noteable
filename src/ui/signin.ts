import { h } from './h';

export function signInScreen(opts: { busy: boolean; error?: string; onSignIn: () => void; onRedirect?: () => void }): HTMLElement {
  return h(
    'section',
    { class: 'screen center' },
    h('img', { class: 'logo', src: `${import.meta.env.BASE_URL}icon.svg`, alt: '' }),
    h('h1', null, 'Noteable'),
    h('p', { class: 'muted' }, 'Turn documents into audiobooks and study guides. Your library lives in your Google Drive.'),
    h('button', { class: 'primary', onclick: opts.onSignIn, disabled: opts.busy }, opts.busy ? 'Signing in…' : 'Sign in with Google'),
    opts.error && h('p', { class: 'error', role: 'alert' }, opts.error),
    opts.onRedirect && h('button', { class: 'link-button small', onclick: opts.onRedirect, disabled: opts.busy }, 'Sign-in window not working? Sign in on a full page'),
  );
}

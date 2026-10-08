import { h } from './h';
import type { LayoutStatus } from '../storage/bootstrap';

export interface HomeProps {
  user: { email: string; name: string; picture?: string };
  layout: LayoutStatus[] | null;
  layoutError?: string;
  duplicateRoot: boolean;
  onRetry: () => void;
  /** Extra sections shown above Sign out (settings). */
  settings?: HTMLElement;
  onSignOut: (revoke: boolean) => void;
}

const LABEL: Record<LayoutStatus['state'], string> = { found: 'Found', created: 'Created', error: 'Error' };

export function homeScreen(p: HomeProps): HTMLElement {
  const revoke = h('input', { type: 'checkbox', id: 'revoke' });

  return h(
    'section',
    { class: 'screen' },
    h(
      'header',
      { class: 'account' },
      p.user.picture
        ? h('img', { class: 'avatar', src: p.user.picture, alt: '', referrerpolicy: 'no-referrer' })
        : h('div', { class: 'avatar' }, p.user.name.slice(0, 1)),
      h('div', null, h('div', { class: 'name' }, p.user.name), h('div', { class: 'muted' }, p.user.email)),
    ),

    h('h2', null, 'Drive folder'),
    p.duplicateRoot &&
      h('p', { class: 'error' }, 'More than one "Noteable" folder is in My Drive. Using the oldest one; delete or rename the others.'),
    p.layoutError && h('p', { class: 'error', role: 'alert' }, p.layoutError),
    p.layout
      ? h(
          'ul',
          { class: 'status' },
          p.layout.map((s) =>
            h(
              'li',
              { title: s.error },
              h('code', null, `Noteable/${s.path}`),
              h('span', { class: `pill ${s.state}` }, LABEL[s.state]),
            ),
          ),
        )
      : !p.layoutError && h('p', { class: 'muted' }, 'Checking your Drive…'),
    (p.layoutError || p.layout?.some((s) => s.state === 'error')) &&
      h('button', { onclick: p.onRetry }, 'Try again'),

    p.settings,
    h(
      'footer',
      null,
      h('label', { class: 'check', for: 'revoke' }, revoke, ' Also remove Noteable’s access to my Google account'),
      h('button', { onclick: () => p.onSignOut(revoke.checked) }, 'Sign out'),
      h('p', { class: 'muted small' }, `Noteable v${__APP_VERSION__}`),
    ),
  );
}

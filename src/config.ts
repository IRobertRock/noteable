// All app configuration lives here. Nothing in this file is secret: an OAuth
// client ID is public by design. Secrets never go in this repo.

/** Web OAuth client from the "Noteable" Google Cloud project. */
export const GOOGLE_CLIENT_ID = '721235811847-v88bsdhshnbvabjk858fopnfeia6lbau.apps.googleusercontent.com';

/** Full drive scope so the app can see files Claude saves to the Inbox. */
export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'openid',
  'email',
  'profile',
].join(' ');

export const ROOT_FOLDER = 'Noteable';

export const LAYOUT_FOLDERS = ['Inbox', 'Library/General', 'Queue', 'State'] as const;

/** Created only when missing; existing files are never overwritten. */
export const LAYOUT_FILES: Record<string, unknown> = {
  'State/playback.json': { version: 1, items: {} },
  'State/bookmarks.json': { version: 1, bookmarks: [] },
  'State/settings.json': { version: 1, voice: 'af_bella', speed: 1, sleepTimerMin: 30 },
};

/** Treat a token as expired this long before Google says it is. */
export const TOKEN_MARGIN_MS = 5 * 60 * 1000;

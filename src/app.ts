// Services shared by every screen.

import type { GoogleAuth } from './auth/google';
import type { LibraryIndex } from './library/libraryIndex';
import type { Downloads } from './offline/downloads';
import type { Player } from './player/player';
import type { Storage } from './storage/Storage';
import type { StateStore } from './sync/state';

export interface App {
  storage: Storage;
  auth: GoogleAuth;
  state: StateStore;
  library: LibraryIndex;
  downloads: Downloads;
  player: Player;
  go(hash: string): void;
  /** Runs `fn` when the current screen is replaced (unsubscribe listeners here). */
  onLeave(fn: () => void): void;
  /** For buttons that need Drive right now: reconnect first if sign-in has lapsed. */
  reconnectNow(): Promise<void>;
  defaultVoice(): Promise<string>;
}

export const itemHash = (path: string) => `#/item/${encodeURIComponent(path)}`;
export const readHash = (path: string) => `#/read/${encodeURIComponent(path)}`;

# Phase 3 — Player, reading view and sync

Status: **built, gate not yet tested**. Deployed 2026-10-08. Rob chose to move on to Phase 4 and test later; the gate steps are in `docs/TESTING.md`.

## Goal

I can listen to any item on any device with lock-screen and earbud controls, read it as text, and pick up on my phone exactly where I stopped on my laptop, even offline once it's downloaded.

## Scope

**In this phase**

- Library screen: collections, items with mode, length, progress, downloaded badge; local index in IndexedDB refreshed on open and every 2 minutes (`Storage.watch`).
- Player: speed 0.75–2× in 0.25 steps remembered per item (new items start at 1×), ±15 s, previous/next chapter, bookmarks with optional note.
- Media Session API: title, chapter, collection, artwork; play/pause, seek back/forward, previous/next track, seekto.
- Resume position saved every 10 s and on pause, synced through `State/playback.json` (latest timestamp per item wins).
- Reading view: chapters with formatting, tap a paragraph to start that chapter, bookmarks and notes in the margin.
- Download / Remove download per item: MP3s to Cache Storage, text and `item.json` to IndexedDB; offline playback; offline progress queued and synced on reconnect.
- Gapless-enough chapter transitions (preload next chapter).

**Left for later**

- No sleep timer (Rob dropped it on 2026-10-08).
- Sleep mode (phase 4), document importers (phase 5), queue status UI (phase 6), pause markers (phase 7).
- Paragraph-level audio sync (tap a paragraph starts **that chapter**, per spec, not that paragraph).

## Steps

1. [x] **Library index.** `src/library/index.ts` (IndexedDB stores `items`, `downloads`, `pendingWrites`, via `idb@8.0.3`), `src/library/sync.ts`: on open and every 120 s while visible, list `Library/*/*/item.json` and refresh. Pauses when the page is hidden.
2. [x] **Library UI.** `src/ui/library.ts`, `src/ui/itemCard.ts`: collections list, item rows (mode chip, total length, % listened, downloaded icon), Download / Remove download.
3. [x] **Audio source.** `src/player/source.ts`: chapter URL = cached blob URL if downloaded, else a short-lived blob fetched through `Storage.read` (Drive file content needs the bearer token, so `<audio src>` can't point at Drive directly). Streams the next chapter in the background.
   - Note: this means a chapter downloads fully before playing when not saved offline. 64 kbps → ~29 MB/hour, ~2–5 MB per chapter, acceptable on LTE. Alternative (a service-worker range proxy that adds the token) is noted as a fallback if start delay is bad.
4. [x] **Player core.** `src/player/player.ts`: single `HTMLAudioElement`, `playbackRate` (with `preservesPitch`), skip, chapter jump, end-of-chapter → next chapter.
5. [x] **Media Session.** `src/player/mediaSession.ts`: metadata (title = chapter title, artist = item title, album = collection, artwork = app icon), action handlers `play`, `pause`, `seekbackward`, `seekforward` (15 s), `previoustrack`, `nexttrack`, `seekto`; `setPositionState` on every rate/position change.
6. [x] **Playback state.** `src/sync/playback.ts`: `{ version, items: { [itemId]: { chapter, positionSec, speed, updatedAt, device } } }`. Save locally every 10 s and on pause; push to Drive at most every 30 s and on pause/visibility-hidden (read → merge per item by `updatedAt` → write). Offline writes go to `pendingWrites` and flush on `online`.
7. [x] **Bookmarks.** `src/sync/bookmarks.ts`: `{ id, itemId, chapter, positionSec, note, createdAt, updatedAt, deleted? }` (soft delete so devices merge cleanly). UI: bookmark button in player, list per item, edit note.
8. [x] **Reading view.** `src/ui/reader.ts`: renders `text/NN.md` (or `guide.md`) with `marked@18.1.0`, sanitised with `dompurify@3.x` (pinned when added), chapter headings, tap paragraph → play chapter from start, bookmark markers in the margin.
9. [x] **Offline.** `src/offline/download.ts`: Cache Storage `noteable-audio-v1` keyed by item/chapter; IndexedDB for text and item.json; `navigator.storage.estimate()` shown in settings. Service worker unchanged (the app shell is already offline from phase 1).
10. [x] **Settings screen.** `src/ui/settings.ts`: default voice, storage used on this device, sign out (merged with the Account tab).
11. [x] Commit, deploy, update this document.

## Tests

- **Unit:** playback merge (later `updatedAt` wins per item; other items untouched), bookmark merge with soft deletes, speed steps clamp to 0.75–2, pending-write queue flush order.
- **Integration in the browser pane:** play an item from phase 2, check Media Session handlers via `navigator.mediaSession` state, switch the network to offline in DevTools emulation after Download and confirm playback and progress writes queue.
- **Two-browser check on the laptop:** Chrome and Edge as two "devices", resume position crosses within 30 s.

## Gate

> Done when: Rob starts an item on the laptop and resumes it on the phone at the same spot, in airplane mode after downloading.

1. On the S23, open Noteable, go to the gate item from phase 2 and tap **Download**. Wait for the downloaded badge.
2. On the laptop, open Noteable, play the same item, jump to chapter 2, listen to about 1:30, press **Pause**. Note the time shown (e.g. Ch 2, 1:32).
3. On the S23 (still online), open Noteable and tap **Refresh** on the Library (it also refreshes by itself when the app comes to the front). The item shows the laptop's position and "% listened".
4. Turn on **airplane mode** on the S23.
5. Tap the item → **▶ Resume · ch 2, 1:3x**. It starts at Ch 2 about 2 seconds before the laptop's position (it rewinds a little for context).
6. Lock the phone. Use the lock-screen controls: pause, play, skip forward 15 s, next chapter. Check the lock screen shows the title, chapter and collection.
7. With earbuds connected: single tap play/pause, double tap next (whatever your earbuds map to next track).
8. Set speed to 1.5×, add a bookmark with a note.
9. On the item page tap **Read**, then tap a paragraph in chapter 3. Audio jumps to the start of chapter 3, and that chapter is highlighted.
10. Turn airplane mode off and open Noteable on the phone for a few seconds, so it syncs. On the laptop, tap **Refresh** in the Library: the phone's newer position, speed and bookmark appear.

## Open questions

1. The phone needs to be online once after the laptop pauses (step 3) to learn the position. (Kept as planned; Rob said go.)
2. ~~Speed default~~ Answered 2026-10-08: strictly per item; new items start at 1×.
3. ~~Sleep timer~~ Answered 2026-10-08: no sleep timer at all.

## Change log

- 2026-10-08: built and deployed. Rob's decisions: speed per item only (new items start at 1×), and no sleep timer.
- **No separate outbox (`pendingWrites`).** Playback and bookmarks are saved on the device first, and every sync merges the device copy with Drive (latest `updatedAt` wins per item / per bookmark; bookmark deletes are soft). That covers offline progress without a queue. It also means two devices writing at once can't drop each other's changes, apart from a sub-second race on the same item.
- `src/player/source.ts` and `src/ui/itemCard.ts` were folded into `src/offline/downloads.ts` (`audio()` / `text()` pick the device copy or Drive) and `src/ui/library.ts`.
- Settings are on the **Account** tab (default voice, storage used). A **Player** tab and a mini player above the tabs were added.
- Resume rewinds 2 s for context. "Previous chapter" goes to the start of the current chapter if more than 3 s in, like most players. "Back 15 s" at the very start of a chapter goes into the end of the previous one.
- `dompurify@3.4.16` sanitises the reading view.
- **Fixed:** the service worker served the app instead of the `/spikes/` test pages (`navigateFallbackDenylist`).
- **Known limit:** an item that is *not* downloaded fetches each chapter from Drive. If sign-in lapses (about an hour) while the phone is locked, playback can stop at a chapter boundary because no tap is possible to reconnect. The next chapter is fetched as soon as the current one starts, which covers one boundary. For long listens, **Download** first. Phase 4 adds a proactive token refresh before long sessions.
- **Browser check (desktop, pipeline test page):** open plays ch 1, Media Session metadata is set ("1. Overview / Pipeline test / General"), speed 1.5× applies, +15 s at the end of a chapter moves to the next, end of a chapter auto-advances and keeps playing, and pause writes chapter/position/speed to `State/playback.json`.
- Tests: 58 unit tests (state merge and two-device sync, library index, downloads offline, listened %, plus earlier phases).

# Phase 8 — Everyday listening and housekeeping

Status: **planned** (not started). Proposed by Claude on 2026-10-08 from Rob's "All 20" (upgrades 1–5, 13, 14, 19, 20). Not part of the original spec.

## Goal

Daily use feels smooth: I pick up where I was from the top of the Library, line up items for the commute, skip dead air at speed, see whether the desktop is online before sending, and keep storage tidy.

## Scope

**In this phase**

- (2) **Continue listening** shelf: the last 3 started-but-unfinished items at the top of the Library, with one-tap Resume.
- (4) **Per-chapter progress**: ✓ listened / part-listened / not started on the item's chapter list. Needs per-chapter listened state in `playback.json` (see step 2).
- (3) **Up next**: a play queue of items. "Play next" and "Add to up next" on items; when an item ends, the next one starts; the queue syncs through `State/upnext.json`.
- (1) **Skip silence**: while playing at 1.25× or faster, long silences (over 0.8 s) are shortened. Review-question pauses (5 s) are kept.
- (5) **Car and lock-screen polish**: Media Session artwork per collection (a generated cover with the collection name), and titles kept short for car screens ("Ch 3 · Opportunity cost").
- (14) **Desktop online indicator**: the worker writes `State/worker.json` (last seen, version, speed, paused) every poll. The app shows "Desktop online · seen 40 s ago" or "Desktop offline · last seen 2 h ago" next to Send to desktop and on the Queue tab.
- (13) **Auto-route long jobs**: when the estimate is over a threshold (default 30 min of audio) and the desktop was seen in the last 5 minutes, the Generate button becomes "Send to desktop (recommended)". This device stays one tap away.
- (19) **Report a problem**: the app keeps a small rolling log (last 300 lines) on the device. **Account → Report a problem** writes `Noteable/Logs/<date>-<device>.md` with the log, app version, device, and the current item's `item.json`. The worker writes its log there on request too. Rob can then ask Claude in chat to read it.
- (20) **Storage and cleanup**: Account → **Storage** lists downloaded items by size with Remove. Item page gets **Delete item** (moves the folder to Drive trash, recoverable for 30 days; clears downloads, playback and bookmarks for it on this device).

**Left for later**

- Study features (phase 9), generation and import upgrades (phase 10).

## Steps

1. [ ] `src/library/continue.ts` + Library header section; unit tests for "started but unfinished" rules (finished = within 30 s of the end of the last chapter).
2. [ ] Playback state v2: `items[id].chapters[n] = { maxPositionSec }` alongside the current position (backward compatible; merge takes the max per chapter). `src/sync/state.ts`, migration test.
3. [ ] `src/player/upNext.ts` (queue model + `State/upnext.json` sync, latest-wins), player `ended` → next item; Up next list on the Player tab with reorder/remove.
4. [ ] `src/player/skipSilence.ts`: Web Audio `AnalyserNode` on the audio element; when the level stays under a threshold for 0.8 s at ≥1.25×, jump ahead to where the sound resumes (bounded; never inside a review pause, detected as silence ≥ 4.5 s). Toggle in the player (default on).
   - Risk: Web Audio on a media element can stop background playback on some Android builds. Ships behind the toggle; tested locked on the S23 before default-on.
5. [ ] `src/player/artwork.ts`: draw a 512×512 cover (collection name + colour hash) on canvas → blob URL for Media Session; shorter metadata titles.
6. [ ] Worker: write `State/worker.json` on each poll (`lastSeen`, `version`, `rtf`, `paused`, `signedIn`); app `src/queue/workerStatus.ts`; indicator on item page and Queue tab.
7. [ ] Auto-route: threshold in `settings.json` (`autoDesktopOverMin`, default 30); item page picks the primary button.
8. [ ] `src/log.ts` ring buffer (IndexedDB, 300 lines; errors, sync failures, job events); Account → Report a problem; worker writes its tail to `Logs/` when a `Logs/request-worker.json` flag file appears.
9. [ ] Account → Storage list; Item → Delete item (confirm dialog), `Storage.delete(itemPath)` then local cleanup.
10. [ ] Commit, deploy, restart the worker, update this doc and `docs/TESTING.md`.

## Tests

- Unit: continue-listening selection, per-chapter max merge, up-next sync merge, silence-skip decision function (fed synthetic level frames; never skips a 5 s gap), worker-status freshness, auto-route rule, log ring buffer, delete clears local state.
- Browser: skip-silence with a generated test MP3 at 1.5× (measured duration shortened, 5 s pause intact); up-next hand-over between two items on the pipeline page.
- Worker: `State/worker.json` written on the real Drive.

## Gate (proposed)

> Done when: on the S23, Rob resumes from "Continue listening", plays two items back to back from Up next with the phone locked, sees "Desktop online" before sending a long item, and deletes a test item.

1. Library → the **Continue listening** shelf shows the item last played → tap Resume.
2. Add a second item with **Add to up next**. Lock the phone and let the first finish: the second starts on its own, and the lock screen shows its title and cover.
3. At 1.5× with Skip silence on, gaps feel shorter; a review question still pauses 5 s.
4. Open a long item: the main button says **Send to desktop (recommended)** with "Desktop online · seen N s ago".
5. Account → **Report a problem** → a file appears in Noteable/Logs.
6. Delete the **Desktop Worker Test** item; it's in Drive's trash.

## Open questions

1. Skip silence: on by default at 1.25× and faster, or off by default?
2. Auto-route threshold: 30 minutes of audio OK?
3. Delete item: Drive trash (recoverable for 30 days) is the plan. OK?

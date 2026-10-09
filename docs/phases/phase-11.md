# Phase 11 — Daily polish and reliability

Status: **planned** (not started). Proposed by Claude on 2026-10-09 from Rob's second "All 20" (upgrades 1–5, 16, 17, 19). Not part of the original spec.

## Goal

Listening needs less fiddling: it rewinds just enough on resume, has a big-button car mode, downloads what I'll need on Wi-Fi, sounds even in volume, lets me hear voices before picking, syncs lighter, keeps safety copies of my progress, and reads comfortably.

## Scope

**In this phase**

- (1) **Smart rewind**: resume rewinds 2 s after < 5 min away, 10 s after < 1 h, 20 s after < 1 day, 30 s after longer (from the saved `updatedAt`).
- (2) **Car mode**: Player → 🚗 Car mode: full-screen, giant play/pause, ±15 s, next chapter, current chapter title, screen kept on while open (Wake Lock), dark.
- (3) **Auto-download on Wi-Fi**: when the app is open on Wi-Fi (`navigator.connection.type === 'wifi'`, Android), download Up next items and items finished by the desktop in the last 7 days, up to a cap (default 1 GB of Noteable downloads; oldest auto-downloads removed first, never manual ones). Off on unknown connections (iPhone). Toggle in Account.
- (4) **Loudness levelling**: at generation, each sentence group is scaled towards a target loudness (RMS −20 dBFS, gain capped at ±6 dB, peak-limited), so voices and chapters match. New audio only; existing audio is unchanged until regenerated.
- (5) **Voice samples**: ▶ next to each voice in the picker plays a 5 s sample. Generated once on this device with the local engine, cached in IndexedDB. (No sample files are shipped, keeping the app small.)
- (16) **Lighter sync**: Drive `changes` feed (`changes.getStartPageToken` / `changes.list`) instead of rescanning `Library/` every 2 minutes; only changed item folders are re-read, with a full rescan as a fallback every 30 minutes or if the token is lost. A `Storage.changes(token)` interface addition, optional like `browse`.
- (17) **Safety copies**: once a day the app copies `State/playback.json`, `bookmarks.json`, `cards.json` and `upnext.json` to `State/backups/<date>/`, keeping 7 days. Account → **Restore progress from…** lists the days and restores after a confirm (merged as "newest wins" is *not* used here; restore replaces).
- (19) **Reader comfort**: text size (4 steps), line spacing, and a light theme for reading (app-wide theme: System / Dark / Light), remembered per device.

**Left for later**

- True background downloads with the app closed (needs Periodic Background Sync, unreliable on Android without heavy engagement; not attempted).

## Steps

1. [ ] `src/player/rewind.ts` (pure, tested) → used in `Player.open`.
2. [ ] `src/ui/carMode.ts` overlay + Wake Lock; entry from the Player tab and the mini player (long-press).
3. [ ] `src/offline/autoDownload.ts`: candidates (Up next, recent desktop jobs from `Queue/` done in 7 days), cap and eviction, Wi-Fi check, runs after sync; `Downloads.records` gains `auto: true`.
4. [ ] `src/audio/level.ts`: per-group gain → `generateItem` before `writer.push` (phone and worker share it); tests on synthetic PCM.
5. [ ] `src/ui/voicePicker.ts` with samples: generate "Hello, I'm Bella. This is how I sound in Noteable." via the TTS worker, cache in IndexedDB.
6. [ ] `DriveStorage.changes()` + `LibraryIndex.refreshChanges()`; token stored in IndexedDB; tests with a fake changes feed.
7. [ ] `src/sync/backups.ts`: daily copy (first sync after midnight local), prune to 7, restore; tests.
8. [ ] Theme + reader settings (`src/ui/theme.ts`, CSS custom properties for light theme), Account section.
9. [ ] Commit, deploy, restart worker (loudness), docs and testing guide.

## Tests

- Unit: rewind table, auto-download selection/cap/eviction, level gain bounds (silence untouched, limiter), changes-feed handling (folder paths of changed files → item re-read), backup naming/pruning/restore, theme persistence.
- Browser: car mode renders and keeps the screen on; voice sample plays; light theme contrast.

## Gate (proposed)

> Done when: on the S23, Rob resumes an item the next day and hears the last ~20 s again, drives with Car mode, finds Up next items already downloaded after being on home Wi-Fi, picks a voice by listening to samples, and restores yesterday's progress from a safety copy.

## Open questions

1. Smart rewind amounts (2 / 10 / 20 / 30 s) OK?
2. Auto-download cap 1 GB, Wi-Fi only, Up next + recent desktop jobs: OK?
3. Light theme for the whole app, or the reading view only?

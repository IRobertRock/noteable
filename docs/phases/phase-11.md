# Phase 11 — Daily polish and reliability

Status: **built 2026-10-09; gate not yet tested by Rob** (see docs/TESTING.md). Proposed by Claude on 2026-10-09 from Rob's second "All 20" (upgrades 1–5, 16, 17, 19). Not part of the original spec.

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

1. [x] `src/player/rewind.ts` (pure, tested) → used in `Player.open`.
2. [x] `src/ui/carMode.ts` overlay + Wake Lock; entry from the Player tab and the mini player (long-press).
3. [x] `src/offline/autoDownload.ts`: candidates (Up next, recent desktop jobs from `Queue/` done in 7 days), cap and eviction, Wi-Fi check, runs after sync; `Downloads.records` gains `auto: true`.
4. [x] `src/audio/level.ts`: per-group gain → `generateItem` before `writer.push` (phone and worker share it); tests on synthetic PCM.
5. [x] `src/ui/voicePicker.ts` with samples: generate "Hello, I'm Bella. This is how I sound in Noteable." via the TTS worker, cache in IndexedDB.
6. [x] `DriveStorage.changes()` + `LibraryIndex.refreshChanges()`; token stored in IndexedDB; tests with a fake changes feed.
7. [x] `src/sync/backups.ts`: daily copy (first sync after midnight local), prune to 7, restore; tests.
8. [x] Theme + reader settings (`src/ui/theme.ts`, CSS custom properties for light theme), Account section.
9. [x] Commit, deploy, restart worker (loudness), docs and testing guide.

## Tests

- Unit: rewind table, auto-download selection/cap/eviction, level gain bounds (silence untouched, limiter), changes-feed handling (folder paths of changed files → item re-read), backup naming/pruning/restore, theme persistence.
- Browser: car mode renders and keeps the screen on; voice sample plays; light theme contrast.

## Gate (proposed)

> Done when: on the S23, Rob resumes an item the next day and hears the last ~20 s again, drives with Car mode, finds Up next items already downloaded after being on home Wi-Fi, picks a voice by listening to samples, and restores yesterday's progress from a safety copy.

## Decisions

Rob accepted all defaults ("go", 2026-10-09): rewind 2/10/20/30 s; auto-download Wi-Fi only, 1 GB cap, Up next + desktop jobs from the last 7 days, manual downloads never removed; light theme app-wide (Dark / Light / Same as the phone).

## Change log (differences from the plan)

- **Levelling target**: RMS 0.1 (≈ −20 dBFS) with gain clamped to 0.5–2× (±6 dB) and a 0.97 peak limit, applied per sentence group. Near-silent groups are left alone.
- **Voice samples**: no separate `voicePicker.ts`; a **▶ Hear** button sits next to the existing voice list on the item page. `voiceSample()` lives in `src/generate/jobs.ts` so it shares the already-loaded engine; the PCM is cached in IndexedDB (`sample.<voice>`). On a device that hasn't generated before, the first sample downloads the voice model.
- **Car mode** opens from a **🚗 Car mode** button on the Player tab (no mini-player long-press: it clashed with the mini player's tap-to-open and is easy to trigger by accident). Phone Back closes it.
- **Lighter sync**: the 2-minute sync and the Library screen's auto-refresh use the changes feed; the **Refresh** button still does a full rescan. Any change to a folder or collection (new item, move, rename) triggers a full rescan, as does a lost token or 30 minutes since the last one.
- **Safety copies** are made by whichever device syncs first each day (marker kept per device, and skipped if today's folder already exists). **Restore** replaces the four files, clears this phone's copies and reloads. Another device that is still open with newer local progress may merge it back on its next sync; close Noteable on other devices before restoring.
- **Auto-download** runs after each sync (on open and every 2 minutes while open), only when Android reports Wi-Fi or Ethernet. iPhone never reports the connection type, so it stays off there. Account → **This device** has the on/off switch.
- **Reader comfort**: text size (4 steps) and line spacing apply to the Read view; the theme applies everywhere. All three are per device (localStorage).


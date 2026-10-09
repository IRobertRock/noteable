# Phase 13 — Desktop power and devices

Status: **planned** (not started). Proposed by Claude on 2026-10-09 from Rob's second "All 20" (upgrades 12–15, 18, 20). Not part of the original spec.

## Goal

The desktop does more with less babysitting: a whole course queued in one tap, the PC kept awake while it works, single chapters regenerated, lecture recordings turned into text, a worker dashboard on the phone, and Noteable working properly on the iPhone.

## Scope

**In this phase**

- (12) **Send a whole collection**: Library → collection → **Send all to desktop**. Queues every item with chapters still to generate (one job per item, in Library order), skipping items already queued.
- (13) **Keep the PC awake**: while a job runs, the worker asks Windows not to sleep (`SetThreadExecutionState` via a small PowerShell helper held open for the job), and releases it when the queue is empty. The display may still turn off.
- (14) **Regenerate this chapter**: item page → chapter menu → **Regenerate this chapter** (this device or desktop). Uses the existing per-chapter pending logic; the job's `chapters` list is honoured by the worker (today it regenerates everything not done).
- (15) **Lecture recordings → text** (spike first): drop an audio file (MP3/M4A/WAV/WebM, e.g. a phone recording of a lecture) in the Inbox → **Transcribe on desktop** → the worker transcribes it with Whisper (transformers.js on WebGPU in the same headless Chrome as the voices), splits it into ~10-minute sections, lightly cleans fillers ("um", "uh", repeated words), and creates a Narrate item with the text (no audio, since the original recording *is* the audio) plus the recording in `sources/`. From there: read it, or **Ask Claude for a study guide**.
  - The original recording becomes playable as the item's audio (one chapter per section, cut from the file), so it works in the player, Quiz me excepted.
- (18) **iPhone pass**: install, sign-in (Google Identity popups are unreliable in iOS home-screen apps → add a full-page redirect sign-in fallback), background audio and lock-screen controls in Safari, WebGPU or WASM generation (likely slow → default to Send to desktop on iPhone), share sheet (iOS doesn't support Web Share Target; documented). Fixes as found.
- (20) **Worker dashboard**: Queue tab gains a desktop panel: status, engine (GPU/CPU), speed, last 10 jobs (time, item, speed, result), last problem, and **Pause / Resume** (via `State/worker-control.json`, read by the worker on each poll).

**Left for later**

- Speaker labels in transcripts; non-English lectures (unless Rob wants a multilingual model, see questions).

## Steps

1. [ ] **Spike (15):** Whisper `small.en` vs `base.en` on WebGPU in headless Chrome on the RX 9070 XT: speed on a 10-minute test recording, word error rate by eye. Go/no-go and model choice recorded here.
2. [ ] (12) `sendCollection()` in `src/queue/jobs.ts` + Library action; tests.
3. [ ] (13) `worker/keepAwake.ts` (spawned PowerShell holding `ES_CONTINUOUS | ES_SYSTEM_REQUIRED`, killed on idle); tests for the start/stop logic.
4. [ ] (14) Item chapter menu + `regenerateChapter()`; `generateItem` gains an `only?: number[]` option; worker passes `job.chapters`.
5. [ ] (15) `spikes/engine.html` gains `transcribe(audio)`; `worker/transcribe.ts`; job type `transcribe`; Inbox action for audio files; item creation with section audio cut by time (MP3 frames copied, no re-encode where possible).
6. [ ] (18) Redirect sign-in fallback (`src/auth/redirect.ts`, implicit grant to the app URL; requires adding the app URL as an authorised redirect URI in the Google client, done with Rob in the browser pane), iOS-specific checks and fixes from Rob's testing.
7. [ ] (20) Worker writes `recent` jobs into `State/worker.json`; reads `State/worker-control.json`; Queue tab panel.
8. [ ] Commit, deploy, restart worker, docs and testing guide.

## Tests

- Unit: collection queuing skips queued/complete items, keep-awake lifecycle, `only` chapters in generation, transcript cleanup and sectioning, worker-control pause handling, redirect-token parsing.
- Desktop: transcription spike numbers; a real 10-minute recording end to end.
- iPhone: Rob's checklist.

## Gate (proposed)

> Done when: Rob sends a whole course to the desktop in one tap and the PC stays awake until it's done, regenerates one chapter after a pronunciation fix, turns a lecture recording into a readable item, pauses the worker from the phone, and installs, signs in and listens on the iPhone.

## Open questions

1. Whisper model: `small.en` (English only, better accuracy, ~500 MB on the desktop) or multilingual `small` (if any lectures aren't in English)?
2. iPhone sign-in fallback: OK for me to add the app's address as a redirect URI on the Google client (in the browser pane, like before)?
3. Keep the PC awake only while a job is running (not while idle)?

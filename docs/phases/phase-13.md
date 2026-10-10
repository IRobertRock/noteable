# Phase 13 — Desktop power and devices

Status: **built 2026-10-09; gate not yet tested by Rob** (see docs/TESTING.md). iPhone fixes from Rob's testing still to come. Proposed by Claude on 2026-10-09 from Rob's second "All 20" (upgrades 12–15, 18, 20). Not part of the original spec.

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

1. [x] **Spike (15):** Whisper `small.en` vs `base.en` on WebGPU in headless Chrome on the RX 9070 XT: speed on a 10-minute test recording, word error rate by eye. Go/no-go and model choice recorded here.
2. [x] (12) `sendCollection()` in `src/queue/jobs.ts` + Library action; tests.
3. [x] (13) `worker/keepAwake.ts` (spawned PowerShell holding `ES_CONTINUOUS | ES_SYSTEM_REQUIRED`, killed on idle); tests for the start/stop logic.
4. [x] (14) Item chapter menu + `regenerateChapter()`; `generateItem` gains an `only?: number[]` option; worker passes `job.chapters`.
5. [x] (15) `spikes/engine.html` gains `transcribe(audio)`; `worker/transcribe.ts`; job type `transcribe`; Inbox action for audio files; item creation with section audio cut by time (MP3 frames copied, no re-encode where possible).
6. [x] (18) Redirect sign-in fallback (`src/auth/redirect.ts`, implicit grant to the app URL; requires adding the app URL as an authorised redirect URI in the Google client, done with Rob in the browser pane), iOS-specific checks and fixes from Rob's testing.
7. [x] (20) Worker writes `recent` jobs into `State/worker.json`; reads `State/worker-control.json`; Queue tab panel.
8. [x] Commit, deploy, restart worker, docs and testing guide.

## Tests

- Unit: collection queuing skips queued/complete items, keep-awake lifecycle, `only` chapters in generation, transcript cleanup and sectioning, worker-control pause handling, redirect-token parsing.
- Desktop: transcription spike numbers; a real 10-minute recording end to end.
- iPhone: Rob's checklist.

## Gate (proposed)

> Done when: Rob sends a whole course to the desktop in one tap and the PC stays awake until it's done, regenerates one chapter after a pronunciation fix, turns a lecture recording into a readable item, pauses the worker from the phone, and installs, signs in and listens on the iPhone.

## Decisions

Rob accepted all defaults ("go", 2026-10-09): Whisper small.en; Claude adds the redirect URI; keep the PC awake only while a job runs.

## Spike results (step 1) and a GPU problem found on the way

- **WebGPU on the RX 9070 XT gives garbage output**, for Kokoro and for Whisper alike. Every Chrome setup returns samples around 10^16 or NaN: headless or windowed, D3D12, Vulkan or D3D11, fp32 or fp16. The adapter is the real GPU ("amd / rdna-4"), so this looks like a Dawn/ONNX Runtime WebGPU bug on RDNA 4. The Phase 10 spike measured only speed (15.5×), never the sound.
  - **No bad audio was delivered.** Both desktop jobs so far ran on the CPU; the worker log never shows "Voice engine: GPU".
  - **Fix:** the GPU engine now speaks a test sentence when it starts and checks every chunk (`badAudio()`: non-finite samples, peak over 4, or near-silence). If the check fails, it uses the CPU (8.5×). On this PC that means the CPU, until a driver or Chrome update fixes WebGPU; the worker picks the GPU up again by itself when the check passes.
- **Whisper runs in Node instead** (onnxruntime-node, CPU, like the voices). The lecture test was 129 s of speech:

  | Model | Speed | Word errors |
  | --- | --- | --- |
  | base.en, fp32 | 30.6× | 47.6% (dropped chunks) |
  | **small.en, fp32** | **9.1×** | **10.5%** |
  | small.en, q8 | 7.5× | 11.6% |
  | small.en on DirectML | failed | — |

  **Go with small.en on the CPU.** The errors turned out to be Whisper's own 30-second chunk stitching dropping sentences. Noteable now cuts the audio into ≤30 s windows at quiet moments itself, which took the real end-to-end test to **1.4% word errors**. A 1-hour lecture takes about 7–12 minutes.

## Change log (differences from the plan)

- **(12) Send all to desktop**: a course button, shown when 2 or more items need audio. One job per item in its own voice, oldest first. Items already queued, and review items, are skipped.
- **(13) Keep awake**: a hidden PowerShell helper calls `SetThreadExecutionState(ES_CONTINUOUS | ES_SYSTEM_REQUIRED)` every 30 s while a job runs. It's stopped when the worker goes idle and exits by itself if the worker dies. The status note says "Keeping the PC awake".
- **(14) Regenerate one chapter**: a ↻ button next to each finished chapter. It marks only that chapter as to-do (`markChapterForRegenerating`), then the usual "this phone / Send to desktop" choice appears. No `only` option was needed: generation already skips finished chapters, so the job redoes just that one. The old audio keeps playing until the new file replaces it.
- **(15) Transcription**:
  - Flow: an audio file in the Inbox (or uploaded from the phone) → **🎙 Transcribe on desktop** → a `transcribe` job (`kind`, `source`).
  - Chrome decodes the file (MP3, M4A, WAV, WebM, OGG, FLAC: anything Chrome plays) on the engine page. Whisper small.en runs in Node.
  - The recording is cut into ~10-minute parts at the quietest moment within ±30 s of each mark. Each part's text is cleaned (um, uh, erm, hmm, repeated words), paragraphed on pauses, and saved as a chapter. Each part's audio is re-encoded to 64 kbps MP3 as that chapter's audio, so it plays like any item.
  - The recording moves to `sources/` only at the very end; a failed job leaves it in the Inbox.
  - Items are marked `recording` (no voice or generate controls; "Ask Claude for a study guide" works).
  - Phone-side upload of recordings goes to the Inbox in Drive first.
- **(18) iPhone sign-in**:
  - Full-page sign-in (OAuth implicit redirect, with `state` checked) is used automatically in an iPhone home-screen app. On any device, the sign-in screen also has "Sign-in window not working? Sign in on a full page".
  - Redirect URIs `https://irobertrock.github.io/noteable/` and `http://localhost:5173/noteable/` were added to the "Noteable web" client on 2026-10-09 (Google says changes can take a few minutes to hours).
  - Each hourly reconnect on the iPhone is a full-page trip to Google and back.
  - Other iPhone checks wait for Rob's testing (iOS has no share target; generation on the iPhone will be slow, so use Send to desktop).
- **(20) Desktop panel** on the Queue tab:
  - What it's doing now, engine (GPU/CPU), last speed, keeping-awake, last problem, the last 10 jobs, and **Pause / Resume desktop**.
  - Pause and resume are written to `State/worker-control.json`; the worker applies each request once on its next poll (within a minute) and finishes the current job before pausing. The tray's pause still works too.
  - On start-up, an old pause request (over 7 days) is ignored.


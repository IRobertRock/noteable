# Phase 4 — Sleep mode

Status: **built, gate not yet tested**. Deployed 2026-10-08; the gate steps are in `docs/TESTING.md`.

## Goal

I can start a long generation on my S23, tap Sleep mode, put the phone in my pocket, and it finishes with a vibration and chime while the screen stays dark.

## Scope

**In this phase**

- Screen Wake Lock held during generation, re-acquired when the page becomes visible again.
- Full-black sleep screen with a dim, slowly drifting progress line (burn-in avoidance).
- Touch lock released by a ~1.5 s long press (with a visible ring filling while held).
- Completion: vibration pattern, soft chime (generated with Web Audio, no asset), screen wakes (sleep overlay fades to normal UI).
- Warnings: power button / app switch pauses the job; charge for long jobs; over ~45 minutes of audio suggests Send to desktop (button disabled with "phase 6" note until then).
- Measured-speed estimate: per-device real-time factor stored in IndexedDB from previous runs (and the phase 2 benchmark), shown before Generate.
- Pause/resume handling when the wake lock is lost.

**Left for later**

- Send to desktop actually working (phase 6).
- Running generation with the screen off. Not possible for a web page on Android; see risk list.

## Steps

1. [x] `src/sleep/wakeLock.ts`: `navigator.wakeLock.request('screen')`, `release` listener, re-request on `visibilitychange` → visible. Exposes `held` state.
2. [x] `src/sleep/sleepScreen.ts` + CSS: fixed full-screen `#000` overlay, `cursor: none`, hides status bar via `document.documentElement.requestFullscreen()` (navigation UI hidden); progress line at 15–20 % opacity, moves to a new random position every 60 s with a 10 s transition; text minimal ("Ch 4/9 · 38 %").
3. [x] `src/sleep/touchLock.ts`: captures `pointerdown`/`pointerup`/`contextmenu`; 1.5 s hold unlocks; ignores multi-touch (pocket brushes). Blocks the Android back gesture with a `history.pushState` guard while locked.
4. [x] `src/sleep/completion.ts`: `navigator.vibrate([200,100,200,100,400])`, chime via `OscillatorNode` (two soft sine notes, ~0.6 s), exit fullscreen, release wake lock.
5. [x] `src/generate/estimate.ts`: chars-per-audio-second constant (measured from phase 2 output), device RTF history (rolling median of last 5 runs, keyed by device fingerprint = UA + GPU adapter info), estimate = audio length / RTF. UI in `src/ui/generate.ts`: "About 34 min of audio, ready in about 31 min on this phone." Warn above 45 min.
6. [x] Pause handling in `runChapterJob`: if the page goes hidden, the current sentence group finishes if it can, then the job waits; on visible, wake lock is re-taken and the job continues. Progress is never lost because chapters checkpoint (phase 2) and sentence groups inside a chapter checkpoint to IndexedDB (new in this phase).
7. [x] Token handling for long jobs: before starting, refresh the token; MP3s queue in IndexedDB if upload fails with an auth error; on completion (screen wakes) show "Tap to finish uploading" if any are queued.
8. [x] Commit, deploy, update this document.

## Tests

- **Unit:** estimate maths, rolling median, touch lock timing (fake timers), wake-lock re-acquire logic (mock `navigator.wakeLock`), sentence-group checkpoint resume.
- **Browser pane:** sleep screen renders, long-press unlock, completion with a fake 10-second job.
- **On the S23 before the gate:** a 5-minute job in sleep mode, phone face-down on the desk.

## Gate

> Done when: a 20-minute item generates on the S23 with the screen in sleep mode and the phone in a pocket.

1. `phase-4-gate-test.md` is already in `Noteable/Inbox` (Adam Smith, *Wealth of Nations* Book I ch. 2–3, public domain; about 21 minutes of audio in 2 chapters). Import it on the S23.
2. Charge the phone to at least 60 % (plug in if you can). Close other heavy apps.
3. Tap **Generate** → **This device**. Check the estimate shown and note it.
4. Tap **Sleep mode**. The screen goes black with a dim progress line.
5. Tap the screen briefly: nothing happens. Press and hold about 1.5 s: the ring fills and the normal screen returns. Tap **Sleep mode** again.
6. Put the phone in your pocket. Walk around or sit for the estimated time. **Do not** press the power button.
7. When it finishes, the phone vibrates and chimes, and the screen wakes.
8. Check Drive: two MP3s in the item's `audio/` folder. Play one in Noteable.
9. Tell me the actual time vs the estimate, and how warm the phone got (cool / warm / hot).

## Open questions

1. Samsung "Accidental touch protection" (Settings → Display) can interfere with long-press in a pocket; fine to leave on? (Left on; noted in the testing guide.)
2. Chime: soft two-note sine (default used).
3. Sleep mode stays a separate tap, as the spec says (default used).

## Change log

- 2026-10-08: built and deployed straight after phase 3 (Rob: "Go to next phase", test later). Open questions answered with the defaults above.
- **Wake Lock is held for every generation job**, not only in sleep mode. Otherwise the normal screen timeout pauses a job even when Rob doesn't use sleep mode. Sleep mode asks again from its own tap, and if the browser refuses, it tells Rob to raise the screen timeout.
- **Mid-chapter checkpoints** (step 6) work by saving the MP3 frames written so far plus the next step index every ~30 s of audio. On resume, a new encoder appends: constant-bitrate MP3 frames concatenate cleanly, and at most one frame (~50 ms) is lost at the join. Checkpoints are ignored if the voice or the chapter text changed.
- **Sign-in refresh from a tap** (`auth.ensureFresh`): Generate refreshes the token if it would expire during the estimated job (capped at ~55 min, since tokens last an hour). Play does the same for items that aren't downloaded (30 min). This also addresses the phase 3 "known limit" for listening. Jobs longer than an hour still finish generating; any uploads that fail wait on the device for one tap on **Finish uploading** after the screen wakes.
- **Estimate**: the speaking rate starts at 15 characters per second (the phase 2 gate measured ~14.7) and blends towards measured values. Device speed is the median of the last 5 runs on this device. Before the first run, the item page says the speed will be measured.
- Time paused in the background and time left are shown while generating, and on the sleep screen.
- **Gate file**: Adam Smith, *Wealth of Nations* Book I ch. 2–3 (Project Gutenberg #3300, public domain), ~19,600 characters ≈ 21 minutes, 2 chapters (the plan said 5 chapters; length is what the gate tests).
- **Browser check (desktop, pipeline page)**: sleep overlay shows; a 0.4 s tap is ignored; it wakes on its own when the job finishes; a 1.7 s hold wakes it early and the job keeps running. The test browser refuses Wake Lock permission (`NotAllowedError`), which is why the refusal warning was added. Chrome on Android grants it.
- Tests: 64 unit tests (adds estimate, mid-chapter checkpoint resume, voice-change invalidation).

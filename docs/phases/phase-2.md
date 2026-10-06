# Phase 2 — Narrate a markdown file

Status: **planned** (not started)

## Goal

I can drop a markdown file into `Noteable/Inbox`, tap Import and Generate on my phone, and get one MP3 per chapter in that item's `audio/` folder in Drive.

## Scope

**In this phase**

- Inbox listing (through `Storage.list('Inbox')`).
- Markdown import: YAML header (or defaults), `##` headings → chapters, item folder creation in `Library/<collection>/<item>/` with `item.json`, `sources/`, `text/`.
- Text normalisation for speech (strip markdown syntax, read `**Q:**`/`**A:**` as "Question"/"Answer" — basic version; full marker handling is phase 7).
- kokoro-js generation in a Web Worker: WebGPU fp32 when available, otherwise WASM q8.
- Sentence groups of about 300 characters.
- Streaming MP3 encoding at 64 kbps mono, one file per chapter.
- Resumable upload to `audio/NN.mp3`; progress saved in `item.json` after every chapter so an interrupted job resumes at the next unfinished chapter.
- Model download progress and caching; a plain progress screen.
- Speed benchmark on the laptop and desktop (spec: "First task in phase 2").

**Left for later**

- Player, reading view, library sync, offline (phase 3).
- Sleep mode, Wake Lock, the device-speed estimate screen (phase 4). During this phase the screen must be kept on by hand during generation.
- PDF/DOCX/etc., cleanup rules, text preview editing (phase 5).
- Send to desktop (phase 6).
- `[pause Ns]`, per-item voice override from the header (phase 7). The header `voice` is parsed and stored now but the settings default voice is used until phase 7 wires the override through.

## Steps

1. [ ] **Spike first (half a day, results written here before the rest).** `spikes/kokoro-mp3.html` + `spikes/kokoro-mp3.ts`, served by `npm run dev`:
   - Load `kokoro-js@1.2.1` (`npm install kokoro-js@1.2.1`, which brings `@huggingface/transformers@3.x`) with `onnx-community/Kokoro-82M-v1.0-ONNX`, `dtype: 'fp32', device: 'webgpu'`.
   - Generate 2 minutes of text, encode with `wasm-media-encoders@0.7.0` (LAME in WASM, MP3 at 24 kHz mono 64 kbps); fall back to `@breezystack/lamejs@1.2.7` if it fails.
   - Measure real-time factor on laptop and desktop (Chrome, and Edge on the laptop), in a tab and in the installed PWA on the S23. Record the numbers in SPEC's benchmark table.
   - Confirm the MP3 plays in Chrome Android, Safari iOS and Windows, and that its duration metadata is correct (Xing header).
2. [ ] **Dependencies:** `npm install kokoro-js@1.2.1 wasm-media-encoders@0.7.0 marked@18.1.0 yaml@2.9.1`.
3. [ ] **Model types.** `src/model/item.ts`: `Item` (`id`, `title`, `collection`, `mode`, `voice`, `sources[]`, `chapters[] {n, title, textFile, audioFile?, durationSec?, status}`, `status: 'draft'|'generating'|'ready'|'error'`, `createdAt`, `updatedAt`, `schema: 1`). `src/model/voices.ts`: the ten locked voices mapped to Kokoro IDs (`af_bella`, `af_nicole`, `af_river`, `af_sky`, `bf_emma`, `bf_lily`, `am_adam`, `am_eric`, `am_michael`, `bm_fable`).
4. [ ] **Guide parser.** `src/import/markdown.ts`: split YAML front matter (`yaml`), default `title` from first `#` or file name, default `collection: General`, `mode: narrate`; split body at `##` into chapters (text before the first `##` becomes "Introduction" if non-empty). Unit tested.
5. [ ] **Speech text.** `src/tts/speechText.ts`: markdown → plain spoken text (`marked` lexer; drop link URLs, image alt only, list bullets → sentence breaks, `**Q:**` → "Question.", `**A:**` → "Answer."). `src/tts/chunk.ts`: split into sentences, then pack into groups ≤ ~300 chars without splitting sentences (very long sentences split at `;`, `,`, then whitespace).
6. [ ] **Inbox screen.** `src/ui/inbox.ts`: lists `.md`/`.txt` files in `Inbox/` with size and date; **Import** button per file. Other file types show "Import arrives in phase 5".
7. [ ] **Import.** `src/import/importMarkdown.ts`: creates `Library/<collection>/<title>/` (name collision → ` (2)` suffix), moves the source into `sources/` via `Storage.move`, writes `text/NN.md` per chapter and `item.json` (`status: 'draft'`). Collection folder created if missing.
8. [ ] **TTS worker.** `src/tts/tts.worker.ts` (module worker): loads `KokoroTTS.from_pretrained`, picks WebGPU (`navigator.gpu?.requestAdapter()` succeeds) else WASM q8; posts model-download progress; `generate(chunk, voice)` returns Float32 PCM at 24 kHz. `src/tts/engine.ts` is the main-thread wrapper.
9. [ ] **MP3 encoder.** `src/audio/mp3.ts`: streaming encoder (`wasm-media-encoders` `createMp3Encoder()`, `configure({ sampleRate: 24000, channels: 1, bitrate: 64 })`), `encode(pcm)` per chunk so a whole chapter is never held as PCM, `finalize()` → `Blob` (`audio/mpeg`). Adds 250 ms silence between sentence groups and 1 s at chapter start.
10. [ ] **Job runner.** `src/generate/runChapterJob.ts`: for each chapter with status ≠ `done`: generate → encode → upload `audio/NN.mp3` via resumable upload → update chapter (`done`, `durationSec`) in `item.json`. On restart it skips finished chapters. Encoded MP3s are also kept in IndexedDB until the upload succeeds, so a token expiry mid-job never loses audio (see risk list).
11. [ ] **Resumable upload** in `DriveStorage.write` for blobs > 5 MB (`uploadType=resumable`, 8 MB chunks, resume on network error).
12. [ ] **Generate screen.** `src/ui/generate.ts`: voice picker (default from `settings.json`), Generate button, model download bar ("first time only, ~310 MB"), per-chapter progress, elapsed time, error with Retry. Calls `navigator.storage.persist()` before the first model download.
13. [ ] **Service worker:** confirm Workbox does not intercept `huggingface.co` / `cdn-lfs*.hf.co` (transformers.js caches the model itself in Cache Storage under `transformers-cache`).
14. [ ] Commit, deploy, update this document.

## Tests

- **Unit:** markdown parser (front matter, no front matter, no `##`, text before first `##`), speech text (Q/A, lists, links, code), chunker (no chunk > 300 except unbreakable words, no lost text: joined chunks == input modulo whitespace), item folder naming collisions, job runner resume (fake engine + fake storage; kill after chapter 2, restart, chapters 1–2 not regenerated).
- **Encoder test** in Vitest browser-less mode: encode 1 s sine wave, check MP3 frame sync bytes and bitrate/sample-rate header bits.
- **Local preview:** generate a 3-chapter test file on the laptop and desktop, play each MP3 in Chrome, Windows Media Player and VLC; check duration metadata.
- **Build checks:** typecheck, build, bundle-size report (the model is not in the bundle; worker chunk is lazy-loaded).

## Gate

> Done when: a markdown file dropped in the Inbox becomes chaptered MP3s in Drive, generated on the phone.

**On the S23 Ultra:**

1. On the laptop (or in the Drive app), put `gate-test.md` (I'll supply one: three `##` chapters, about 4 minutes of audio in total) into `Noteable/Inbox`.
2. Plug the phone in. Settings → Display → Screen timeout → 10 minutes (sleep mode doesn't exist until phase 4).
3. Open Noteable from the home-screen icon → **Inbox**. `gate-test.md` is listed.
4. Tap **Import**. The item appears under General with 3 chapters.
5. Tap **Generate** → **This device**. First time only: wait for the model download (about 310 MB; use Wi-Fi).
6. Watch chapters 1, 2, 3 tick to Done. Note the elapsed time and tell me.
7. Interruption check: start Generate on a second copy, switch apps during chapter 2, come back, tap **Resume**. Chapter 1 is not regenerated.
8. In the Drive app: `Noteable/Library/General/gate-test/audio/` has `01.mp3`, `02.mp3`, `03.mp3`; `sources/gate-test.md` exists; the Inbox is empty.
9. Tap each MP3 in the Drive app: it plays, in the voice you chose, with correct length.

## Open questions

1. What should importing do with the original file in `Inbox/` — **move** it into the item's `sources/` (my default, keeps Inbox meaning "not yet imported") or copy it and leave it?
2. Item folder name: the title from the header (default) or the file name?
3. Any sample markdown from a real course you'd like as the gate file instead of my test file?

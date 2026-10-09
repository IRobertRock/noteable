# Phase 10 — Better voices, faster desktop, smarter import

Status: **built, gate not yet tested**. Deployed 2026-10-09; gate steps in `docs/TESTING.md`. Proposed by Claude on 2026-10-08 from Rob's "All 20" (upgrades 11, 12, 15–18). Not part of the original spec.

## Goal

Audio sounds right (names and jargon pronounced correctly, two voices for Q and A), the desktop generates faster on its GPU, and more kinds of material import well: web pages shared from the phone, image-only slides, and maths and tables.

## Scope

**In this phase**

- (11) **GPU desktop worker** (spike first): DirectML in onnxruntime-node fails on Kokoro. The alternative is running the worker's generation in headless Chrome with WebGPU (the same engine as the 12.5× browser result on this PC), driven by the Node worker through Puppeteer's Chrome-for-Testing. CPU stays as the fallback.
- (12) **Pronunciation dictionary**: `State/pronunciations.json` (`"Mankiw": "MAN-kyoo"`, `"PPF": "P P F"`, regex allowed), edited in Account → Pronunciations, applied in `speechText` before chunking. Phone and desktop share it, and changing it marks affected chapters for regeneration (optional).
- (15) **Two voices per guide**: header `voices: { question: am_michael, answer: bf_emma }` (or `narrator`); `speechPlan` steps carry a voice; the generator switches per step.
- (16) **Share to Noteable**: PWA Web Share Target (Android, installed app). Sharing a page or text from Chrome opens Noteable's "Shared" screen: for a URL, Noteable fetches nothing itself (the spec says no fetcher) and instead saves `Inbox/<title>.url.md` with the link and any shared text, for Claude to turn into a guide. Plain shared text becomes an Inbox `.md` straight away.
- (17) **Image-only slides**: in PPTX, slides whose only content is a picture get OCR on the picture (Tesseract, as for scanned PDFs), shown in the preview as "(read from image)".
- (18) **Maths and tables**: simple inline maths (`x^2`, `a/b`, `≤`, `Σ`, `π`, `%`) read as words ("x squared", "a over b", "at most", "the sum of", "pi", "percent"). Tables are read with their column headers ("Year 2020: GDP 1.2 trillion; Inflation 3 percent").

**Left for later**

- Full LaTeX/MathML speech, and fetching web pages inside the app (excluded by the spec).

## Steps

1. [x] **Spike (11):** Puppeteer + Chrome-for-Testing headless with `--enable-unsafe-webgpu` on the RX 9070 XT; run the existing `tts.worker` page; measure RTF vs CPU. Decide go/no-go and record it here before building.
2. [x] (11) If go: `worker/gpuEngine.ts` (opens a local page serving the built TTS worker, generates over `page.evaluate`), with the engine chosen at start (`NOTEABLE_ENGINE=gpu|cpu`, default gpu with automatic CPU fallback).
3. [x] (12) `src/tts/pronounce.ts` + `State/pronunciations.json` sync + Account editor; tests.
4. [x] (15) Guide header `voices`, `SpeechStep.voice`, generator and estimate support; tests.
5. [x] (16) `share_target` in the manifest (`vite.config.ts`), service-worker POST handler, `src/ui/shared.ts`; Android test.
6. [x] (17) PPTX picture-only slides → extract `ppt/media/*` image → OCR → text.
7. [x] (18) `src/tts/mathSpeech.ts` and table reading with headers in `speechText` and the HTML/markdown readers; tests.
8. [x] Commit, deploy, restart worker, docs, testing guide.

## Tests

- Spike numbers recorded. Unit: pronunciation rules (whole-word, case, regex), two-voice plan, math phrases, table-with-headers reading, picture-only slide detection. Browser: share-target POST handled by the service worker (simulated). Worker: GPU engine produces byte-identical framing (same MP3 settings) and its speed is logged.

## Gate (proposed)

> Done when: "Mankiw" and "PPF" are said correctly in a regenerated chapter, a guide plays questions and answers in two voices, a page shared from Chrome lands in the Inbox, and the desktop logs GPU generation faster than 8.5×.

## Open questions

1. Puppeteer + Chrome for Testing: yes (Rob: go).
2. Shared links are saved to the Inbox for Claude (Rob: go).
3. Two voices plus an optional narrator for headings (Rob: go).

## Change log

- 2026-10-09: built and deployed.
- **GPU spike → go.** WebGPU needs a secure page (the first try on `about:blank` showed no adapter). On the deployed speed-test page: headless D3D12 14.5×, **headless Vulkan 15.5×**, windowed 15.5×, vs 8.5× on the CPU. The worker uses `puppeteer@25.13.0` (dev dependency; Chrome for Testing in the user cache) with `--enable-unsafe-webgpu --enable-features=Vulkan`, driving `spikes/engine.html` (exposes `window.noteable.load/generate`, PCM back as base64). The Chrome profile lives in `%APPDATA%\Noteable\chrome-profile` so the model downloads once. `AutoEngine` falls back to the CPU if Chrome or WebGPU fails, at start or mid-job; `NOTEABLE_ENGINE=cpu` forces the CPU. Self-test through the worker: job done, valid MP3s. Short texts show ~4× because each call has a fixed overhead; long jobs approach the spike's 15×.
- **Pronunciations:** `State/pronunciations.json`, edited in Account → Pronunciations, with a "Read as" try-it box. Plain rules are whole-word, and case-insensitive unless the word has capitals (acronyms then match exactly); regex rules are allowed. They apply to the spoken words, never to the "Question."/"Answer." labels. The generator reads the list at job start and folds it into the checkpoint key, so a changed list isn't mixed into a resumed chapter. Existing audio isn't regenerated automatically (the plan's optional step); regenerate the item to hear changes.
- **Voices:** header `voices: { question, answer, narrator }` (ids or names) → `item.voices = { question, answer, heading }`. Speech steps carry a `role`; the generator picks `item.voices[role]` or falls back to the main voice. Shown on the item page. guide.md switching picks voices up too.
- **Share to Noteable:** manifest `share_target` (POST multipart to `/noteable/share`, with title, text, url and files of PDF/DOCX/PPTX/EPUB/MD/TXT). `public/share-target.js` is imported into the Workbox service worker, caches what was shared in `noteable-share`, and redirects to `#/shared`. Shared files import directly (several become one item); a link is saved as an Inbox reminder plus a copyable prompt for Claude, since there's no in-app fetcher by design; plain text becomes a narratable Inbox file. Browser check: a simulated share POST was caught and cached by the deployed service worker.
- **Image-only slides:** PPTX slides with no body text but with PNG/JPG/GIF/BMP/WebP pictures (up to 3 per slide) are OCR'd with one Tesseract worker per import. They count as OCR pages, so the preview shows the "read from scanned pages" reminder.
- **Maths:** powers (x^2 → "x squared", ^n → "to the power of n", ², ³), ≤ ≥ ≠ ≈ ± × ÷ → ∞ π Σ Δ √, %, and " = ", " < ", " > " with spaces. Fractions only between numbers, single letters or capital abbreviations (MC/MR → "MC over MR"), so dates, "and/or" and units like km/h stay as written.
- **Tables:** rows are read with their column headers ("Year: 2020; GDP: 1.2") in guides and markdown, Word and EPUB tables with a header row, and Google Docs.
- Tests: 161. Worker restarted with the GPU engine.

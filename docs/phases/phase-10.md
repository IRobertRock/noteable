# Phase 10 — Better voices, faster desktop, smarter import

Status: **planned** (not started). Proposed by Claude on 2026-10-08 from Rob's "All 20" (upgrades 11, 12, 15–18). Not part of the original spec.

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

1. [ ] **Spike (11):** Puppeteer + Chrome-for-Testing headless with `--enable-unsafe-webgpu` on the RX 9070 XT; run the existing `tts.worker` page; measure RTF vs CPU. Decide go/no-go and record it here before building.
2. [ ] (11) If go: `worker/gpuEngine.ts` (opens a local page serving the built TTS worker, generates over `page.evaluate`), with the engine chosen at start (`NOTEABLE_ENGINE=gpu|cpu`, default gpu with automatic CPU fallback).
3. [ ] (12) `src/tts/pronounce.ts` + `State/pronunciations.json` sync + Account editor; tests.
4. [ ] (15) Guide header `voices`, `SpeechStep.voice`, generator and estimate support; tests.
5. [ ] (16) `share_target` in the manifest (`vite.config.ts`), service-worker POST handler, `src/ui/shared.ts`; Android test.
6. [ ] (17) PPTX picture-only slides → extract `ppt/media/*` image → OCR → text.
7. [ ] (18) `src/tts/mathSpeech.ts` and table reading with headers in `speechText` and the HTML/markdown readers; tests.
8. [ ] Commit, deploy, restart worker, docs, testing guide.

## Tests

- Spike numbers recorded. Unit: pronunciation rules (whole-word, case, regex), two-voice plan, math phrases, table-with-headers reading, picture-only slide detection. Browser: share-target POST handled by the service worker (simulated). Worker: GPU engine produces byte-identical framing (same MP3 settings) and its speed is logged.

## Gate (proposed)

> Done when: "Mankiw" and "PPF" are said correctly in a regenerated chapter, a guide plays questions and answers in two voices, a page shared from Chrome lands in the Inbox, and the desktop logs GPU generation faster than 8.5×.

## Open questions

1. GPU worker: OK to add Puppeteer with its own Chrome-for-Testing download (~170 MB, desktop only)?
2. Share target: since the spec rules out an in-app web fetcher, is saving the link + shared text to the Inbox for Claude the right behaviour?
3. Two voices: question/answer only, or also a separate "narrator" voice for headings?

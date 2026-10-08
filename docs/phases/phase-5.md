# Phase 5 — Document importers and cleanup

Status: **built, gate not yet tested**. Deployed 2026-10-08; the gate steps are in `docs/TESTING.md`. Waiting for a real ECON 1000 deck and scanned reading.

## Goal

I can import a PDF, scanned PDF, DOCX, PPTX, EPUB or Google Doc (or several as a course pack), check and fix the cleaned text, and generate audio with no page numbers, headers or citations read aloud.

## Scope

**In this phase**

- Readers: PDF (PDF.js text layer), scanned PDF (Tesseract.js OCR, detected by an empty/near-empty text layer), DOCX (mammoth), PPTX (JSZip: slide text and speaker notes in slide order), EPUB (JSZip: chapters from the spine), Google Docs (Drive export as text, through `Storage`).
- Sources: upload from the device, or choose from Drive with an in-app Drive browser.
- Cleanup rules 1–6 from the spec, including footnotes read at the end of their section as "Notes for this section."
- Text preview: edit chapter text, rename, exclude, reorder before generating.
- Course packs: several sources in one item, in Rob's order; each source → one or more chapters.

**Left for later**

- Zotero (phase 7). Pause markers (phase 7).
- Images, tables and equations are not described aloud (tables are read row by row as plain text; a later improvement could summarise them).

## Steps

1. [x] **Dependencies:** `npm install pdfjs-dist@6.4.299 tesseract.js@7.0.0 mammoth@1.13.0 jszip@3.10.2`. All loaded lazily per format so the app shell stays small. PDF.js worker and Tesseract worker/lang data (`eng.traineddata`, ~10 MB) are fetched on first use and cached.
2. [x] **Common model.** `src/import/types.ts`: `RawDoc { title, blocks: Block[] }`, `Block { kind: 'heading'|'para'|'footnote'|'listItem'|'notes', level?, text, page?, y?, fontSize? }`. Every reader produces a `RawDoc`; cleanup works on that.
3. [x] **PDF.** `src/import/pdf.ts`: per page `getTextContent()`, group items into lines by y, lines into paragraphs by gap and indent, headings by font size relative to body median, footnotes by small font at page bottom with a leading marker number. Outline (`getOutline()`) → chapter splits when present.
4. [x] **Scanned PDF.** `src/import/ocr.ts`: if < 20 characters per page on average, render each page to canvas at 2× (PDF.js) and run Tesseract (`createWorker('eng')`), with page-by-page progress; text into the same block pipeline (no font sizes, so headings come from short lines in caps/title case).
5. [x] **DOCX.** `src/import/docx.ts`: `mammoth.convertToHtml` with a style map for headings and footnotes → blocks.
6. [x] **PPTX.** `src/import/pptx.ts`: `ppt/presentation.xml` slide order, `ppt/slides/slideN.xml` text runs (`a:t`) by shape, title placeholder as heading, `ppt/notesSlides/` speaker notes appended after the slide text. Slide groups → chapters by section (`p14:sectionLst`) when present, else by title slides, else every ~10 slides.
7. [x] **EPUB.** `src/import/epub.ts`: `META-INF/container.xml` → OPF → spine order → XHTML → blocks; nav/toc for chapter titles.
8. [x] **Google Docs.** `Storage` gains `export(path, mimeType)` (Drive `files.export` to `text/markdown` or `text/plain`) — an interface addition, flagged in this doc when added.
9. [x] **Cleanup.** `src/import/cleanup/` one file per rule, each pure and unit tested:
   1. `headersFooters.ts` — lines (normalised: digits → `#`) repeating at the top/bottom of ≥ 50 % of pages; standalone page numbers (`12`, `Page 12`, `12 of 40`, roman numerals).
   2. `citations.ts` — `(Smith, 2019)`, `(Smith & Jones, 2019, p. 4)`, `(Smith et al., 2019; Lee, 2020)`, `[12]`, `[3–5]`, `[1, 4]`, superscript footnote markers.
   3. `references.ts` — drop from a "References"/"Bibliography"/"Works Cited" heading to the next same-or-higher-level heading (or the end).
   4. `footnotes.ts` — collect footnote blocks, attach to their section, emit "Notes for this section." + notes at section end.
   5. `rejoin.ts` — `exam-\nple` → `example` (when the joined word is more likely than the hyphenated form), soft line breaks merged into paragraphs.
   6. `chapters.ts` — split by EPUB spine, PPTX groups, PDF outline, else headings level 1–2.
10. [x] **Drive browser.** `src/ui/driveBrowser.ts` — browse My Drive folders through `Storage` (needs `Storage` paths outside `Noteable/`, e.g. `drive:/My Drive/...`; flagged as an interface extension).
11. [x] **Preview.** `src/ui/preview.ts`: chapter list with include toggles, drag to reorder, editable text (`contenteditable` plain text), "show what was removed" toggle highlighting dropped lines for checking.
12. [x] **Course packs.** `src/ui/coursePack.ts`: pick several sources, order them, title and collection; writes one item with all sources in `sources/`.
13. [x] Commit, deploy, update this document.

## Tests

- **Fixture corpus** in `test/fixtures/` (only files I generate or Rob approves committing): a synthetic PDF with running headers, page numbers, APA citations, footnotes and a reference list; a DOCX with footnotes; a PPTX with notes and sections; a small EPUB; a 2-page scanned PDF (image-only).
- **Unit:** each cleanup rule with positive and negative cases (e.g. "(see 2019 report)" is not a citation; "Chapter 3" heading is not a page number).
- **Golden tests:** each fixture → expected chapter text snapshot.
- **Manual:** Rob's real ECON 1000 deck and a scanned reading on the laptop before the phone gate.

## Gate

> Done when: a real ECON 1000 slide deck and a scanned reading each import cleanly with no page numbers or citations read aloud.

1. Put a real ECON 1000 slide deck (PPTX or PDF) and a scanned reading (image-only PDF) in `Noteable/Inbox`.
2. On the S23: **Inbox** → slide deck → **Import**. In the preview, check: slides in order, speaker notes included, no slide numbers or footer text ("ECON 1000 – Fall 2026" etc.). Tap **Show removed** to see what was dropped.
3. **Generate** (this device, short enough), then play two chapters at 1.5×: no "slide 7", no footer, no "(Mankiw, 2021)".
4. Inbox → scanned reading → **Import**. OCR progress shows per page (may take a few minutes; keep the screen on or use sleep mode).
5. In the preview, check for page numbers, running headers, citation brackets and the reference list: none present; footnotes appear at the end of their section as "Notes for this section."
6. Fix anything wrong in the preview, then **Generate**, play a chapter and listen for any page number or citation.
7. Tell me anything that slipped through so I can add it as a test case.

## Open questions

1. Can you share the actual ECON 1000 deck and the scanned reading (Drive link) early, so I can test the cleanup against them on the laptop first? They would not be committed. (Still open: none in the Inbox on 2026-10-08.)
2. Citation style: all of APA, Chicago author-date and numbered are handled (default used).
3. PPTX chapters: PowerPoint sections if present, else title/section-header slides, else every 10 slides (default used).
4. "Re-run with OCR" button: added in the preview for PDF items without audio (default used).

## Change log

- 2026-10-08: built and deployed straight after phase 4 (Rob: "Next phase"). No real course files were in the Inbox, so the cleanup was built and tested against generated fixtures. The real-file check is the gate.
- **Storage interface additions** (flagged in steps 8 and 10): optional `browse(folderId?)`, `readById(id)` and `exportById(id, mimeType)` instead of `export(path)` plus `drive:/` paths. IDs suit files outside `Noteable/` better than paths, and a future `RailwayStorage` can simply leave them out.
- **Google Slides** are imported too, exported from Drive as .pptx.
- **Readers** are in `src/import/readers/`; cleanup rules are in `src/import/cleanup/` (one file per rule). Headers/footers and line joining run inside the PDF/OCR path because they need page positions. Each block carries what was removed from it, so "Show removed" lists it under the right chapter.
- PDF: headings by font size (≥1.15× body); footnotes are small type in the bottom 30% of a page; outline entries become chapter breaks; a scan is detected at fewer than 20 characters per page. OCR (Tesseract 7) uses its own paragraph boundaries; the engine (~15 MB) loads from the CDN on first use.
- PPTX: placeholders for slide number, footer, date and header are dropped; text repeated word for word on at least half the slides (min 2) is treated as a footer. Exact match only, so "Step 1 / Step 2" bullets stay.
- A chapter's first sub-heading is dropped when it repeats the chapter title (seen with title slides and single-heading Word files).
- Very long chapters (over ~22,000 characters, about 25 minutes) are split into parts.
- Markdown files in the Inbox (Claude's guides) still go straight to the item using their own `##` chapters, with no cleanup. Other formats open the **text preview** after import.
- Preview: rename, edit (markdown textarea), include/exclude, and reorder (only before any audio, because audio files are numbered by chapter). Editing a chapter that already has audio marks just that chapter for regeneration.
- Import libraries are lazy `assets/import-*` chunks, excluded from the service-worker precache (shell ~480 KB).
- **Browser check (desktop, `/spikes/import.html`)**: a text PDF lost its running header, page numbers, citations and reference list, kept the footnote as "Notes for this section", and mended the hyphenated "eve-/ning". The PPTX kept slides and notes in order. The DOCX footnote was placed. A scanned (image-only) PDF was read by OCR almost word for word, with "(Locke, 1689)" and "[4]" removed. Two issues found and fixed: the repeated footer in a 2-slide deck, and the chapter title read twice.
- Tests: 111 (cleanup rules with keep/remove cases, each reader on generated PDF/DOCX/PPTX/EPUB files under jsdom, import pipeline, course packs, Google Doc export, preview save rules).

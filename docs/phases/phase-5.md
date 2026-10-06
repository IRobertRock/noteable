# Phase 5 — Document importers and cleanup

Status: **planned** (not started)

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

1. [ ] **Dependencies:** `npm install pdfjs-dist@6.4.299 tesseract.js@7.0.0 mammoth@1.13.0 jszip@3.10.2`. All loaded lazily per format so the app shell stays small. PDF.js worker and Tesseract worker/lang data (`eng.traineddata`, ~10 MB) are fetched on first use and cached.
2. [ ] **Common model.** `src/import/types.ts`: `RawDoc { title, blocks: Block[] }`, `Block { kind: 'heading'|'para'|'footnote'|'listItem'|'notes', level?, text, page?, y?, fontSize? }`. Every reader produces a `RawDoc`; cleanup works on that.
3. [ ] **PDF.** `src/import/pdf.ts`: per page `getTextContent()`, group items into lines by y, lines into paragraphs by gap and indent, headings by font size relative to body median, footnotes by small font at page bottom with a leading marker number. Outline (`getOutline()`) → chapter splits when present.
4. [ ] **Scanned PDF.** `src/import/ocr.ts`: if < 20 characters per page on average, render each page to canvas at 2× (PDF.js) and run Tesseract (`createWorker('eng')`), with page-by-page progress; text into the same block pipeline (no font sizes, so headings come from short lines in caps/title case).
5. [ ] **DOCX.** `src/import/docx.ts`: `mammoth.convertToHtml` with a style map for headings and footnotes → blocks.
6. [ ] **PPTX.** `src/import/pptx.ts`: `ppt/presentation.xml` slide order, `ppt/slides/slideN.xml` text runs (`a:t`) by shape, title placeholder as heading, `ppt/notesSlides/` speaker notes appended after the slide text. Slide groups → chapters by section (`p14:sectionLst`) when present, else by title slides, else every ~10 slides.
7. [ ] **EPUB.** `src/import/epub.ts`: `META-INF/container.xml` → OPF → spine order → XHTML → blocks; nav/toc for chapter titles.
8. [ ] **Google Docs.** `Storage` gains `export(path, mimeType)` (Drive `files.export` to `text/markdown` or `text/plain`) — an interface addition, flagged in this doc when added.
9. [ ] **Cleanup.** `src/import/cleanup/` one file per rule, each pure and unit tested:
   1. `headersFooters.ts` — lines (normalised: digits → `#`) repeating at the top/bottom of ≥ 50 % of pages; standalone page numbers (`12`, `Page 12`, `12 of 40`, roman numerals).
   2. `citations.ts` — `(Smith, 2019)`, `(Smith & Jones, 2019, p. 4)`, `(Smith et al., 2019; Lee, 2020)`, `[12]`, `[3–5]`, `[1, 4]`, superscript footnote markers.
   3. `references.ts` — drop from a "References"/"Bibliography"/"Works Cited" heading to the next same-or-higher-level heading (or the end).
   4. `footnotes.ts` — collect footnote blocks, attach to their section, emit "Notes for this section." + notes at section end.
   5. `rejoin.ts` — `exam-\nple` → `example` (when the joined word is more likely than the hyphenated form), soft line breaks merged into paragraphs.
   6. `chapters.ts` — split by EPUB spine, PPTX groups, PDF outline, else headings level 1–2.
10. [ ] **Drive browser.** `src/ui/driveBrowser.ts` — browse My Drive folders through `Storage` (needs `Storage` paths outside `Noteable/`, e.g. `drive:/My Drive/...`; flagged as an interface extension).
11. [ ] **Preview.** `src/ui/preview.ts`: chapter list with include toggles, drag to reorder, editable text (`contenteditable` plain text), "show what was removed" toggle highlighting dropped lines for checking.
12. [ ] **Course packs.** `src/ui/coursePack.ts`: pick several sources, order them, title and collection; writes one item with all sources in `sources/`.
13. [ ] Commit, deploy, update this document.

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

1. Can you share the actual ECON 1000 deck and the scanned reading (Drive link) early, so I can test the cleanup against them on the laptop first? They would not be committed.
2. Citation style in your courses: APA, Chicago author-date, numbered, or a mix?
3. PPTX chapters: one chapter per section, per title slide, or per ~10 slides by default?
4. Should OCR also be available for PDFs that do have a text layer but a bad one (a manual "Re-run as OCR" button)?

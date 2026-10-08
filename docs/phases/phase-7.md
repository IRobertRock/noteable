# Phase 7 — Teach-mode polish and Zotero

Status: **built, gate not yet tested**. Deployed 2026-10-08; the gate steps are in `docs/TESTING.md`.

## Goal

I can play a study guide Claude wrote in chat, with real pauses before each review answer in the voice the guide asks for, and import a Zotero item together with its PDF.

## Scope

**In this phase**

- Full guide marker support: `[pause Ns]` → N seconds of silence baked into the MP3; automatic 5 s pause before `**A:**` when no marker is given (pending Rob's answer); `**Q:**`/`**A:**` read as "Question"/"Answer"; bold and italics read normally and kept in the reading view.
- Per-item voice override: `voice` in the YAML header wins over the default; voice can be changed per item in the app (regenerates audio).
- `guide.md` dropped straight into an item folder by Claude is picked up on sync, and an item with a guide becomes a Teach item.
- Zotero import: Zotero web API v3 with Rob's API key and user ID, browse collections/search, import item metadata plus its attached PDF through the phase 5 PDF pipeline.
- Teach chip and guide-specific reading view polish (term lists, Q/A styling with the answer hidden until tapped).

**Left for later**

- Nothing planned beyond phase 7. Railway backend remains a future upgrade.

## Steps

1. [x] `src/tts/markers.ts`: tokeniser for `[pause Ns]` (N from 0.5 to 60, decimals allowed), Q/A labels; output a sequence of `{ speak: string } | { silence: seconds }`. Runner inserts zeroed PCM for silence before encoding.
2. [x] Update `src/tts/speechText.ts` and `src/generate/runChapterJob.ts` (shared with worker) to consume the sequence.
3. [x] `src/import/guide.ts`: validate front matter (`title`, `collection`, `mode`, `voice`, `sources`), unknown voice → warning + default, unknown keys kept.
4. [x] Voice override UI in `src/ui/item.ts`, with a **Regenerate** action (this device / desktop).
5. [x] Library sync detects `guide.md` in item folders and new `.md` guides in Inbox with `mode: teach`.
6. [x] Zotero: `src/zotero/client.ts` (`https://api.zotero.org/users/<id>/items`, `Zotero-API-Key` header, `Zotero-API-Version: 3`), `src/ui/zotero.ts` (collections, search, item list), download attachment file (`/items/<key>/file`) → `sources/` → phase 5 PDF import. API key entered in Settings and stored in `State/settings.json` in Rob's Drive and in IndexedDB — not in the repo, not in the build.
7. [x] Reading view: Q/A styling, tap to reveal answer, key terms list styling.
8. [x] Commit, deploy, update this document.

## Tests

- **Unit:** marker tokeniser (`[pause 5s]`, `[pause 2.5s]`, malformed markers read as text, nested bold), silence length in generated PCM (5 s × 24 000 samples ± one frame), front-matter validation, Zotero response parsing (recorded fixtures with keys removed).
- **Audio check:** generate the sample guide from the spec; measure silence gaps in the MP3 with a small script (`scripts/measure-silence.ts`, decodes with `AudioContext.decodeAudioData` in the browser pane).
- **Manual:** a real Claude-written guide.

## Gate

> Done when: a Claude-written guide plays with 5 s pauses before each answer, and a Zotero item imports with its PDF.

1. In a chat with Claude, ask for a short study guide (with review questions) in the Noteable guide format, saved to `Noteable/Inbox`.
2. On the S23, **Inbox** → the guide → **Import**. It shows as a **Teach** item using the voice in its header (e.g. Michael).
3. Generate on this device, then play **Review questions**. After each question there's a 5-second silence before "Answer…". Time one with a stopwatch.
4. Open the reading view: Q/A are styled; tapping a question reveals its answer.
5. Change the voice on the item to Emma → **Regenerate** → the new audio uses Emma.
6. **Settings → Zotero**: paste your Zotero API key and user ID (from zotero.org/settings/keys).
7. **Import → Zotero**: find a paper with an attached PDF, tap **Import**. The preview shows the cleaned PDF text with the Zotero title and authors; generate and play.

## Open questions

1. Automatic 5 s pause before every `**A:**`: yes (default used; recommended in the kickoff risk list). A `[pause Ns]` the guide writes wins, shorter or longer.
2. Zotero: personal library only for now (default).
3. Zotero key: read-only library access is enough; the app never writes to Zotero.

## Change log

- 2026-10-08: built (Rob: "next phase").
- **Answer pauses:** `**A:**` now produces a 5 s pause before "Answer…", even when the guide has no marker, including Q and A in the same paragraph. When pauses meet, a `[pause Ns]` written by the author wins over the automatic one (so `[pause 2s]` really is 2 s); otherwise the longest wins. `[pause Ns]` itself was already live from phase 2.
- **Voice per item:** already in place since phase 2 (the header `voice` sets it; the voice picker on the item page plus Generate/Regenerate changes it). No new UI was needed.
- **guide.md in an item folder:** the item page notices a `guide.md` the item hasn't used and offers **Use the study guide**: its `##` chapters replace the text, the item becomes Teach, the header voice is used, and leftover text and audio beyond its length are trashed. **Keep as is** dismisses that version; a changed guide.md is offered again. Guides saved to the Inbox work as before. A folder holding only a guide.md (no item.json) is not picked up; Claude should save new guides to the Inbox.
- **Reading view:** `[pause Ns]` markers are hidden. Each `**A:**` answer is blurred behind "Tap to show answer", so the review questions work as a self-quiz. A Q and A written in one paragraph are split.
- **Zotero:** only an API key is needed; `/keys/current` gives the user ID and username. It is stored in `State/settings.json` in Drive (synced to every device), never in the code. The Inbox has **📚 From Zotero**: collections, search, items with authors and year, and **Import** downloads the stored PDF and runs the normal PDF pipeline (cleanup, OCR, preview). The item page shows "From Zotero: authors · year · publication". The Account tab has Connect/Disconnect.
- Checked from the live site: `api.zotero.org` allows the app's requests (CORS, custom headers). **Not verifiable without Rob's key:** downloading a stored file. Zotero redirects that to its file storage; if the browser blocks it, the error says to save the PDF to the Inbox from Zotero instead.
- `src/settings.ts` now handles all `State/settings.json` reads and writes (keeps unknown keys).
- Gate guide `phase-7-gate-guide.md` is in `Noteable/Inbox`: Teach, Michael, 3 review questions, only the first with an explicit `[pause 5s]`.
- Tests: 132 (answer pauses and marker precedence, reader reveal/markers, guide.md switching and dismissal, Zotero client against a fake API).

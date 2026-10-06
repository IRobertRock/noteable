# Phase 7 — Teach-mode polish and Zotero

Status: **planned** (not started)

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

1. [ ] `src/tts/markers.ts`: tokeniser for `[pause Ns]` (N from 0.5 to 60, decimals allowed), Q/A labels; output a sequence of `{ speak: string } | { silence: seconds }`. Runner inserts zeroed PCM for silence before encoding.
2. [ ] Update `src/tts/speechText.ts` and `src/generate/runChapterJob.ts` (shared with worker) to consume the sequence.
3. [ ] `src/import/guide.ts`: validate front matter (`title`, `collection`, `mode`, `voice`, `sources`), unknown voice → warning + default, unknown keys kept.
4. [ ] Voice override UI in `src/ui/item.ts`, with a **Regenerate** action (this device / desktop).
5. [ ] Library sync detects `guide.md` in item folders and new `.md` guides in Inbox with `mode: teach`.
6. [ ] Zotero: `src/zotero/client.ts` (`https://api.zotero.org/users/<id>/items`, `Zotero-API-Key` header, `Zotero-API-Version: 3`), `src/ui/zotero.ts` (collections, search, item list), download attachment file (`/items/<key>/file`) → `sources/` → phase 5 PDF import. API key entered in Settings and stored in `State/settings.json` in Rob's Drive and in IndexedDB — not in the repo, not in the build.
7. [ ] Reading view: Q/A styling, tap to reveal answer, key terms list styling.
8. [ ] Commit, deploy, update this document.

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

1. Should a 5 s pause be inserted automatically before every `**A:**` even when Claude forgets the `[pause 5s]` marker? (Spec says both "fixed pause" and "`[pause Ns]`".)
2. Zotero: personal library only, or group libraries too?
3. Zotero key permissions: read-only is enough (we never write to Zotero). OK?

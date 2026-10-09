# Phase 12 — Search and study planning

Status: **planned** (not started). Proposed by Claude on 2026-10-09 from Rob's second "All 20" (upgrades 6–11). Not part of the original spec.

## Goal

I can find anything I've imported, answer Quiz me questions out loud, plan revision towards an exam, keep a glossary per course, export my notes, and get a quick recap when I come back to an item.

## Scope

**In this phase**

- (6) **Search everything**: a Search tab entry (magnifier in the Library header). Full-text search over chapter text (downloaded text plus a search index built on sync), guides, highlights and bookmark notes. Results show item, chapter and a snippet; tap → reader at that chapter (scrolled to the match) or ▶ play from that chapter.
  - The index is a small in-browser inverted index in IndexedDB, built incrementally as items sync. Text for items not downloaded is fetched once (a few KB per chapter) and kept in the index only.
- (7) **Say your answer**: in Quiz me, after the question an optional microphone step (Web Speech API `SpeechRecognition`) listens during the pause, then plays the answer and scores right / close / missed by key-word overlap. Results feed the flashcard boxes for that Q/A card.
  - On Android Chrome, speech recognition uses Google's service (audio leaves the phone). Off by default, toggle in Quiz me.
- (8) **Exam countdown**: Collection → **Exam date**. The Library shows "ECON 1000 exam in 12 days" and a **Today** list: items not yet listened to (spread across the days left), Quiz me for that course, and flashcards due (box 1–2). A "Due today" count on the Library tab. In-app only (no push notifications without a server).
- (9) **Course glossary**: Collection → **Make glossary**. Gathers every key term (`- **Term:** definition`) across the course's guides, de-duplicated (first definition wins, others listed), alphabetical, and writes a Teach item "<Course> glossary" (one chapter per letter group) ready to generate and to use as flashcards.
- (10) **Export notes**: Item or collection → **Export notes**: highlights (with notes), bookmark notes (with chapter and time), and flashcard results (cards marked "again") → a Google Doc in `Noteable/Exports/` (uploaded as markdown and converted by Drive). Claude can read it in chat.
- (11) **Recap on return**: when resuming an item after 3+ days, offer "Play the recap first?" → plays the guide's Recap chapter (Teach items) or the last 60 s before the resume point (Narrate items), then continues.

**Left for later**

- AI-graded spoken answers (needs a model or server); keyword scoring only.

## Steps

1. [ ] `src/search/index.ts` (tokenise, stopwords, inverted index in IndexedDB, incremental update on `LibraryIndex` changes) + `src/ui/search.ts`.
2. [ ] `src/study/speechAnswer.ts` (recognition wrapper with timeouts) + `scoreAnswer()` (pure, tested) + Quiz me UI toggle; maps to card ids.
3. [ ] `State/exams.json` (collection → date, synced) + `src/study/plan.ts` (pure daily plan) + Library header + Today panel + tab badge.
4. [ ] `src/study/glossary.ts` (pure: collect, de-dupe, letter groups → markdown) + collection action → `createItem`.
5. [ ] `src/study/exportNotes.ts` (markdown builder) + `Storage.write` with conversion: `DriveStorage.writeAsGoogleDoc(path, markdown)` (optional interface method; flagged).
6. [ ] Recap prompt in `Player.open` flow (`src/player/recap.ts`, pure decision + UI sheet).
7. [ ] Commit, deploy, docs and testing guide.

## Tests

- Unit: search tokenising/ranking/snippets, index updates on change, answer scoring (synonyms not handled; stems lightly), study plan spreading, glossary de-dup and grouping, export markdown, recap decision.
- Browser: search over the pipeline library; recognition mocked.

## Gate (proposed)

> Done when: Rob finds a phrase from a reading with Search and jumps to it, answers three Quiz me questions out loud, sets an exam date and follows the Today list, generates a course glossary, and opens exported notes as a Google Doc.

## Open questions

1. Spoken answers use Google's speech service on Android (audio leaves the phone). OK, off by default?
2. Export as a Google Doc (converted) rather than a markdown file?
3. Recap on return after 3 days: right threshold?

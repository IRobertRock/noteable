# Phase 12 — Search and study planning

Status: **built 2026-10-09; gate not yet tested by Rob** (see docs/TESTING.md). Proposed by Claude on 2026-10-09 from Rob's second "All 20" (upgrades 6–11). Not part of the original spec.

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

1. [x] `src/search/index.ts` (tokenise, stopwords, inverted index in IndexedDB, incremental update on `LibraryIndex` changes) + `src/ui/search.ts`.
2. [x] `src/study/speechAnswer.ts` (recognition wrapper with timeouts) + `scoreAnswer()` (pure, tested) + Quiz me UI toggle; maps to card ids.
3. [x] `State/exams.json` (collection → date, synced) + `src/study/plan.ts` (pure daily plan) + Library header + Today panel + tab badge.
4. [x] `src/study/glossary.ts` (pure: collect, de-dupe, letter groups → markdown) + collection action → `createItem`.
5. [x] `src/study/exportNotes.ts` (markdown builder) + `Storage.write` with conversion: `DriveStorage.writeAsGoogleDoc(path, markdown)` (optional interface method; flagged).
6. [x] Recap prompt in `Player.open` flow (`src/player/recap.ts`, pure decision + UI sheet).
7. [x] Commit, deploy, docs and testing guide.

## Tests

- Unit: search tokenising/ranking/snippets, index updates on change, answer scoring (synonyms not handled; stems lightly), study plan spreading, glossary de-dup and grouping, export markdown, recap decision.
- Browser: search over the pipeline library; recognition mocked.

## Gate (proposed)

> Done when: Rob finds a phrase from a reading with Search and jumps to it, answers three Quiz me questions out loud, sets an exam date and follows the Today list, generates a course glossary, and opens exported notes as a Google Doc.

## Decisions

Rob accepted all defaults ("go", 2026-10-09): spoken answers off by default (Google speech, with a confirm when turned on); notes exported as a Google Doc; recap after 3+ days.

## Change log (differences from the plan)

- **Search index**: no inverted index. Each chapter's markdown is stored once in a new IndexedDB store (`search`, DB version 5) and searched with a scan over plain text in memory. With hundreds of chapters this is instant and gives exact phrases and snippets for free. Chapters are fetched 20 per sync in the background, and 40 at a time while the Search screen is open. A chapter is refetched when its item's `updatedAt` changes. Review items are skipped because their chapters are other items' text. Search needs every word (word starts, so "opportun" finds "opportunity"); the exact phrase and your own highlights and notes rank higher.
- **Search entry**: a 🔍 Search button in the Library header (no new tab). **Read** opens the reader at that chapter, scrolled to the paragraph and outlined. **▶ Play** starts that chapter, or the bookmark's spot.
- **Say your answer** needs the **answer start time** in each Quiz me cue. That's new (`cue.answer`), so **guides must be generated again** to use it; older audio plays Quiz me as before, without listening. The app pauses where the answer begins (after the built-in thinking pause), listens for up to 9 s, shows "✓ Got it / ≈ Close / ✗ Not quite" with what it heard and the written answer, then plays the spoken answer. Right moves the flashcard up a box and missed sends it to box 1; close leaves it alone. Speech recognition stops when the screen locks, so the screen has to stay on (the confirm says so). The toggle is in the Quiz me banner on the Player.
- **Exam countdown**: each course gets 📅 **Set exam date** (synced in `State/exams.json`, included in safety copies). A **Today** panel at the top of the Library shows each upcoming exam, today's share of unlistened items (spread over the days left, with exam day kept for review), Quiz me, and "N flashcards due" (box 1–2). The Library tab shows a badge with today's item count; it updates when you change screens.
- **Glossary**: 📖 **Make glossary** on each course with study guides. It writes `Inbox/<Course> glossary.md` and imports it as a Teach item (chapters A–E, F–J, K–O, P–T, U–Z, plus 0–9), then opens it ready to generate. A term defined differently in another item gets an "Also, in <item>: …" line.
- **Export notes**: 📝 **Export notes** on each course and on each item page. It creates a Google Doc in `Noteable/Exports/` with highlights (and their notes), bookmarks that have notes, and flashcards still in box 1, then shows an **Open the Google Doc** link. Uses a new optional `Storage.writeAsGoogleDoc()` (Drive converts uploaded markdown).
- **Recap on return**: a banner on the Player ("It's been N days…"). For guides with a Recap, Summary or Key points chapter, it plays that chapter and then returns to where you were; otherwise it replays the last minute. Items barely started don't get one.


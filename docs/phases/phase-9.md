# Phase 9 — Study tools

Status: **built, gate not yet tested**. Deployed 2026-10-09; gate steps in `docs/TESTING.md`. Proposed by Claude on 2026-10-08 from Rob's "All 20" (upgrades 6–10). Not part of the original spec.

## Goal

I can study, not just listen: flip through flashcards made from my guides, run an audio "quiz me" before an exam, keep highlights, hand a reading to Claude for a guide in one tap, and build a review item across a whole course.

## Scope

**In this phase**

- (6) **Flashcards**: from a guide's **Key terms** list items (`**Term:** definition`) and **Q/A** pairs. Reading view → **Flashcards**: tap to flip, swipe for next, mark "knew it" / "again"; per-card results sync in `State/cards.json` and "again" cards come back first next time (simple Leitner boxes, not full spaced repetition).
- (7) **Quiz me**: an audio mode that plays only Q → pause → A segments, from one item or every Teach item in a collection, in random order. Built from the existing chapter MP3s using cue times recorded at generation (see step 1); no new audio.
- (8) **Highlights**: select text in the reading view → **Highlight** (optional note). Stored with bookmarks in `State/bookmarks.json` (`kind: 'highlight'`, chapter, text, offsets), shown in the margin and on the item page, synced.
- (9) **Make a study guide with Claude**: on any Narrate item, **Ask Claude for a study guide** copies a prompt plus the cleaned text (or, for long items, the Drive path of `text/`) to the clipboard and explains where Claude should save `guide.md`. The phase 7 banner then picks it up.
- (10) **Review across a course**: Collection → **Build a review**: pick chapters from several items → creates a new Teach item whose chapters reference the source chapters' existing audio and text (no regeneration). Stored as `item.json` with `sourceRefs`; deleting it never touches the sources.

**Left for later**

- Full spaced-repetition scheduling (SM-2). Leitner boxes cover "again first" for now.

## Steps

1. [x] **Cue times at generation**: `generateItem` records `{ kind: 'q' | 'a', startSec, endSec }` per review question into `item.json` chapters (`cues`). Existing items get cues the next time they're generated; Quiz me says which items need it. (Worker restart.)
2. [x] `src/study/cards.ts` (parse terms/QA from chapter markdown), `src/ui/flashcards.ts`, `State/cards.json` sync (latest-wins per card id = hash of item + front text).
3. [x] `src/study/quiz.ts` + Player "Quiz me" mode: a playlist of `[chapter MP3, startSec, endSec]` segments; Media Session next = next question.
4. [x] Highlights: selection handling in `src/ui/reader.ts`, `Bookmark` gains `kind`/`text`/`offsets`, merge tests; margin display.
5. [x] `src/study/claudePrompt.ts` + item page button; prompt text reviewed with Rob before shipping.
6. [x] `src/study/review.ts`: build a review item from chapter picks; player/downloads/reader follow `sourceRefs` (audio and text read from the source item's folder).
7. [x] Commit, deploy, restart worker, docs, testing guide.

## Tests

- Unit: term/QA extraction (bold-colon terms, Q/A pairs across paragraphs), Leitner ordering, card sync merge, cue recording with a fake engine (cue times match the pause positions), quiz playlist building across items, highlight merge, review-item resolution of `sourceRefs`.
- Browser: Quiz me plays the right segments from the phase 7 guide (seek positions checked).

## Gate (proposed)

> Done when: Rob studies the phase 7 guide as flashcards, runs Quiz me across ECON 1000 with the phone locked, and builds a review item from two items.

## Open questions

1. Flashcards: Key terms and Q/A only (Rob: go).
2. Quiz me: random order (Rob: go).
3. Claude prompt: length left to Claude, as the spec says (Rob: go).

## Change log

- 2026-10-09: built and deployed.
- **Cues:** speech steps now carry a mark (`block`, `q` for "Question…", `a` for the answer). The generator records the time at each mark, and `CueRecorder` turns them into segments from a question to the start of the next block after its answer (or the chapter end). Chapters resumed from a mid-chapter checkpoint get no cues; the next full generation adds them. Teach items generated before this show "Generate again to enable Quiz me". The worker was restarted so desktop jobs record cues too.
- **Flashcards:** `- **Term:** definition` (colon inside or after the bold) and `**Q:**` / `**A:**` pairs, including Q and A in one paragraph and with `[pause]` markers between. The card id is a hash of item id + front text, so results survive regeneration. Leitner boxes 1–5 in `State/cards.json`: box 1 ("again") first, then new cards, then higher boxes.
- **Quiz me:** a player mode over `{item, chapter, start, end}` segments, shuffled. It doesn't save positions (your resume point is untouched), lock-screen next/previous move between questions, and it stops after the last question. Available per item (Teach items with cues) and per collection (Library heading).
- **Highlights** are bookmarks with `kind: 'highlight'` and `text`. Select text in the reading view, then the floating **✎ Highlight** button, with an optional note. They're marked in the text (first match within a paragraph), shown in the margin, and listed with bookmarks on the item and player pages.
- **Ask Claude for a study guide** (Narrate items): a dialog with the prompt and a Copy button. Text is inlined up to 30,000 characters; above that, Claude is pointed at `text/` in Drive. It asks for the phase 7 guide format, so the guide.md banner picks the result up.
- **Course reviews:** chapters get an optional `src` (source item folder); `Downloads` reads text and audio from `src`. A review item has `review: true`, status ready, no Generate/Edit, and keeps cues so it can be quizzed. Built from Library → collection → **Build a review**.
- **Browser check (pipeline page):** a review chapter's cue (3.2–17.1 s) plays inside the segment and the quiz ends after the last question.
- Tests: 151.

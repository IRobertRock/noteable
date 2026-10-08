# Phase 9 — Study tools

Status: **planned** (not started). Proposed by Claude on 2026-10-08 from Rob's "All 20" (upgrades 6–10). Not part of the original spec.

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

1. [ ] **Cue times at generation**: `generateItem` records `{ kind: 'q' | 'a', startSec, endSec }` per review question into `item.json` chapters (`cues`). Existing items get cues the next time they're generated; Quiz me says which items need it. (Worker restart.)
2. [ ] `src/study/cards.ts` (parse terms/QA from chapter markdown), `src/ui/flashcards.ts`, `State/cards.json` sync (latest-wins per card id = hash of item + front text).
3. [ ] `src/study/quiz.ts` + Player "Quiz me" mode: a playlist of `[chapter MP3, startSec, endSec]` segments; Media Session next = next question.
4. [ ] Highlights: selection handling in `src/ui/reader.ts`, `Bookmark` gains `kind`/`text`/`offsets`, merge tests; margin display.
5. [ ] `src/study/claudePrompt.ts` + item page button; prompt text reviewed with Rob before shipping.
6. [ ] `src/study/review.ts`: build a review item from chapter picks; player/downloads/reader follow `sourceRefs` (audio and text read from the source item's folder).
7. [ ] Commit, deploy, restart worker, docs, testing guide.

## Tests

- Unit: term/QA extraction (bold-colon terms, Q/A pairs across paragraphs), Leitner ordering, card sync merge, cue recording with a fake engine (cue times match the pause positions), quiz playlist building across items, highlight merge, review-item resolution of `sourceRefs`.
- Browser: Quiz me plays the right segments from the phase 7 guide (seek positions checked).

## Gate (proposed)

> Done when: Rob studies the phase 7 guide as flashcards, runs Quiz me across ECON 1000 with the phone locked, and builds a review item from two items.

## Open questions

1. Flashcards: are Key terms + Q/A enough sources, or should any bold phrase become a card?
2. Quiz me: random order, or guide order?
3. The Claude prompt for study guides: should it ask for a fixed number of review questions (e.g. 8–12), or leave length to Claude as the spec says ("length set by how much there is to teach")?

# Noteable testing guide

Everything waiting for you to test, newest phase last. Work through it whenever suits you and tell Claude the result for each section ("Phase 3 passed", or the step number and what happened).

- **App:** https://irobertrock.github.io/noteable/
- **Drive folder:** https://drive.google.com/drive/folders/1F3Bb2aKX0Ya95UsVi79gT0WIgu6-eRKb
- **Before you start:** plug the phone in and use Wi-Fi.
- **New version not showing?** Close Noteable completely and reopen it. It updates itself on the next launch.

| Phase | What it covers | Status |
| --- | --- | --- |
| 1 | Install, sign-in, Drive folders | Passed on the S23 (Oct 8) except the offline check below |
| 2 | Markdown file → chaptered MP3s on the phone | **Passed** (Oct 8, 1.41× real time) |
| 3 | Player, reading view, offline, laptop → phone resume | **Not tested yet** |
| 4 | Sleep mode for long generations | **Not tested yet** |
| 5 | PDF, Word, PowerPoint, EPUB, Google Docs import with cleanup | **Not tested yet** (needs a real deck + scanned reading) |
| 6 | Send to desktop: the PC makes the audio while the phone is locked | **Not tested yet** (desktop set up and working; phone test to do) |
| 7 | Study guides with answer pauses; Zotero import | **Not tested yet** |
| 8 | Continue listening, Up next, skip silence, desktop status, problem reports, delete | **Not tested yet** |

---

## Phase 1 — leftover check (1 minute)

- [ ] On the S23, turn on airplane mode, close Noteable completely (swipe it away), and reopen it from the home-screen icon. It opens and shows the "Offline" banner instead of a Chrome error page.

---

## Phase 3 — player, reading view and sync (about 10 minutes)

> Done when: Rob starts an item on the laptop and resumes it on the phone at the same spot, in airplane mode after downloading.

You need: the S23, the laptop, earbuds. Uses the **Phase 2 Gate Test** item that's already in your Library.

- [ ] 1. **S23:** Noteable → Library → **Phase 2 Gate Test** → **⬇ Download for offline**. Wait until it says **✓ Downloaded**.
- [ ] 2. **Laptop:** open the app link in Chrome and sign in. Open the same item, tap **chapter 2** in the chapter list, listen for about a minute, then **Pause**. Note the time shown.
- [ ] 3. **S23 (still online):** Library → **Refresh**. The item shows the laptop's position ("% listened").
- [ ] 4. **S23:** turn on **airplane mode**.
- [ ] 5. Open the item → **▶ Resume**. It starts in chapter 2, about 2 seconds before where the laptop stopped.
- [ ] 6. Lock the phone. On the lock screen: pause, play, skip forward, next chapter all work, and it shows the chapter title, the item title and "General".
- [ ] 7. With earbuds: one tap pauses and plays; double tap goes to the next chapter.
- [ ] 8. Player tab: set speed to **1.5×**, tap **🔖 Bookmark** and type a note.
- [ ] 9. Item page → **Read** → tap a paragraph in chapter 3. Audio jumps to chapter 3, which is highlighted.
- [ ] 10. Turn airplane mode **off**, open Noteable for a few seconds. On the laptop: Library → **Refresh**. The phone's newer position, 1.5× speed and the bookmark appear on the laptop.

Nice to check while you're there:
- [ ] Close Noteable mid-chapter and reopen it: **Resume** picks up where you were.
- [ ] Account tab: change the default voice; it says "Saved".

---

## Phase 4 — sleep mode (about 25 minutes, mostly waiting)

> Done when: a 20-minute item generates on the S23 with the screen in sleep mode and the phone in a pocket.

You need: the S23, charged to at least 60% (plugged in is better). The test file **phase-4-gate-test.md** (about 21 minutes of *Wealth of Nations*) is already in your Inbox.

- [ ] 1. Close other heavy apps. Open Noteable → **Inbox** → **Import** next to `phase-4-gate-test.md`.
- [ ] 2. On the item page, read the estimate under Generate (e.g. "about 21 min of audio. Ready in about 15 min on this Android phone"). Note it.
- [ ] 3. Tap **Generate on this device**. If a Google window flashes up briefly, that's the sign-in being refreshed for the long job; it closes by itself.
- [ ] 4. Tap **☾ Sleep mode**. A card explains it, then the screen goes black with a faint progress line.
- [ ] 5. Tap the screen quickly: nothing happens. Press and hold for about 1.5 seconds: a ring fills and the normal screen comes back. Tap **☾ Sleep mode** again.
- [ ] 6. Put the phone in your pocket and leave it until it buzzes. **Don't press the power button.**
- [ ] 7. When it finishes, the phone vibrates, chimes, and the screen wakes.
- [ ] 8. Check the item page: both chapters done, and an "× real time" line at the bottom. If it says chapters are **waiting to upload**, tap **Finish uploading**.
- [ ] 9. Play a minute of chapter 2 to check the audio.
- [ ] 10. Tell Claude: the estimate from step 2, how long it actually took, and how warm the phone got (cool / warm / hot).

If anything goes wrong:
- If the card says the browser won't keep the screen on, set **Settings → Display → Screen timeout** to 10 minutes and try again.
- Samsung's **Accidental touch protection** can block the long press in a pocket. Take the phone out to wake it.
- If the job stopped, open the item and tap **Resume generating**. It continues from the last 30-second checkpoint.

---

## Phase 5 — document import and cleanup (about 15 minutes)

> Done when: a real ECON 1000 slide deck and a scanned reading each import cleanly with no page numbers or citations read aloud.

You need: a real ECON 1000 slide deck (PowerPoint, Google Slides or PDF) and a scanned reading (a PDF that is just page images). Put both in **Noteable/Inbox** in Drive, or use **Pick from Google Drive** in the app.

- [ ] 1. Noteable → **Inbox** → **Import** next to the slide deck. A progress panel shows, then the **text preview** opens.
- [ ] 2. In the preview, open a couple of chapters with **Read / edit text**. Check: slides are in order, speaker notes are included, and there's no slide number or footer text (like "ECON 1000 – Fall 2026").
- [ ] 3. Tap **Removed (N)** on a chapter to see what was taken out. Anything there that should have stayed? Note it.
- [ ] 4. Tap **Looks good, continue** → **Generate on this device**. Play two chapters at 1.5×: no "slide 7", no footer, no "(Mankiw, 2021)".
- [ ] 5. Back in **Inbox** → **Import** next to the scanned reading. The panel shows "Reading scanned page 1 of N (OCR)". This takes a while: about a minute per page on the phone. Keep the screen on.
- [ ] 6. In the preview: no page numbers, no running header, no citation brackets, no reference list. Footnotes appear at the end of their section after "Notes for this section."
- [ ] 7. Fix anything wrong right there in the text, **Save and continue**, **Generate**, and play a chapter.
- [ ] 8. Tell Claude anything that slipped through or was wrongly removed, with the file name. Each one becomes a test case.

Also worth a quick try:
- [ ] Tick two Inbox files → **Import as one item** (course pack). Chapters follow the order shown.
- [ ] **Upload from this device** with a PDF or Word file from the phone.
- [ ] **Pick from Google Drive** → open a folder → **Import** a Google Doc.
- [ ] If a text PDF comes out garbled: open it, go to the preview and use **Re-run with OCR**.

---

## Phase 6 — desktop queue (about 15 minutes)

> Done when: Send to desktop from the phone produces audio while the phone is locked.

Setup on the desktop is **done** (Oct 8): the worker is installed, starts with Windows, and is signed in to Google. A test job already went through it. **Desktop Worker Test** in your Library was made by the PC. You'll see the Noteable icon in the system tray (click **^** by the clock if it's hidden). Green means idle.

- [ ] 1. Restart the PC. After you log in, the tray icon comes back on its own (green).
- [ ] 2. On the S23: put a markdown file of about 10 minutes in the Inbox (or use **phase-4-gate-test.md** if you haven't imported it yet) and **Import** it.
- [ ] 3. On the item page tap **🖥 Send to desktop**. It says "Queued on the desktop".
- [ ] 4. Lock the phone and put it away.
- [ ] 5. Within about a minute, the tray icon turns blue (hover over it: "Working: Chapter 1 of …").
- [ ] 6. When the icon is green again, unlock the phone → **Queue** tab: the job says **Done**.
- [ ] 7. Play the item on the phone. The chapters are in Drive under `audio/`.
- [ ] 8. Stall check: send another item to the desktop. While it's working, right-click the tray icon → **Quit**. On the phone the job shows "last update … ago", and after 15 minutes **Stalled**. Start the worker again (Start menu → type `Noteable worker`, or restart the PC). It carries on without redoing finished chapters.

If the tray icon is **red**: right-click → **Sign in to Google again**. While the Google project is in Testing mode, this is needed about once a week.

---

## Phase 7 — study guides and Zotero (about 15 minutes)

> Done when: a Claude-written guide plays with 5 s pauses before each answer, and a Zotero item imports with its PDF.

**Study guide.** **phase-7-gate-guide.md** is already in your Inbox (a Teach guide in the Michael voice, with three review questions). Next time, you can ask Claude in chat to write a guide in the Noteable format and save it to Noteable/Inbox.

- [ ] 1. Inbox → **Import** next to `phase-7-gate-guide.md`. It opens as a Teach item in **ECON 1000**, voice Michael.
- [ ] 2. **Generate on this device** (or **Send to desktop**).
- [ ] 3. Play the **Review questions** chapter. After each question there's a 5-second silence before "Answer…". Time one with a stopwatch. (Only the first question has a pause written in; the other two get it automatically.)
- [ ] 4. Tap **Read**: the answers are blurred with "Tap to show answer", and tapping reveals each one. No "[pause 5s]" text shows.
- [ ] 5. Change the voice on the item to Emma → **Generate again**. The new audio uses Emma.

**Zotero.**
- [ ] 6. On zotero.org: **Settings → Security → Create new private key**. Tick **Allow library access** (read-only), save, and copy the key.
- [ ] 7. Noteable → **Account** → **Zotero**: paste the key → **Connect**. It says "Connected to <your name>'s library".
- [ ] 8. **Inbox → 📚 From Zotero**: pick a collection or search, then **Import** a paper that has a PDF stored in Zotero. The text preview opens, cleaned. The item page shows "From Zotero: authors · year".
- [ ] 9. Generate and play a chapter.

If step 8 says it couldn't download the file: in Zotero, right-click the PDF → **Show File**, save a copy to Noteable/Inbox in Drive, and import it from the Inbox. Then tell Claude, so the download can be fixed.

---

## Phase 8 — everyday listening (about 10 minutes)

> Done when: on the S23, Rob resumes from "Continue listening", plays two items back to back from Up next with the phone locked, sees "Desktop online" before sending a long item, and deletes a test item.

- [ ] 1. Library: the **Continue listening** shelf shows what you last played → tap **▶ Resume**.
- [ ] 2. On an item's page, the chapter list shows ✓ (heard), ◐ (part heard) or ○.
- [ ] 3. Open another item → **＋ Add to Up next**. Play the first item near its end, lock the phone, and let it finish: the second one starts by itself, and the lock screen shows its title and a coloured cover with the collection name.
- [ ] 4. Player tab: at **1.5×** with **Skip silence** ticked, gaps between paragraphs feel shorter, but a review question still pauses before its answer.
- [ ] 5. Open the **Phase 4 Gate Test** item (if not generated yet): under Generate you see "Desktop online · seen … ago" and **🖥 Send to desktop (recommended)**.
- [ ] 6. Queue tab: the top line says "Desktop online".
- [ ] 7. Account → **Report a problem** → it says where the file was saved. Within a minute a "-worker.md" file appears next to it in Drive → Noteable/Logs.
- [ ] 8. Open **Desktop Worker Test** → **Delete item…** → confirm. It's gone from the Library and in Drive's trash.

---

## Optional: laptop speed

- [ ] On the laptop, open https://irobertrock.github.io/noteable/spikes/kokoro-mp3.html, tap **Run**, wait about a minute, and send Claude the line that starts with **DONE**.

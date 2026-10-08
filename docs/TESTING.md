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
| 4 | Sleep mode for long generations | **Not tested yet** (being built) |

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

_Steps will be added here when Phase 4 is deployed._

---

## Optional: laptop speed

- [ ] On the laptop, open https://irobertrock.github.io/noteable/spikes/kokoro-mp3.html, tap **Run**, wait about a minute, and send Claude the line that starts with **DONE**.

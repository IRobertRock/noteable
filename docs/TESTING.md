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

## Optional: laptop speed

- [ ] On the laptop, open https://irobertrock.github.io/noteable/spikes/kokoro-mp3.html, tap **Run**, wait about a minute, and send Claude the line that starts with **DONE**.

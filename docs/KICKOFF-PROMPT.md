You are starting Project 109, Noteable: my personal audiobook and study-guide maker. This folder is empty apart from the docs. Work through the steps below in order and do not skip ahead.

STEP 1: READ
1. Read CLAUDE.md and docs/SPEC.md in full.
2. Treat every row in the spec's "Locked decisions" table as final. If you think one is wrong, raise it with me and keep building to the spec until I answer.

STEP 2: WRITE ALL SEVEN PHASE DOCUMENTS
Create docs/phases/phase-1.md through phase-7.md, one for each phase in the spec's "Build plan for Claude Code" section. Each phase document must contain:
- Goal: one sentence on what I can do when the phase is finished.
- Scope: what is in this phase and what is explicitly left for later phases.
- Steps: a numbered list of concrete tasks, each naming the files it creates or changes, the libraries and pinned versions, and the commands to run.
- Tests: how you will check the work yourself (unit tests, build checks, local preview).
- Gate: the spec's "Done when" line, copied word for word, plus the exact steps I take on my phone to check it.
- Open questions: anything you need from me for this phase.

STEP 3: FLAG RISKS, THEN STOP
Before writing any code, post a short list in chat covering:
- anything in the spec that is ambiguous or contradicts itself
- anything technically risky, especially: kokoro-js on WebGPU in an installed PWA, MP3 encoding in the browser, Google token refresh without a backend, the full drive scope in testing mode, and Wake Lock behaviour on Android Chrome
- the accounts, keys and settings you need from me
Then stop and wait for my answers.

STEP 4: BUILD PHASE 1 ONLY (after I answer)
Phase 1 is shell and sign-in:
- Vite + TypeScript PWA (manifest, icons, service worker caching the app shell), with no UI framework unless you justify one in the phase document.
- A GitHub Actions workflow that builds and deploys to GitHub Pages on every push to main.
- Google sign-in through Google Identity Services with the full drive scope, and silent token refresh where possible.
- src/storage/Storage.ts defining the interface from the spec (list, read, write, move, delete, watch, enqueue, claim, complete).
- src/storage/DriveStorage.ts implementing it against the Drive v3 REST API, with no direct Drive calls anywhere else in the app.
- On first sign-in, create the folder tree: Noteable/Inbox, Noteable/Library/General, Noteable/Queue and Noteable/State, with empty playback.json, bookmarks.json and settings.json files. Check for each folder first, so signing in again never creates duplicates.
- A minimal home screen showing: signed-in account, folder status, and a Sign out button.
Walk me through the Google Cloud setup step by step: create the project, enable the Drive API, configure the OAuth consent screen in Testing mode with me as the test user, and create a web OAuth client ID with the GitHub Pages origin and localhost as authorised origins. Ask me for the client ID; do not invent one or leave a placeholder in committed code. Keep config in a single src/config.ts.

STEP 5: STOP AT THE GATE
When Phase 1 is deployed:
- give me the GitHub Pages URL
- give me a numbered checklist to test it on my S23 Ultra and my laptop: install the PWA, sign in, confirm the folders in Drive, sign out and back in with no duplicate folders
- commit with a clear message
Do not start Phase 2 until I confirm the gate passed.

RULES THROUGHOUT
- Never commit secrets. The OAuth client ID is public and can live in config; anything else secret goes in .env and .gitignore.
- Keep docs/phases/phase-N.md updated as you go, ticking off steps and noting anything that changed from the plan.
- If a step turns out bigger or different than planned, tell me before changing the approach.

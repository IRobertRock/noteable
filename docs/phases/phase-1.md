# Phase 1 — Shell and sign-in

Status: **done**: deployed 2026-10-06; confirmed on the S23 on 2026-10-08 during the phase 2 gate (installed, signed in from a second device with no duplicate folders). The airplane-mode reopen check was not reported separately.

## Goal

I can install Noteable from GitHub Pages on my S23 Ultra and laptop, sign in with Google, and see that it has created my `Noteable/` folder tree in Drive.

## Scope

**In this phase**

- Vite + TypeScript PWA: web manifest, icons, service worker that precaches the app shell so it opens offline.
- GitHub Actions workflow that builds and deploys to GitHub Pages on every push to `main`.
- Google sign-in with Google Identity Services (GIS) token model, full `drive` scope, silent token refresh where the browser allows it.
- `src/storage/Storage.ts` (the interface) and `src/storage/DriveStorage.ts` (Drive v3 REST implementation). No other file talks to Drive.
- First-run creation of `Noteable/Inbox`, `Noteable/Library/General`, `Noteable/Queue`, `Noteable/State` plus `State/playback.json`, `State/bookmarks.json`, `State/settings.json`. Every folder and file is looked up before it is created.
- Minimal home screen: signed-in account, folder status, Sign out.
- Single config file `src/config.ts`.

**Left for later phases**

- Inbox listing, import, Kokoro, MP3 (phase 2).
- Library index in IndexedDB, 2-minute sync, player, offline downloads (phase 3).
- `watch`, `enqueue`, `claim`, `complete` are **declared and implemented** against Drive here (they are small), but nothing calls them until phases 3 and 6. Their unit tests use a fake fetch.

**No UI framework.** Phase 1 has one screen with three pieces of state. Plain TypeScript with a tiny `h()` element helper and one `render()` function per screen keeps the bundle small (which matters when the Kokoro model is already 310 MB) and has no build-time dependency to keep current. If the phase 3 player and reading view become hard to manage this way, I will propose a small library (Preact or Lit) in the phase 3 document before adding it.

## Steps

1. [x] **Repo and tooling.** In `C:\Users\irobe\Apps\109-Noteable`:
   - `git init -b main`
   - Create `package.json` (name `noteable`, `"type": "module"`, scripts `dev`, `build`, `preview`, `test`, `typecheck`, `icons`), `.gitignore` (`node_modules`, `dist`, `.env`, `.env.*`, `coverage`), `.nvmrc` (`24`), `tsconfig.json` (strict, `moduleResolution: bundler`, `lib: [ES2023, DOM, DOM.Iterable, WebWorker]`), `index.html`.
   - `npm install -D vite@8.3.3 typescript@7.0.2 vite-plugin-pwa@2.0.0 workbox-window@7.4.1 @vite-pwa/assets-generator@2.0.0 vitest@5.0.3 happy-dom@20.14.5`
   - `npm install idb@8.0.3` (token and folder-ID cache).
   - If TypeScript 7.0.2 trips on anything in the toolchain, fall back to `typescript@5.9.x` and note it here.
2. [x] **Config.** `src/config.ts` exports `GOOGLE_CLIENT_ID` (the real public client ID Rob gives me, no placeholder), `DRIVE_SCOPES` (`https://www.googleapis.com/auth/drive`, plus `openid email profile` to show the account), `ROOT_FOLDER = 'Noteable'`, `LAYOUT` (folder and file list below), `APP_BASE` (the Pages sub-path).
3. [x] **Vite + PWA.** `vite.config.ts`: `base` set to the Pages path (e.g. `/noteable/`), `VitePWA({ registerType: 'autoUpdate', manifest: {...}, workbox: { globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'], navigateFallback: 'index.html', runtimeCaching: [] } })`. Google, Drive and Hugging Face requests are **never** cached by the service worker. Manifest: name "Noteable", short_name "Noteable", `display: standalone`, `start_url` and `scope` = base, theme and background colour, icons 192, 512, 512 maskable.
4. [x] **Icons.** `public/icon.svg` (simple headphones-over-page mark), `pwa-assets.config.ts` with the `minimal2023Preset`, run `npm run icons` (`pwa-assets-generator`) to produce `public/pwa-192x192.png`, `pwa-512x512.png`, `maskable-icon-512x512.png`, `apple-touch-icon-180x180.png`, `favicon.ico`. Generated PNGs are committed.
5. [x] **Auth.** `src/auth/google.ts`:
   - Loads `https://accounts.google.com/gsi/client` once.
   - `initTokenClient({ client_id, scope, callback })`; `signIn()` calls `requestAccessToken({ prompt: 'consent' })` on first use and `{ prompt: '' , login_hint: email }` afterwards.
   - Stores `{ access_token, expires_at, email }` in IndexedDB (`idb`). Never stores anything else.
   - `getToken()` returns the cached token if it has more than 5 min left; otherwise tries a silent `requestAccessToken({ prompt: '' })`. If that fails or would need a popup outside a user gesture, it emits `auth:needs-tap` and the UI shows a one-tap **Reconnect** banner.
   - Account details from `https://openidconnect.googleapis.com/v1/userinfo` (an auth call, not a Drive call).
   - `signOut()` clears the cached token and the folder-ID cache, calls `google.accounts.oauth2.revoke` **only** if Rob ticks "Also remove Noteable's access" (otherwise the next sign-in skips the consent screen).
6. [x] **Storage interface.** `src/storage/Storage.ts`:
   ```ts
   export interface Storage {
     list(path: string): Promise<Entry[]>;
     read(path: string): Promise<Blob>;           // readText/readJson helpers wrap it
     write(path: string, data: Blob | string): Promise<Entry>; // creates or replaces
     move(from: string, to: string): Promise<void>;
     delete(path: string): Promise<void>;         // moves to Drive trash, never hard-deletes
     watch(path: string, cb: (entries: Entry[]) => void, intervalMs?: number): () => void;
     enqueue(job: Job): Promise<string>;
     claim(jobId: string, worker: string): Promise<Job | null>;
     complete(jobId: string, result: JobResult): Promise<void>;
     // additions needed to build the folder tree; see note below
     stat(path: string): Promise<Entry | null>;
     mkdir(path: string): Promise<Entry>;         // idempotent, like mkdir -p
   }
   ```
   Paths are always relative to `Noteable/` and use `/`. `Entry = { name, path, kind: 'file' | 'folder', size?, modifiedTime, id }` (the `id` is opaque to callers so a future `RailwayStorage` can use its own).
   **Note:** `stat` and `mkdir` are not in the spec's operation list. They are needed to check before creating folders; raised with Rob in the risk list.
7. [x] **DriveStorage.** `src/storage/DriveStorage.ts`, using `fetch` against `https://www.googleapis.com/drive/v3` and `https://www.googleapis.com/upload/drive/v3` (multipart upload for files under 5 MB, resumable upload above it — resumable is used from phase 2 for MP3s). No Drive client library.
   - Path resolution walks from the `Noteable` root folder ID with `files.list?q='<parentId>' in parents and name='<name>' and trashed=false`, caching path → ID in memory and IndexedDB. Names are escaped for the query (`'` and `\`).
   - Finding the root: `name='Noteable' and 'root' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`. If more than one matches, the oldest (`createdTime`) wins and the home screen shows a "duplicate Noteable folders found" warning; nothing is merged or deleted automatically.
   - `mkdir` creates each missing segment only after a fresh lookup confirms it is missing.
   - `delete` sets `trashed: true` (recoverable).
   - `watch` polls `list` on an interval (default 120 s) and calls back only when names or `modifiedTime` change.
   - `enqueue` writes `Queue/<job-id>.json` with `status: 'pending'`; `claim` reads, checks `status === 'pending'` (or stale `working` older than 15 min), writes `working` + `claimedBy` + `heartbeat`, then re-reads to confirm it won; `complete` writes `done` or `failed`.
   - All requests go through one `driveFetch()` that adds the bearer token from `auth.getToken()`, retries once on 401 after a token refresh, and backs off on 403 `rateLimitExceeded` / 429 / 5xx (exponential, max 4 tries).
8. [x] **Folder tree bootstrap.** `src/storage/bootstrap.ts` — `ensureLayout(storage)`:
   - `mkdir` for `Inbox`, `Library/General`, `Queue`, `State` (each checked first).
   - For each of `State/playback.json` (`{"version":1,"items":{}}`), `State/bookmarks.json` (`{"version":1,"bookmarks":[]}`), `State/settings.json` (`{"version":1,"voice":"af_bella","speed":1,"sleepTimerMin":30}`): `stat` first, write only if missing. Existing files are never overwritten.
   - Returns a status list `{ path, state: 'found' | 'created' | 'error' }[]` for the home screen.
9. [x] **Home screen.** `src/main.ts`, `src/ui/h.ts` (element helper), `src/ui/home.ts`, `src/ui/signin.ts`, `src/style.css`:
   - Signed out: app name, one-line description, **Sign in with Google** button.
   - Signed in: avatar + name + email, a list of the 7 folders/files each marked Found / Created / Error, **Sign out** button, small footer with app version (from `package.json`, injected by Vite `define`) and "Offline" badge when `navigator.onLine` is false.
   - Reconnect banner when `auth:needs-tap` fires.
   - Dark theme by default (matches AMOLED sleep mode later), readable at phone width.
10. [x] **GitHub repo and Pages.** (repo created public on 2026-10-06; Pages set to GitHub Actions; first push waits for the client ID)
    - `gh repo create IRobertRock/<repo-name> --<public|private> --source . --remote origin`
    - `.github/workflows/deploy.yml`: on `push` to `main` and `workflow_dispatch`; jobs `build` (`actions/checkout@v7`, `actions/setup-node@v7` with Node 24 and npm cache, `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, `actions/configure-pages@v6`, `actions/upload-pages-artifact@v5` with `dist`) and `deploy` (`actions/deploy-pages@v5`, permissions `pages: write`, `id-token: write`, environment `github-pages`).
    - `gh api -X POST repos/IRobertRock/<repo-name>/pages -f build_type=workflow` to switch Pages to Actions.
    - No `404.html` fallback is needed: the app is a single page with no client-side routes.
11. [x] **Google Cloud setup** (done 2026-10-06 in the browser pane: project `noteable-510805`, Drive API on, External + Testing, Rob as test user, client `Noteable web`) (Rob does this, I walk him through it — see "Google Cloud setup" below), then put the client ID in `src/config.ts`.
12. [x] **Deploy and verify** (Actions run green; live page loads, service worker active, manifest valid, no console errors. Sign-in left to Rob, because it grants Drive access on his account): push to `main`, watch the Actions run with `gh run watch`, load the Pages URL, sign in on the laptop, check Drive.
13. [x] **Commit** with a clear message and tick off this document.

## Tests

- **Unit (Vitest + happy-dom):**
  - `test/DriveStorage.test.ts` with a fake `fetch` that simulates a Drive tree: path resolution, query escaping, `mkdir` idempotence (calling it twice creates one folder), `write` replacing rather than duplicating, `delete` trashing, duplicate-root detection, 401 → refresh → retry, 429 back-off.
  - `test/bootstrap.test.ts`: empty Drive → 4 folder paths + 3 files created; second run → everything `found`, zero create calls; existing `settings.json` is never overwritten.
  - `test/queue.test.ts`: `enqueue` → `claim` → `complete`; a second `claim` on a `working` job returns `null`; a `working` job with a 16-minute-old heartbeat can be reclaimed.
- **Build checks:** `npm run typecheck` (`tsc --noEmit`), `npm run build`, and a grep in CI that fails if `googleapis.com/drive` or `/upload/drive` appears outside `src/storage/DriveStorage.ts`.
- **Local preview:** `npm run build && npm run preview` on `http://localhost:4173/<base>/` through the browser pane: manifest valid, service worker registered, app opens with network offline, sign-in popup works against `localhost` origin, folders appear in Drive.
- **Lighthouse-style PWA check** in the browser pane: installable, manifest icons present, SW controls the page.

## Gate

> Done when: the PWA installs on the S23 and laptop, signs in, and creates the Drive folders.

**On the S23 Ultra (Chrome):**

1. Open the GitHub Pages URL in Chrome.
2. Tap the ⋮ menu → **Add to home screen** → **Install**. Confirm the Noteable icon appears on the home screen.
3. Open Noteable from the home-screen icon. It opens full-screen with no address bar.
4. Tap **Sign in with Google**, pick your account, and on the "Google hasn't verified this app" screen tap **Continue**, then allow Drive access.
5. The home screen shows your name and email, and all seven entries show **Created** (first time) or **Found**.
6. Open the Google Drive app → My Drive → **Noteable**. Confirm `Inbox`, `Library/General`, `Queue`, `State`, and inside `State` the three `.json` files. There is exactly one `Noteable` folder.
7. Back in Noteable, tap **Sign out**, then **Sign in** again. Every entry shows **Found**. Refresh Drive: still exactly one of each folder and file.
8. Turn on airplane mode, close Noteable, reopen it from the icon. It opens (showing "Offline").

**On the laptop (Chrome or Edge):**

1. Open the Pages URL. Click the install icon in the address bar → **Install**.
2. Open the installed app, sign in. All entries show **Found** (they already exist from the phone).
3. Sign out, sign in again. Check drive.google.com: still one `Noteable` folder with no duplicates inside.

## Open questions

1. **Repo name and visibility.** I suggest `IRobertRock/noteable`, which gives `https://irobertrock.github.io/noteable/`. GitHub Pages on a private repo needs a paid GitHub plan — public or private?
2. **OAuth client ID** — after the Google Cloud walkthrough.
3. **Icon.** Do you have a logo, or is a simple generated headphones-over-page mark fine for now?
4. **Sign out** — local sign-out only (default), with an optional "also remove access" tick box. OK?
5. **`stat` and `mkdir`** added to the `Storage` interface — OK?

## Google Cloud setup (walkthrough for Rob)

Use the Google account whose Drive will hold `Noteable/`.

1. Go to <https://console.cloud.google.com/>. Top bar → project picker → **New project**. Name: `Noteable`. Organisation: none. **Create**, then make sure the new project is selected.
2. **Enable the Drive API:** ☰ → **APIs & Services** → **Library** → search "Google Drive API" → **Enable**.
3. **OAuth consent screen** (now called **Google Auth Platform**): ☰ → **APIs & Services** → **OAuth consent screen** → **Get started**.
   - App name `Noteable`, user support email = your Gmail → **Next**.
   - Audience: **External** → **Next**.
   - Contact email = your Gmail → **Next** → agree → **Create**.
4. **Audience** tab: Publishing status must say **Testing**. Under **Test users** → **Add users** → your Gmail → **Save**.
5. **Data access** tab → **Add or remove scopes** → tick `.../auth/drive` (See, edit, create and delete all of your Google Drive files), plus `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile` → **Update** → **Save**.
6. **Clients** tab → **Create client** → Application type **Web application**, name `Noteable web`.
   - **Authorised JavaScript origins:** `https://irobertrock.github.io`, `http://localhost:5173`, `http://localhost:4173` (origins only, no path).
   - **Authorised redirect URIs:** leave empty (the GIS popup flow doesn't use one).
   - **Create**. Copy the **Client ID** (ends in `.apps.googleusercontent.com`) and paste it to me in chat. Ignore the client secret — it is not used and must not be shared or committed.
7. Origin changes can take a few minutes (sometimes up to an hour) to take effect.

## Change log

- 2026-10-06 — Rob's answers: repo `IRobertRock/noteable`, generated icon is fine, local sign-out with optional revoke.
- Step 2: real client ID added to `src/config.ts` before the first commit (no placeholder ever committed). The client secret is not used and is not stored anywhere.
- Step 7: the path → ID cache is in memory only, not IndexedDB. Lookups are cheap and an in-memory cache avoids stale IDs when Rob moves folders in Drive. Revisit in phase 3 if start-up is slow.
- Step 7: uploads are multipart only for now; resumable upload for large MP3s moves to phase 2 as planned there.
- Step 1: TypeScript 7.0.2 works with the whole toolchain; no fallback needed. `vite.config.ts` needs `/// <reference types="vitest/config" />` for the `test` block.
- Step 10: workflow written (`.github/workflows/deploy.yml`, also runs the Drive-boundary check); repo not created yet.
- Tests: 22 unit tests pass (DriveStorage, bootstrap, queue); typecheck, build and Drive-boundary check pass.
- Local preview through the browser pane was skipped: the pane was still bound to another project's launch config. The live Pages site was checked instead.

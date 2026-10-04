# X ChromaBot — Engineering Backlog

Audit date: 2026-09-30. Branch audited: `claude/inspiring-bardeen-fhi8x3` (identical to `main`, HEAD `b432d85`).
All `file:line` references are to that commit. Line numbers will shift as tickets land; agents should
locate code by the quoted identifiers, not only by line number.

Verified toolchain state at audit time (Node 22.22, npm 10.9):

| Check | Command | Result |
| :-- | :-- | :-- |
| Install | `npm install --legacy-peer-deps` | OK, 0 vulnerabilities |
| Types | `npx tsc --noEmit` (what `npm run lint` runs) | **passes, 0 errors** (also passes with `--strict`; `--noUnusedLocals` reports 30 unused imports/vars) |
| Build | `npm run build` | OK, single 960 KB JS chunk (Vite warns > 500 KB) |
| Dry run | `npx tsx scripts/post-drop.ts --dry-run` | OK (simulated) — note it creates `data/bot-store.json` as a side effect |
| Server smoke | `NODE_ENV=production npx tsx server.ts` + curl | Boots; **every `/api/*` route answers without authentication** (see SEC-2) |
| Tests / lint | — | **None exist.** No ESLint, Prettier, Vitest, Jest, or test files. |

---

## 1. App overview

### What it does
A single-admin "campaign" bot that posts procedurally generated **color drops** to X (Twitter). Each drop
picks a curated sunrise/sunset color (`server/colorEngine.ts`), a 3–5 word weather phrase, and renders a
text template such as `{color_pick} {weather_desc} #eternal #colors`. Templates may contain
`<agent>…</agent>` / `<history><agent>…</agent></history>` tags that are expanded by **Google Gemini**
into short poems (optionally fed the campaign's prior tweets). A drop can be a **reply** to a target
tweet (either always the root post, or "chain mode": reply to our own last reply), a **quote tweet**, or a
**standalone** timeline post.

Multiple **contexts** ("campaigns") each have their own target tweet, engagement mode, schedule
(repeating interval with random "humanized" jitter, or fixed clock times in a timezone), template,
dry-run flag, and stats. A 14-slot **queue** of pre-rolled colors/previews exists per context.

### Architecture (as built)

```
Browser (React 19 + Vite 8 + Tailwind 4 + lucide-react)        src/
  AuthProvider/AuthGate  -> Firebase Auth (Google popup), UI-only whitelist of ONE email
  ChromaBotDashboard     -> polls /api/status, /api/history, /api/queue every 8 s
  firestoreSync.ts       -> browser writes settings/contexts/logs to Firestore (client SDK)
        | fetch (no credentials/token attached)
Express 4 server (tsx, no build step)                            server.ts (584 lines, all routes inline)
  storage.ts   singleton: contexts, settings, queue, logs, X credentials, cooldown -> data/bot-store.json
  scheduler.ts setInterval(10 s) tick -> per-context schedule evaluation -> executeDrop()
  templateAgent.ts -> @google/genai (GEMINI_API_KEY)
  twitterClient.ts -> api.x.com/2/tweets (OAuth 1.0a HMAC-SHA1 signed, or OAuth 2.0 user token w/ refresh)
  Vite dev middleware (non-production) / static dist (production)
scripts/post-drop.ts   standalone CLI used by GitHub Actions cron (imports storage, colorEngine, twitterClient)
.github/workflows/chromabot-scheduler.yml  cron */5 * * * *  -> post-drop.ts   (!)
.github/workflows/ci.yml                   tsc + vite build + dry-run on main
```

### Data flow of one scheduled drop
`scheduler.tick()` (10 s) → global cooldown / rate-window / 60 s anti-burst checks → for each enabled
context `evaluateContextSchedule()` → `executeDrop()` → pops the next queue color → `resolveTemplateText()`
(Gemini if `<agent>` present) → `postColorTweet()` → cooldown/telemetry update → `recordContextPostResult()`
(stats, chain anchor `lastPostedTweetId`, next jitter) → `addLog()` → `save()` to JSON.

### External dependencies
| Dependency | Where | Notes |
| :-- | :-- | :-- |
| X API v2 (`POST /2/tweets`, `GET /2/users/me`, `POST /2/oauth2/token`) | `server/twitterClient.ts` | Hand-rolled OAuth 1.0a signing (correct per RFC 5849 for a JSON body with no query params). |
| Google Gemini via `@google/genai` | `server/templateAgent.ts` | Model IDs hard-coded (`gemini-3.8-flash`, `gemini-3.1-flash-lite`, `gemini-flash-latest`); UA `aistudio-build`. |
| Firebase Auth + Firestore (client SDK only) | `src/lib/firebase.ts`, `src/lib/firestoreSync.ts` | Config read from `firebase-applet-config.json` (AI Studio-provisioned project `hitthehatch`, named database `ai-studio-xchromabotautoma-…`). No `firebase-admin` on the server. |
| GitHub Actions | `.github/workflows/*` | Secrets `TWITTER_*`, `TARGET_TWEET_ID`; environment `prod`. |
| Local JSON file | `data/bot-store.json` | **The server's only persistence.** Gitignored. |

### How it is deployed today and AI Studio coupling
Deployed as a Google AI Studio "applet" (Cloud Run under the hood). Coupling points that must be
removed or made optional to run elsewhere:

* `firebase-applet-config.json` (`src/lib/firebase.ts:4`) — AI Studio-provisioned Firebase project/db id.
* `metadata.json` — AI Studio manifest (`MAJOR_CAPABILITY_SERVER_SIDE_GEMINI_API`).
* `.env.example:1-9` — `GEMINI_API_KEY` and `APP_URL` "injected by AI Studio".
* `vite.config.ts:15-19` — `DISABLE_HMR` flag for AI Studio's editor.
* `server/templateAgent.ts:18` — `User-Agent: aistudio-build`.
* `server.ts:23` — port hard-coded to 3000; `package.json:9` `start` does not set `NODE_ENV=production`, so
  outside AI Studio the "production" server runs the Vite dev middleware unless the platform sets `NODE_ENV`.
* No `Dockerfile`, `firebase.json`, or `.firebaserc`; Firestore rules are deployed by AI Studio tooling and
  are duplicated (and already diverged) between `firestore.rules` and `firebase-blueprint.json:102`.
* Ephemeral disk: on Cloud Run/AI Studio `data/bot-store.json` is lost on every new revision or instance,
  and the in-process `setInterval` scheduler only runs while an instance is alive (see REL-2).

---

## 2. Assessment

### Strengths
* The core product loop works end to end: git history shows real tweets were posted (6 live `success`
  logs with `x.com/i/status/…` URLs in the store committed at `e92ad89`).
* Type-clean codebase: `tsc --noEmit --strict` passes with zero errors today.
* OAuth 1.0a signing, rate-limit header parsing, and error-message mapping for X's 402/403/429 cases are
  correct and thoughtfully done (`server/twitterClient.ts:62-136, 370-392`).
* Genuinely useful safety concepts already exist: dry-run, global cooldown on 429/403, 60 s anti-burst,
  jitter, chain-anchor sanitisation, pre-emptive hold when `remaining === 0`.
* The UI is complete and polished for a prototype: campaigns, queue, history, credentials, settings,
  rate-limit telemetry modal, dark mode, mobile drawer.
* `<agent>` template tags with series history are a differentiating feature; the template engine is
  small and easy to extend.

### Key problems

#### Security (P0)
1. **Live X credentials are in git history.** `data/bot-store.json` was committed in `2f533b7` and
   `e92ad89` with `credentials.apiKey` (25 chars), `credentials.apiSecret` (50 chars) and
   `credentials.bearerToken` (114 chars, `AAAA…`). It was removed and gitignored in `5573d47`, but the
   objects remain in every clone and on GitHub (`derekleavitt/puja-tweet`). → SEC-1.
2. **No authentication on the API.** Firebase auth gates only the React tree (`src/components/AuthGate.tsx`);
   `server.ts` never checks a token. Verified with curl against a fresh server: `GET /api/status` returns
   settings including the webhook secret; `POST /api/credentials` accepted and stored an attacker key;
   `DELETE /api/history` wiped logs; `POST /api/post-now` with `forceLive:true` would post to X. → SEC-2.
3. **Webhook secret defaults to the literal `chroma_auto_secret`** (`server/storage.ts:147, 835`;
   `src/components/SettingsPanel.tsx:46`; `src/components/StandaloneExport.tsx:28`) and is returned by the
   unauthenticated `/api/status`. `GET /api/cron/trigger?secret=…&forceLive=true` posts a live tweet
   (`server.ts:373-404`). → SEC-3.
4. **X credentials are persisted in plaintext JSON** (`server/storage.ts:357`) and the masked status leaks
   the first/last 3 characters of the API key and access token (`server/storage.ts:893-897`). → SEC-4.
5. Firestore rules are fine for a single admin (`firestore.rules:9-11`), but the whitelist email, the
   owner's X handle (`@bhaijahndai`) and the Firebase web config are hard-coded in six places
   (`src/lib/firebase.ts:17`, `server/twitterClient.ts:372-374`, `src/components/LiveStudio.tsx:548`,
   `src/components/TargetTweetEditor.tsx:327`, `firebase-blueprint.json:5`). → PORT-2.

#### Correctness bugs (traced end to end; each has a ticket)
| # | Bug | Where |
| :-- | :-- | :-- |
| B1 | GitHub Actions cron runs **every 5 minutes** and `post-drop.ts` posts on every run with no slot/dedupe gate → 288 live replies/day if secrets are set (Free tier cap is 17/day); README contradicts itself (`README.md:6` vs `:17`). | `.github/workflows/chromabot-scheduler.yml:6`, `scripts/post-drop.ts:99-106` |
| B2 | Morning/evening slot uses a hard-coded UTC−7 offset (no DST, ignores context timezone). Verified: 12:30 Z in July → code says hour 5, Denver is 06. | `server/scheduler.ts:52-54`, `scripts/post-drop.ts:40-45` |
| B3 | Fixed-time schedules: `"6:00"` never matches the zero-padded `"06:00"` Intl output (SettingsPanel's regex accepts `6:00`); `isMorning` is `startsWith('06')`; jitter is computed for fixed mode but never applied; firing calls `updateContext` which wipes and regenerates the queue just before posting. | `server/scheduler.ts:280-285`, `src/components/SettingsPanel.tsx:89`, `src/components/ContextsManager.tsx:1031`, `server/storage.ts:738-740, 603` |
| B4 | **Two sources of truth with last-writer-wins on every page load.** On mount the browser PUTs every Firestore context back into the server (`updateContext` spreads all fields incl. `lastPostedTweetId`, `lastPostedTimestamp`, `enabled`, `stats`) and regenerates each queue. If the server posted while the tab was closed, the stale cloud copy overwrites the chain anchor → next chain reply targets the wrong/old tweet. | `src/App.tsx:195-210`, `server/storage.ts:553-556, 575-578, 603` |
| B5 | "Clear history" clears server logs but the 8 s poll re-merges up to 50 Firestore logs, so they reappear. Scheduled (server-initiated) posts are never written to Firestore at all — only manual UI posts are. | `src/App.tsx:142-168, 420-444, 580-585`, `src/lib/firestoreSync.ts:91-118`, `server/scheduler.ts:183` |
| B6 | Saving OAuth 1.0a keys wipes OAuth 2.0 keys and vice-versa (client sends `''` for blank fields, server spreads them over the stored object); leaving a field blank to "keep existing" erases it. | `src/components/TwitterSetup.tsx:45-50, 64-69`, `server.ts:246-256`, `server/storage.ts:921-927` |
| B7 | Refreshed OAuth 2.0 tokens are never persisted (`creds` is a throwaway object) — with X's rotating refresh tokens the second refresh fails. | `server/twitterClient.ts:244-245, 352-353`, `server/storage.ts:877-889` |
| B8 | Unknown `contextId` silently falls back to the **active** context — a trigger/webhook for a deleted or mistyped campaign posts for a different one. `activate` returns `success:true` for unknown ids. | `server/scheduler.ts:48-50`, `server.ts:198-214, 351-370, 387`, `server/storage.ts:490-501` |
| B9 | **Rules-of-Hooks violation**: `LiveStudio` returns early when `color` is null before calling `useState`/`useCallback`/`useEffect`; when `/api/generate-color` fails once and later succeeds React throws "Rendered more hooks…". | `src/components/LiveStudio.tsx:40-47` vs `:60-61, 83, 108` |
| B10 | Preview ≠ post for `<agent>` templates: the studio previews poem A (`/api/template/preview`) but `/api/post-now` re-resolves the template and posts poem B. `/api/generate-color` also runs Gemini although its only caller discards `previewText` (double Gemini cost per click). "Send" on a queue slot posts the colour but does not consume the slot, so the scheduler posts it again. | `src/components/LiveStudio.tsx:83-114, 471`, `server.ts:274-312`, `src/App.tsx:170-184, 248-290`, `src/components/QueueViewer.tsx:238` |
| B11 | `SettingsPanel` copies props into `useState` once; switching the active campaign while on the Timing tab shows the old campaign's values and **Save writes them (including a stale `lastPostedTweetId`) into the new active context**. | `src/components/SettingsPanel.tsx:39-51, 93-107`, `server/storage.ts:858` |
| B12 | Chain auto-recovery resets the anchor and retries at root on *any* non-throttle failure, including 401 bad auth, network errors, and 402 credits (402 is only excluded by substring match). | `server/scheduler.ts:102-137` |
| B13 | A new context is created with `lastPostedTimestamp: 0`, so an enabled interval context **fires a live drop within 10 s of creation**. The 60 s anti-burst check runs once per tick, then the loop posts for every due context back-to-back. | `server/storage.ts:528`, `server/scheduler.ts:217-229, 248` |
| B14 | Header "Dry Run/Live" pill, StatusBar "Pause/Resume", and the Settings "Automated Background Scheduler" checkbox only affect the **active** context; other campaigns keep posting live. No global kill switch. | `src/components/Header.tsx:180-192`, `src/components/StatusBar.tsx:173-178`, `src/App.tsx:447-498`, `server/storage.ts:819-873` |
| B15 | "Quote-tweet auto-fallback on 403" is promised in three places but does not exist: storage forces `autoFallbackToQuote=false` everywhere while `getSettings` reports `?? true`; `twitterClient` never reads the option. | `server/storage.ts:242-245, 514, 582, 796, 825`, `server/twitterClient.ts:33`, `src/components/TargetTweetEditor.tsx:288, 328`, `src/components/RateLimitModal.tsx:296` |
| B16 | No server-side tweet-length guard (UI only disables the button for the *static* preview); Gemini output is asked to be < 240 chars but not enforced → X 403 + cooldown. `String.replace(fullMatch, generated)` interprets `$&`/`$1` in generated text (verified). Missing `GEMINI_API_KEY` costs 3 × 15 s timeouts per resolve. History fed to Gemini includes failed/simulated posts and falls back to other campaigns' logs. | `server/templateAgent.ts:70-84, 136-152, 213, 231`, `server/scheduler.ts:59-63` |
| B17 | `{time_tag}` is always `6:00 AM`/`6:00 PM` even for interval posts at 15:37; History/Queue labels say "6:00 AM Drop"/"MST" regardless of schedule/timezone. Three different default target tweet IDs (`2091597504928428416` in server/App/ContextsManager, `2103110008212992249` in TargetTweetEditor "Reset to original" and `.env.example`). | `server/scheduler.ts:58`, `server.ts:284, 322`, `server/colorEngine.ts:308`, `src/components/HistoryTable.tsx:113-119`, `src/components/QueueViewer.tsx:194`, `src/components/ContextsManager.tsx:362, 430`, `src/components/TargetTweetEditor.tsx:49`, `server/storage.ts:138` |
| B18 | "Ping" export tab: generated Node script/YAML use a different tweet format, ignore the template/engagement mode, and reference `scripts/standalone-poster.mjs` which does not exist; the cURL sample uses an app-only Bearer token, which the app itself says cannot post (`twitterClient.ts:263`). | `server.ts:438-556`, `src/components/StandaloneExport.tsx:30-38` |
| B19 | `scripts/post-drop.ts` is a second, divergent implementation: always reply mode, no `<agent>` support (`formatTweetText`), no chain mode, logs to an ephemeral file, never reaches Firestore/dashboard history. | `scripts/post-drop.ts:88-138` |

#### Reliability
* Persistence is a synchronous, non-atomic `writeFileSync` on every mutation **and on GET `/api/queue`**
  (`server/storage.ts:344-368, 1156-1160`); a crash mid-write → `load()` swallows the parse error and
  silently boots with defaults (credentials, campaigns gone). In-memory `logs` grow unbounded
  (only the saved slice is capped at 150, `:351`).
* No timeouts on X/Gemini `fetch`; a hung request leaves `scheduler.isProcessing = true` forever
  (`server/scheduler.ts:197-234`) and the bot silently stops.
* No circuit breaker: a persistent 401/402 error retries every 15 min forever (`server/storage.ts:764-775`).
* On Cloud Run the scheduler dies with the instance and multiple instances would each keep their own
  file and double-post.

#### Missing tests / CI / DX
* Zero tests, no linter (`npm run lint` is `tsc --noEmit`), no formatter, no `include` in `tsconfig.json`
  so **the built `dist/assets/*.js` bundle is type-checked** after a build (`allowJs` + no `include`).
* Two lockfiles (`bun.lock`, `package-lock.json`); CI uses `npm install --legacy-peer-deps`, not `npm ci`.
* Unused deps: `motion`, `autoprefixer`, `esbuild` (`package.json:23, 32, 34`). Package is still named
  `react-example`.
* Four copies of template substitution (`server/colorEngine.ts:307-327`, `server/storage.ts:1018-1042`,
  `server/templateAgent.ts:44-65`, `src/components/LiveStudio.tsx:68-81`) that already drift
  (`{time_slot}` only exists in one). Two copies of `extractTweetId` (`ContextsManager.tsx:68`,
  `TargetTweetEditor.tsx:16`, regex `\d{8,25}`) plus `cleanTweetId` on the server (`\d{10,25}`).
  `src/types.ts` duplicates the server interfaces by hand.
* Monoliths: `server/storage.ts` 1228 lines, `src/components/ContextsManager.tsx` 1245, `src/App.tsx` 793,
  `src/components/SettingsPanel.tsx` 707, `server.ts` 584.

#### UX
* Desktop nav is hidden below the `2xl` (1536 px) breakpoint (`src/components/Header.tsx:132, 235`) —
  most laptops get only the hamburger.
* Native `confirm()` dialogs; most failed requests are swallowed with `console.error` and no toast
  (`src/App.tsx:371-399`).
* Three parallel requests every 8 s, `/api/status` returns the full queue and contexts each time.
* Per-campaign vs global state is invisible (B14); "Live X API" is shown while credentials are missing and
  posts are silently simulated (`server/twitterClient.ts:281`, log says `mode: LIVE X`).

---

## 3. Architecture

### Goals
Keep the AI Studio stack exactly as is (React 19 + Vite 8 + Tailwind 4 + lucide-react, Express 4 run
with `tsx`, Firebase, `@google/genai`), keep the naming and component idioms, but split the monoliths
along clear boundaries so bug fixes are local and testable.

### Target structure

```
shared/                         # isomorphic, no Node or DOM APIs; imported by server AND client via '@/shared/*'
  types.ts                      #   single home for TweetContext, BotSettings, PostLog, QueueSlot, ColorData, API DTOs
  template/substitute.ts        #   ONE implementation of {color_pick}… substitution (+ list of supported tokens)
  template/agentTags.ts         #   parse <agent>/<history> tags (pure), hasAgentTag(), stripAgentTags()
  tweetId.ts                    #   extractTweetId() used by UI validation and server cleaning
  time.ts                       #   normalizeHHmm(), slotForHour(), formatInZone() helpers
server/
  index.ts                      # boot only: load env, createApp(), scheduler.start(), listen(PORT)
  app.ts                        # createApp(deps): express, json, auth middleware, routes, static/vite, error handler
  config.ts                     # typed env access (PORT, DATA_DIR, WEBHOOK_SECRET, GEMINI_*, X_*, AUTHORIZED_EMAILS…)
  middleware/auth.ts            # requireAdmin (Firebase ID token), requireWebhookSecret
  middleware/error.ts           # single error → {success:false,error} mapper, HttpError class
  routes/                       # thin: validate input → call service → res.json. One file per resource.
    status.ts contexts.ts settings.ts credentials.ts drops.ts queue.ts history.ts export.ts webhook.ts
  services/                     # domain logic, no express, no fs
    contextService.ts queueService.ts logService.ts settingsService.ts credentialService.ts
    rateLimitService.ts dropService.ts (executeDrop) schedulerService.ts (tick loop only)
  store/
    Store.ts                    # interface: load()/save(state) + typed BotState
    JsonFileStore.ts            # current behaviour (atomic write, debounced)
    FirestoreStore.ts           # firebase-admin backed (REL-2)
  integrations/
    x/client.ts x/oauth1.ts x/oauth2.ts x/errors.ts
    gemini/poetryAgent.ts
  domain/color.ts               # colorEngine (pure)
src/
  api/client.ts                 # apiFetch<T>() – attaches Firebase ID token, throws ApiError on !ok
  api/endpoints.ts              # typed functions per route (getStatus, createContext, postNow…)
  hooks/                        # useBotStatus, useContexts, useQueue, useHistory, useCredentials, useCountdown, usePolling
  features/
    studio/   (LiveStudio → ColorCanvas, TweetPreviewCard, PostResultToast)
    campaigns/ (ContextsManager → ContextCard, ContextFormModal, ScheduleEditor, EngagementModeSelector, ReplyModeSelector)
    queue/ history/ settings/ credentials/ automation/ (StandaloneExport)
  components/
    ui/ (Modal, ConfirmDialog, Toast, Badge, SegmentedControl, CopyButton)
    TemplateEditor.tsx          # shared by settings + campaign form (presets, tokens, AI test)
    Header.tsx StatusBar.tsx RateLimitModal.tsx AuthGate.tsx
  context/AuthContext.tsx  lib/firebase.ts  lib/firestoreSync.ts (shrinks/disappears after REL-2)
scripts/post-drop.ts            # thin CLI over services/dropService (same code path as the server)
tests/
  unit/   (vitest: shared/*, domain/color, x/oauth1, services/* with an in-memory Store)
  api/    (vitest + supertest against createApp() with in-memory Store and stubbed X/Gemini)
```

Boundaries:
* `routes/*` never touch `fs`, `fetch`, or the store directly; `services/*` never import express.
* Everything under `shared/` must compile in both `tsc` targets and never import from `server/` or `src/`.
* The store is the only place that knows about persistence; services receive it by constructor/injection
  so tests use an in-memory implementation.
* `dropService.executeDrop()` is the **single** code path for scheduler, manual post, webhook, and CLI.

### Coding conventions (agents must follow)
1. **Stack stays put.** No new frameworks or state libraries. Allowed additions: `vitest`, `supertest`,
   `eslint` + `typescript-eslint` + `eslint-plugin-react-hooks`, `prettier`, `firebase-admin`, `zod`
   (request validation). Ask before anything else.
2. **Style as AI Studio wrote it:** TypeScript ESM, 2-space indent, single quotes, trailing commas,
   `import … from './x.js'` extension style for TS files (already used everywhere except `main.tsx`),
   block-comment file headers, `camelCase` fields, ids like `ctx_…`/`log_…`/`slot_…`, `[Module]`-prefixed
   `console.log`s on the server, named exports (`export const Foo: React.FC<FooProps>`), Tailwind
   utility classes with paired `dark:` variants, `lucide-react` icons at `w-3.5 h-3.5`/`w-4 h-4`,
   `cursor-pointer` on buttons, `shadow-xs` cards, `text-xs` dense UI.
3. **API contract:** JSON `{ success: true, ...data }` on success; `{ success: false, error }` with a
   real HTTP status (400 validation, 401 auth, 404 unknown id, 409 conflict, 502 upstream) on failure.
   Never `success:true` for a no-op on an unknown id.
4. **One source of truth** for each piece of state; never copy server defaults into client code.
5. **No hard-coded personal identifiers** (emails, X handles, tweet IDs, secrets) — read from
   `server/config.ts` / `import.meta.env.VITE_*`.
6. **Size limits:** files ≤ 300 lines, React components ≤ 200 lines, functions ≤ 60 lines. Split rather
   than grow.
7. **Every PR:** `npm run typecheck && npm run lint && npm test && npm run build` green; add/extend tests
   for the behaviour touched; do not reformat unrelated files (formatting lands in DX-3 only).
8. **Safety default:** anything that can post live to X must be behind an explicit flag; simulated results
   must be labelled simulated in logs, API responses, and UI.

---

## 4. Backlog

Sizes: S ≈ ≤ 2 h focused work, M ≈ half day, L ≈ a day. Every ticket is one PR. Tickets list the files
they may touch; agents should not edit other files without noting it in the PR.

### Epic SEC — Security

#### SEC-1 · Rotate leaked X credentials and purge them from git history
* **Priority** P0 · **Size** S · **Deps** none
* **Files** git history only (`data/bot-store.json` in commits `2f533b7`, `e92ad89`); `README.md`; `.github/workflows/ci.yml` (add secret scan step)
* **Problem** `git show e92ad89:data/bot-store.json` contains `credentials.apiKey`, `credentials.apiSecret`
  and `credentials.bearerToken` for the X developer app. The file was gitignored in `5573d47` but the blobs
  are still reachable in every clone and on GitHub.
* **Acceptance**
  1. Owner regenerates the X consumer key/secret, bearer token, and access token/secret in the X developer
     portal (agent cannot do this — the PR must include a checklist and stop with a clear hand-off).
  2. History rewritten with `git filter-repo --path data/bot-store.json --invert-paths` (document the
     exact commands and the force-push + re-clone consequences in the PR description; do not run it
     against `main` without owner confirmation).
  3. `gitleaks detect --no-git` and `gitleaks detect` (history) added to `ci.yml` and passing.
  4. `README.md` gains a "Secrets" section: never commit `data/`, `.env*`.
* **Verify** `git log --all -p -- data/bot-store.json | grep -c bearerToken` → 0 after rewrite; CI green.

#### SEC-2 · Require a Firebase ID token on every `/api/*` route
* **Priority** P0 · **Size** M · **Deps** ARCH-2, ARCH-4
* **Files** `server/app.ts`, `server/middleware/auth.ts` (new), `server/config.ts`, `src/api/client.ts`, `package.json` (add `firebase-admin`), `README.md`, `.env.example`
* **Problem** No route checks who is calling (`server.ts:30-556`). Verified: unauthenticated
  `POST /api/credentials` and `DELETE /api/history` succeed. The UI already signs the admin in with
  Firebase; the server just has to verify the token.
* **Acceptance**
  1. `requireAdmin` middleware verifies `Authorization: Bearer <idToken>` with `firebase-admin`
     (`getAuth().verifyIdToken`, project from `FIREBASE_PROJECT_ID`; ADC or `GOOGLE_APPLICATION_CREDENTIALS`
     / `FIREBASE_SERVICE_ACCOUNT_JSON` env) and checks `email` ∈ `AUTHORIZED_EMAILS` (comma-separated env,
     default = the current whitelist email so nothing breaks).
  2. Applied to all `/api/*` except `/api/cron/trigger`, `/api/webhook/trigger` (SEC-3) and `/healthz`.
  3. `src/api/client.ts` attaches `await auth.currentUser.getIdToken()`; on 401 the UI signs out with a
     message.
  4. `AUTH_DISABLED=true` env allows local development without Firebase credentials, logged loudly at boot.
  5. API tests: 401 without token, 403 with a token for a non-whitelisted email (mock `verifyIdToken`),
     200 with a whitelisted one.
* **Verify** `curl -s -o /dev/null -w '%{http_code}' localhost:3000/api/status` → 401; `npm test`.

#### SEC-3 · Webhook: no default secret, never expose it, POST-only live posting
* **Priority** P0 · **Size** S · **Deps** ARCH-2
* **Files** `server/routes/webhook.ts`, `server/middleware/auth.ts`, `server/config.ts`, `server/storage.ts` (`DEFAULT_SETTINGS.webhookSecret:147`, `getSettings:835`, `updateSettings:867-870`), `server/routes/status.ts`, `src/components/SettingsPanel.tsx:46,120-121,461-472`, `src/components/StandaloneExport.tsx:27-28`, `.env.example`
* **Problem** Default secret `chroma_auto_secret` (`server/storage.ts:147`) is returned by `/api/status` and
  displayed in two tabs; `app.all` accepts `GET …?forceLive=true` (`server.ts:373-404`).
* **Acceptance**
  1. Secret comes from `WEBHOOK_SECRET` env; if unset, generate 32 random bytes on first boot, persist,
     and log a one-time notice. No literal default anywhere in the repo (`grep -r chroma_auto_secret` → 0).
  2. Constant-time comparison (`crypto.timingSafeEqual`), accepted only via `x-cron-secret` header or
     `?secret=`; `forceLive` only honoured on `POST`.
  3. `/api/status` and `/api/settings` never return the secret; a new admin-only `GET /api/webhook/url`
     returns the full URL for the Settings/Ping tabs (which read it from there instead of `settings.webhookSecret`).
  4. `POST /api/settings/webhook-secret/rotate` regenerates it.
  5. API tests for wrong/missing secret (401), GET with `forceLive` (ignored), POST ok.
* **Verify** `curl "localhost:3000/api/cron/trigger?secret=chroma_auto_secret"` → 401; `npm test`.

#### SEC-4 · Credential handling: no plaintext at rest, no partial-wipe, persist refreshed OAuth2 tokens, tighter masking
* **Priority** P1 · **Size** M · **Deps** ARCH-3
* **Files** `server/services/credentialService.ts`, `server/store/JsonFileStore.ts`, `server/integrations/x/client.ts` (`refreshOAuth2Token` callers, formerly `twitterClient.ts:244-245, 352-353`), `server/routes/credentials.ts`, `src/components/TwitterSetup.tsx:41-77`, `server/config.ts`, `.env.example`
* **Problem** (a) `save()` writes `credentials` to plaintext JSON (`server/storage.ts:357`). (b) Saving the
  OAuth1 form sends `''` for blank fields and `updateCredentials` spreads them over the stored object
  (`src/components/TwitterSetup.tsx:64-69`, `server/storage.ts:921-927`) → other method's keys wiped,
  "keep existing" impossible. (c) Refreshed OAuth2 access/refresh tokens are dropped (`twitterClient.ts:244, 352`);
  X rotates refresh tokens so the next refresh fails. (d) Masking shows 3+3 chars of secrets (`storage.ts:893-897`).
* **Acceptance**
  1. Credentials encrypted at rest with AES-256-GCM using `CREDENTIALS_ENCRYPTION_KEY` (32-byte hex/base64
     env); if unset, credentials are held in memory only and the UI says so ("not persisted across restarts").
  2. `updateCredentials` ignores `undefined` and `''`; explicit clearing via `DELETE /api/credentials/:method`.
  3. `postColorTweet`/`verifyTwitterCredentials` accept an `onTokensRefreshed(tokens)` callback that the
     service uses to persist new tokens.
  4. Masked status shows only `••••` + last 2 chars.
  5. Unit tests for merge semantics, encryption round-trip, refresh persistence.
* **Verify** `npm test`; save OAuth1 keys then OAuth2 keys in the UI → both remain configured.

### Epic DX — Build, lint, test, CI

#### DX-1 · Toolchain hygiene: tsconfig include/strict, one lockfile, `npm ci`, scripts, engines
* **Priority** P0 · **Size** S · **Deps** none
* **Files** `tsconfig.json`, `package.json`, `bun.lock` (delete), `.nvmrc` (new), `.github/workflows/ci.yml`, `.github/workflows/chromabot-scheduler.yml:47`, `README.md`
* **Problem** No `include` → `dist/assets/*.js` is type-checked after a build (verified with
  `tsc --listFilesOnly`); no `strict`; two lockfiles; CI uses `npm install --legacy-peer-deps`; unused deps
  `motion`, `autoprefixer`, `esbuild`; package named `react-example`; `lint` script runs `tsc`.
* **Acceptance**
  1. `tsconfig.json`: `"strict": true`, `"noUnusedLocals": true`, `"noUnusedParameters": true`,
     `"include": ["src", "server", "server.ts", "scripts", "shared", "vite.config.ts", "tests"]`, `"exclude": ["dist", "node_modules"]`,
     `"types": ["vite/client", "node"]`. Fix the ~30 resulting unused-import errors (delete imports only; no
     other changes).
  2. `package.json`: name `x-chromabot`, `engines.node >=22`, scripts `typecheck` (tsc), `lint` (placeholder
     `echo` until DX-3), `test` (placeholder until DX-2), `start` = `NODE_ENV=production tsx server.ts`;
     remove `motion`, `autoprefixer`, `esbuild`.
  3. Delete `bun.lock`; regenerate `package-lock.json`; both workflows use `npm ci`.
  4. `.nvmrc` = `22`.
* **Verify** `rm -rf dist && npm ci && npm run typecheck && npm run build && npx tsc --listFilesOnly | grep -c dist/` → 0.

#### DX-2 · Test harness (Vitest + Supertest) with first real tests
* **Priority** P0 · **Size** M · **Deps** DX-1, ARCH-2
* **Files** `vitest.config.ts` (new), `package.json`, `tests/unit/*.test.ts` (new), `tests/api/*.test.ts` (new), `server/store/JsonFileStore.ts` or `server/storage.ts` (add `DATA_DIR` env support only), `.github/workflows/ci.yml`
* **Problem** Zero tests; `storage.ts:134` hard-codes `data/` under `cwd`, so importing it in tests writes files.
* **Acceptance**
  1. `npm test` runs Vitest; CI runs it.
  2. `DATA_DIR` env respected by the store; tests use a temp dir.
  3. Unit tests: `generateColor` shape/ranges for both slots; `generateWeatherDescription` word count 3–5;
     `generateOAuth1Header` against a known vector (fixed nonce/timestamp via injection); rate-limit
     header parsing; `hexToRgb/rgbToHsl/hslToHex` round trips; `substituteVariables` covers every token.
  4. API tests via `createApp()` + supertest with `AUTH_DISABLED=true`: `GET /api/status` shape,
     `POST /api/contexts` → 400 on invalid target, `POST /api/post-now` in dry-run returns `simulated:true`
     and appends a log (X client stubbed with `vi.mock`).
* **Verify** `npm test` green locally and in CI.

#### DX-3 · ESLint + Prettier, fix violations (including the LiveStudio hooks bug)
* **Priority** P1 · **Size** S · **Deps** DX-1, ARCH-1, ARCH-4 (run after those to avoid churn)
* **Files** `eslint.config.js`, `.prettierrc`, `package.json`, `.github/workflows/ci.yml`, plus mechanical fixes across `src/**` and `server/**`; `src/features/studio/LiveStudio.tsx` (hooks fix)
* **Problem** No linter. `LiveStudio` calls hooks after a conditional return (`LiveStudio.tsx:40-47` before
  `:60, 83, 108`) — `react-hooks/rules-of-hooks` error and a real crash path.
* **Acceptance**
  1. Flat config with `typescript-eslint` recommended, `react-hooks` (rules-of-hooks = error,
     exhaustive-deps = warn), `react-refresh/only-export-components` warn.
  2. `npm run lint` = `eslint . && prettier --check .`; `npm run format` writes.
  3. LiveStudio early return moved below all hooks (or the loading state rendered by the parent).
  4. Single "format" commit separate from the "fix lint errors" commit so review is possible.
* **Verify** `npm run lint` → 0 errors; with `color` initially null and then set, Studio renders without a hooks error.

### Epic REL — Reliability & scheduling safety

#### REL-1 · Stop the GitHub Actions cron from posting every 5 minutes
* **Priority** P0 · **Size** S · **Deps** none
* **Files** `.github/workflows/chromabot-scheduler.yml`, `scripts/post-drop.ts`, `README.md`
* **Problem** `cron: '*/5 * * * *'` (`chromabot-scheduler.yml:6`) + `post-drop.ts` posts unconditionally
  (`:99-106`) → up to 288 live replies/day; `README.md:6` says every 5 min, `:17` says twice daily.
* **Acceptance**
  1. Cron set to two UTC times approximating 06:00/18:00 America/Denver (`0 12,0 * * *` during DST,
     documented caveat) **and** the workflow requires `workflow_dispatch` or an explicit repository
     variable `CHROMABOT_ACTIONS_ENABLED == 'true'` to run the scheduled job (`if:` guard) so it is off by
     default while the server scheduler is the primary path.
  2. `post-drop.ts` gains `--max-per-day` guard using `GITHUB_RUN_ATTEMPT`-independent state is impossible
     in Actions; therefore it must refuse to run when `--slot auto` resolves to a slot already posted per
     the `SCHEDULE_TIMES` window unless `--force` is passed (window check only; document the limitation).
  3. README rewritten to one consistent description of both scheduling paths and which is recommended.
* **Verify** `act`-free: `yq '.on.schedule[0].cron' .github/workflows/chromabot-scheduler.yml`; `npx tsx scripts/post-drop.ts --dry-run` still exits 0.

#### REL-2 · Server-side Firestore persistence (single source of truth), remove client-side sync
* **Priority** P0 · **Size** L · **Deps** ARCH-3, SEC-2, REL-3
* **Files** `server/store/FirestoreStore.ts` (new), `server/store/Store.ts`, `server/index.ts`, `server/config.ts`, `src/App.tsx` (init sync `:187-245`, all `saveFirestore*`/`recordFirestoreLog` calls), `src/lib/firestoreSync.ts` (delete or reduce), `firestore.rules`, `firebase-blueprint.json`, `README.md`
* **Problem** Server state lives in an ephemeral file; the browser mirrors *some* of it to Firestore and
  writes it back on every page load (B4, B5). Scheduled posts never reach Firestore; cleared logs
  resurrect; stale cloud contexts overwrite live chain anchors.
* **Acceptance**
  1. `FirestoreStore` implements `Store` with `firebase-admin` (collections `settings/global`, `contexts/{id}`,
     `postLogs/{id}`, `queue/{contextId}`, `runtime/state` for cooldown/telemetry). Selected by
     `STORE=firestore|file` (default `file` locally, `firestore` when `FIREBASE_PROJECT_ID` is set).
  2. The browser no longer reads or writes Firestore directly; all `firestoreSync` calls removed from
     `App.tsx`; `firestore.rules` tightened to deny client writes (`allow write: if false`) while keeping
     admin read for debugging.
  3. Migration note: on first boot with `STORE=firestore` and an existing `data/bot-store.json`, import it once.
  4. API tests run against the in-memory store; a `FirestoreStore` contract test runs only when
     `FIRESTORE_EMULATOR_HOST` is set (document `firebase emulators:start`).
* **Verify** `npm test`; restart the server twice → contexts/logs persist; open dashboard → no PUT storm on load.

#### REL-3 · File store: atomic + debounced writes, no writes on GET, bounded memory
* **Priority** P1 · **Size** S · **Deps** ARCH-3
* **Files** `server/store/JsonFileStore.ts`, `server/services/queueService.ts` (`getQueue` no longer syncs/saves), `server/services/logService.ts`
* **Problem** `writeFileSync` on every mutation (`server/storage.ts:364`), also from `getQueue()`
  (`:1156-1160`) on every 8 s poll; not atomic; `load()` failure silently resets to defaults (`:339-341`);
  in-memory `logs` unbounded (`:351` caps only what is saved).
* **Acceptance**
  1. Write to `bot-store.json.tmp` then `rename`; keep `bot-store.json.bak` of the previous good version.
  2. Saves debounced (≤ 1 write / 250 ms) with a synchronous flush on `SIGTERM`/`SIGINT`.
  3. Corrupt file → log error, load `.bak`; if that fails, refuse to boot unless `ALLOW_FRESH_STORE=true`.
  4. `getQueue` is read-only; queue top-up happens in `queueService.ensureQueue()` called by the scheduler tick and mutations.
  5. In-memory logs capped at `MAX_LOGS` (default 500) with oldest trimmed.
* **Verify** unit tests for atomic write/backup recovery; `strace`-free check: `GET /api/queue` twice → file mtime unchanged.

#### REL-4 · Network timeouts for X and Gemini calls
* **Priority** P1 · **Size** S · **Deps** none
* **Files** `server/twitterClient.ts` (every `fetch`), `server/templateAgent.ts:138-171`
* **Problem** No `AbortController`; a hung X call blocks `executeDrop` forever and (until REL-5) freezes the
  scheduler. `Promise.race` in `templateAgent.ts:140-152` rejects after 15 s but never aborts the SDK request.
* **Acceptance**
  1. `X_TIMEOUT_MS` (default 15 000) and `GEMINI_TIMEOUT_MS` (default 12 000) from env; all fetches use
     `AbortSignal.timeout(...)`; Gemini call passes `abortSignal` via `httpOptions`/request config.
  2. Timeout surfaces as `{ success:false, error:'X API timeout after 15000 ms', isTimeout:true }`.
  3. Unit test with a stubbed `fetch` that never resolves.
* **Verify** `npm test`.

#### REL-5 · Scheduler hardening: watchdog, per-post anti-burst, no immediate fire on create, circuit breaker
* **Priority** P1 · **Size** M · **Deps** ARCH-3, ARCH-7, BUG-1
* **Files** `server/services/schedulerService.ts`, `server/services/dropService.ts`, `server/services/contextService.ts`, `src/features/campaigns/ContextCard.tsx` (show "auto-paused" badge), `shared/types.ts`
* **Problem** (a) `isProcessing` never resets if a tick throws outside the try (`scheduler.ts:197-234`);
  (b) the 60 s anti-burst check runs once per tick, then all due contexts post back-to-back (`:217-229`);
  (c) `createContext` sets `lastPostedTimestamp: 0` (`storage.ts:528`) so an enabled interval context fires
  within 10 s; (d) `consecutiveErrors` grows forever with no action (`storage.ts:766`).
* **Acceptance**
  1. Tick wrapped with a deadline (`SCHEDULER_TICK_TIMEOUT_MS`, default 120 000); if exceeded, log and reset `isProcessing`.
  2. Anti-burst evaluated before **each** `executeDrop` inside the loop; remaining due contexts wait for the next tick.
  3. New/duplicated/re-enabled contexts start their interval from `now` (`lastPostedTimestamp = Date.now()`), never 0.
  4. After `MAX_CONSECUTIVE_ERRORS` (default 5) or any 401/402, the context is set `enabled=false` with
     `autoPausedReason`; UI shows it and offers "Resume". Errors 429/403-cooldown do not count.
  5. Unit tests with fake timers for (2)–(4).
* **Verify** `npm test`; create a live enabled context → no post within the first interval.

### Epic BUG — Correctness

#### BUG-1 · Time handling: timezone/DST-aware slots, fixed-time matching, jitter in fixed mode
* **Priority** P1 · **Size** M · **Deps** none (lands before ARCH-7 rewrites `executeDrop`)
* **Files** `server/scheduler.ts:52-58, 261-294, 356-425`, `scripts/post-drop.ts:40-45`, `shared/time.ts` (new)
* **Problem** B2 and B3: hard-coded UTC−7 (`scheduler.ts:54`, `post-drop.ts:43`); exact-string match
  `t === timeInZone` so `6:00` never fires (`:280`); `isMorning = startsWith('06')` (`:283`); jitter computed
  for fixed mode (`storage.ts:738-740`) but never applied; firing calls `updateContext` (`:285`) which
  regenerates the queue.
* **Acceptance**
  1. `shared/time.ts`: `normalizeHHmm('6:00') === '06:00'`, `hourInZone(date, tz)`, `slotTypeForHour(h)`.
  2. Slot type derived from the hour in the **context's** timezone (fallback `America/Denver`; `MST` mapped
     to `America/Denver`). `post-drop.ts` uses `SCHEDULE_TIMEZONE` env the same way.
  3. Fixed-time matching normalises both sides; a slot fires once per `date+HH:mm` key; jitter delays the
     fire by `currentJitterMs` (tracked as `pendingFireAt`), and only `lastPostedSlot` is persisted (no queue regen).
  4. Unit tests with fake timers across a DST boundary (2026-03-08 / 2026-11-01 America/Denver).
* **Verify** `npm test`; set fixed times `6:00, 18:00` → fires at 06:00 local.

#### BUG-2 · Firestore log clearing and mirroring (interim fix until REL-2)
* **Priority** P1 · **Size** S · **Deps** ARCH-4
* **Files** `src/lib/firestoreSync.ts`, `src/hooks/useHistory.ts`, `src/App.tsx` handlers (`handleClearHistory`, `handleClearContextHistory`)
* **Problem** B5: clearing logs locally leaves Firestore copies which reappear on the next poll
  (`App.tsx:153-162`).
* **Acceptance**
  1. `clearFirestoreLogs(contextId?)` deletes matching `postLogs` docs (batched, 500/batch) and is awaited
     before refetching.
  2. History merge de-duplicates by `log.id` and by `tweetId` for non-simulated posts.
  3. Superseded by REL-2; keep the change minimal.
* **Verify** clear history → wait 10 s → still empty.

#### BUG-3 · Preview-what-you-post, consume queue slots on send, stop Gemini on `/api/generate-color`
* **Priority** P1 · **Size** M · **Deps** ARCH-7, ARCH-4
* **Files** `server/routes/drops.ts`, `server/routes/queue.ts`, `server/services/dropService.ts`, `server/services/queueService.ts`, `src/features/studio/LiveStudio.tsx`, `src/features/queue/QueueViewer.tsx`, `src/hooks/useQueue.ts`, `src/App.tsx` (`handlePostNow`)
* **Problem** B10.
* **Acceptance**
  1. `POST /api/post-now` accepts `{ contextId, slotId?, color?, text?, slotType }`; when `text` is given it
     is posted verbatim (after the length guard from BUG-7) and no template resolution happens; when `slotId`
     is given the slot is removed from the queue on success/simulation.
  2. Studio posts the exact previewed `tweetText`; Queue "Send" passes `slotId`.
  3. `POST /api/generate-color` returns only `{ color }` and never calls Gemini; preview text comes solely from `/api/template/preview`.
  4. API tests: slot consumed; `text` posted verbatim.
* **Verify** with an `<agent>` template, the posted log `tweetText` equals the preview shown.

#### BUG-4 · Settings form: resync on active-campaign change, never send stale chain anchor
* **Priority** P1 · **Size** S · **Deps** ARCH-4
* **Files** `src/features/settings/SettingsPanel.tsx` (formerly `src/components/SettingsPanel.tsx:39-51, 93-107`)
* **Problem** B11.
* **Acceptance**
  1. Panel is keyed by `settings.activeContextId` (remount) or resyncs via `useEffect`.
  2. Submit sends only fields the user changed (diff against initial), never `lastPostedTweetId` unless
     "Reset to Root" was clicked (then `lastPostedTweetId: null` explicitly).
  3. `intervalMode` default matches the server (`'interval'`).
* **Verify** switch campaign on Timing tab → form shows new campaign; save template only → `lastPostedTweetId` unchanged in `/api/contexts`.

#### BUG-5 · Chain auto-recovery only on "anchor gone" errors, without queue regeneration
* **Priority** P1 · **Size** S · **Deps** ARCH-7
* **Files** `server/services/dropService.ts` (formerly `server/scheduler.ts:99-137`), `server/integrations/x/errors.ts`
* **Problem** B12: any non-throttle failure (401, network, timeout, 402 unless the substring matches) resets
  the anchor and re-posts at root.
* **Acceptance**
  1. `classifyXError(status, body)` → `'rate_limit' | 'cooldown' | 'auth' | 'payment' | 'target_missing' | 'text_invalid' | 'network' | 'unknown'`.
  2. Recovery runs only for `target_missing` (404, or 403 with `detail` mentioning the referenced tweet not
     existing/deleted). Everything else preserves the anchor.
  3. Recovery updates the anchor only; no `clearAndRegenerateQueue`.
  4. Unit tests per class.
* **Verify** `npm test`.

#### BUG-6 · Real global Dry-Run and Pause switches
* **Priority** P2 · **Size** S · **Deps** ARCH-3, ARCH-7, ARCH-4
* **Files** `shared/types.ts` (`BotSettings.globalDryRun`, `globalPaused`), `server/services/settingsService.ts`, `server/services/dropService.ts`, `server/services/schedulerService.ts`, `src/components/Header.tsx:180-192`, `src/components/StatusBar.tsx:173-178`, `src/App.tsx:447-498`
* **Problem** B14.
* **Acceptance**
  1. `globalDryRun` forces simulation for every path (scheduler, manual, webhook, CLI); `globalPaused`
     stops the scheduler for all contexts. Both default to `true` on a fresh store (safe default; document).
  2. Header pill and StatusBar Pause/Resume operate on the global flags; campaign cards keep per-campaign toggles with a tooltip.
  3. Manual live post requires a `ConfirmDialog` naming the campaign and target when not in dry-run.
* **Verify** with global dry-run on and a live campaign, trigger → log `simulated`.

#### BUG-7 · Gemini/template hardening: length guard, safe replace, missing key, clean history, configurable models
* **Priority** P2 · **Size** M · **Deps** ARCH-1
* **Files** `server/templateAgent.ts` (→ `server/integrations/gemini/poetryAgent.ts`), `shared/template/agentTags.ts`, `server/services/dropService.ts` (length check), `server/config.ts`, `.env.example`, `README.md`
* **Problem** B16; also `GEMINI_MODELS` hard-coded (`templateAgent.ts:136`) and the `aistudio-build` UA (`:18`).
* **Acceptance**
  1. `weightedTweetLength(text)` (URLs = 23, most emoji/astral = 2) in `shared/`; drops > 280 are rejected
     server-side with `text_invalid`, and Gemini output > 240 is regenerated once then truncated at a word boundary.
  2. Replace uses a function replacer (`() => generated`) — regression test with `$&` in output.
  3. If `GEMINI_API_KEY` is unset, `<agent>` resolves immediately to the deterministic fallback and the API
     response carries `agentUnavailable: true` (UI badge).
  4. History = last N `success` logs of the **same** context only; no cross-context fallback.
  5. `GEMINI_MODELS` env (comma list) with the current list as default; UA `x-chromabot/<version>`.
* **Verify** `npm test`; with no key, `/api/template/preview` responds in < 200 ms.

#### BUG-8 · Consistent labels and defaults (`{time_tag}`, slot labels, timezone text, default target ID)
* **Priority** P2 · **Size** S · **Deps** BUG-1, ARCH-1, ARCH-5
* **Files** `server/services/dropService.ts`, `server/routes/drops.ts`, `shared/template/substitute.ts`, `src/features/history/HistoryTable.tsx:113-119`, `src/features/queue/QueueViewer.tsx:194`, `src/features/campaigns/ContextCard.tsx` (former `ContextsManager.tsx:362, 430`), `src/components/TargetTweetEditor.tsx:49, 259-267`, `server/config.ts`, `src/App.tsx:46`, `.env.example:22`
* **Problem** B17.
* **Acceptance**
  1. `{time_tag}` = actual scheduled/posted local time in the context timezone (`h:mm A`), `{time_slot}` alias kept.
  2. History/Queue show real time + timezone abbreviation; "6:00 AM Drop" strings removed.
  3. One `DEFAULT_TARGET_TWEET_ID` from env (`TARGET_TWEET_ID`) exposed via `/api/status`; the client never hard-codes an ID; "Reset to original" removed.
* **Verify** `grep -rn "2091597504928428416\|2103110008212992249" src server shared` → only `.env.example`.

#### BUG-9 · Implement (or remove) quote-tweet auto-fallback consistently
* **Priority** P2 · **Size** M · **Deps** BUG-5
* **Files** `server/services/dropService.ts`, `server/services/contextService.ts` (stop forcing `false` at former `storage.ts:242-245, 514, 582`; report the real value at `:796, 825`), `src/components/TargetTweetEditor.tsx:288, 323-329`, `src/components/RateLimitModal.tsx:282-299`, `src/features/campaigns/ContextFormModal.tsx`
* **Problem** B15.
* **Acceptance**
  1. `autoFallbackToQuote` is a real per-context boolean (default `false`), editable in the campaign form.
  2. When enabled and a reply fails with class `cooldown`/`reply_restricted` (403), one retry as a quote of
     `targetTweetId`; the log records `fallbackTriggered: true` and `engagementMode: 'quote'`.
  3. UI copy only claims fallback when it is on.
* **Verify** unit test with stubbed 403 then 201.

#### BUG-10 · Fix or remove the "Ping" export artifacts
* **Priority** P2 · **Size** S · **Deps** ARCH-2, SEC-3
* **Files** `server/routes/export.ts` (former `server.ts:438-556`), `src/features/automation/StandaloneExport.tsx:30-38`
* **Problem** B18.
* **Acceptance** Either (a) generated workflow/script call this repo's `scripts/post-drop.ts` with the
  context's real template/engagement mode, and the cURL sample uses OAuth 1.0a via the app's
  `/api/cron/trigger`; or (b) the GitHub/Node/cURL tabs are removed and only the webhook tab remains.
  Owner decision (Open question Q4); default to (b).
* **Verify** no reference to a non-existent file; `npm run build`.

#### BUG-11 · `scripts/post-drop.ts` uses the shared drop service
* **Priority** P2 · **Size** M · **Deps** ARCH-7, REL-2
* **Files** `scripts/post-drop.ts`, `server/services/dropService.ts`
* **Problem** B19.
* **Acceptance**
  1. CLI flags: `--context <id>` (default active), `--slot`, `--dry-run`, `--force`; it calls `dropService.executeDrop`
     so engagement mode, chain mode, `<agent>` templates, length guard, and logging (to the configured store)
     all behave identically to the server.
  2. Exit code 1 on error or on simulated-without-dry-run (existing behaviour kept).
* **Verify** `npx tsx scripts/post-drop.ts --dry-run` output shows the context name and mode.

### Epic ARCH — Decompose the monoliths (behaviour-preserving)

#### ARCH-1 · `shared/` package: one template substitution, one tweet-id parser, one types file
* **Priority** P1 · **Size** M · **Deps** DX-1
* **Files** `shared/types.ts`, `shared/template/substitute.ts`, `shared/template/agentTags.ts`, `shared/tweetId.ts` (all new); `server/colorEngine.ts:305-327`, `server/storage.ts:1018-1042, 811-815`, `server/templateAgent.ts:44-65`, `src/components/LiveStudio.tsx:57-81`, `src/components/ContextsManager.tsx:68-75`, `src/components/TargetTweetEditor.tsx:16-29`, `src/components/SettingsPanel.tsx:4`, `src/types.ts` (becomes `export * from '../shared/types.js'`), `tsconfig.json` paths, `vite.config.ts` alias
* **Acceptance**
  1. Exactly one implementation of variable substitution and one `extractTweetId` (regex `\d{10,25}` or
     full URL) used by server and client; `src/types.ts` re-exports `shared/types.ts`.
  2. Supported token list exported (`TEMPLATE_TOKENS`) and used by the UI chip lists.
  3. Unit tests for every token and for `extractTweetId` on IDs, URLs, junk.
  4. No behaviour change; `grep -rn "replace(/{color_pick}/g" .` → 1 file.
* **Verify** `npm run typecheck && npm test && npm run build`.

#### ARCH-2 · Split `server.ts` into `app.ts` + routes + error middleware; validate ids
* **Priority** P1 · **Size** M · **Deps** DX-1
* **Files** `server.ts` (becomes 3-line shim or deleted; update `package.json` scripts), `server/index.ts`, `server/app.ts`, `server/config.ts`, `server/middleware/error.ts`, `server/routes/*.ts` (new)
* **Acceptance**
  1. `createApp({ storage, scheduler })` returns an express app without listening; `index.ts` listens on `PORT` env (default 3000).
  2. One route file per resource; handlers are ≤ 30 lines and delegate to storage/scheduler (services come in ARCH-3).
  3. `HttpError` + error middleware; **unknown `contextId` on `/api/contexts/:id/*`, `/api/post-now`,
     `/api/contexts/:id/trigger`, webhook `contextId` → 404** (fixes B8; `scheduler.executeDrop` throws
     `HttpError(404)` instead of falling back to the active context).
  4. Every existing endpoint keeps its path, method, and response shape (document in `docs/api.md`).
* **Verify** `npm run typecheck`; curl each endpoint as before; `curl -X POST localhost:3000/api/contexts/nope/trigger` → 404.

#### ARCH-3 · Split `server/storage.ts` into services over a `Store` interface
* **Priority** P1 · **Size** L · **Deps** ARCH-2, SEC-3
* **Files** `server/storage.ts` (deleted), `server/store/Store.ts`, `server/store/JsonFileStore.ts`, `server/store/MemoryStore.ts`, `server/services/{contextService,queueService,logService,settingsService,credentialService,rateLimitService}.ts`, `server/services/index.ts` (composition), `server/routes/*.ts`, `server/scheduler.ts`, `server/templateAgent.ts:12` (uses `logService`), `scripts/post-drop.ts:5`
* **Acceptance**
  1. `Store` = `{ load(): Promise<BotState>; save(state: BotState): Promise<void> }` with a typed `BotState`.
  2. Services hold domain logic only; each ≤ 300 lines; the legacy globals (`lastPostedSlot`,
     `lastPostedTimestamp`, `currentJitterMs`, `generateRandomJitter`, former `storage.ts:977-1016`) are deleted.
  3. `updateContext` accepts only a whitelist of client-editable fields (`name, description, targetTweetId,
     replyTargetMode, engagementMode, autoFallbackToQuote, enabled, dryRun, schedule, template,
     themePreference, lastPostedTweetId`) — `stats`, `consecutiveErrors`, timestamps, `createdAt` are never
     client-writable (partial fix of B4). Input validated with `zod`; `targetTweetId` must parse → else 400.
  4. `MemoryStore` used by all tests; existing API tests still pass unchanged.
* **Verify** `npm test`; `wc -l server/services/*.ts` all < 300.

#### ARCH-4 · Frontend API client + hooks; shrink `App.tsx`
* **Priority** P1 · **Size** M · **Deps** DX-1
* **Files** `src/api/client.ts`, `src/api/endpoints.ts`, `src/hooks/*.ts` (new), `src/App.tsx`, and the components that call `fetch` directly (`LiveStudio.tsx:87`, `ContextsManager.tsx:104`, `SettingsPanel.tsx:61`, `StandaloneExport.tsx:15`)
* **Acceptance**
  1. No component calls `fetch` directly; `apiFetch` centralises JSON headers, error → `ApiError`, and (later) auth.
  2. `useBotStatus`, `useContexts`, `useQueue`, `useHistory`, `useCredentials`, `usePolling(intervalMs, enabled)`.
  3. `App.tsx` ≤ 250 lines: composition + tab switch only; handlers live in hooks.
  4. Behaviour identical (same endpoints, same 8 s polling for now).
* **Verify** `npm run build`; manual smoke of every tab.

#### ARCH-5 · Split `ContextsManager.tsx` into campaign feature components
* **Priority** P2 · **Size** M · **Deps** ARCH-1, ARCH-4
* **Files** `src/components/ContextsManager.tsx` → `src/features/campaigns/{ContextsManager,ContextCard,ContextFormModal,ScheduleEditor,EngagementModeSelector,ReplyModeSelector}.tsx`, `src/components/ui/ConfirmDialog.tsx`
* **Acceptance**
  1. Each file ≤ 200 lines; modal form state in one `useContextForm` hook.
  2. `ScheduleEditor` validates `HH:mm` with `normalizeHHmm` and timezone from a shared `TIMEZONES` list (also used by Settings).
  3. `confirm()` replaced by `ConfirmDialog`.
  4. Fix the preset typo ("whats already and been said" → "what has already been said", `ContextsManager.tsx:1127`).
* **Verify** `npm run build`; create/edit/duplicate/delete/trigger all still work.

#### ARCH-6 · Shared `TemplateEditor`; split `SettingsPanel` and `LiveStudio`
* **Priority** P2 · **Size** M · **Deps** ARCH-5, BUG-4
* **Files** `src/components/TemplateEditor.tsx` (new; presets/tokens/AI-test from `SettingsPanel.tsx:537-691` and `ContextsManager.tsx:1090-1183`), `src/features/settings/{SettingsPanel,ScheduleSettings,WebhookSettings}.tsx`, `src/features/studio/{LiveStudio,ColorCanvas,TweetPreviewCard,PostResultToast}.tsx`
* **Acceptance** files ≤ 200 lines; one preset list; AI test uses the shared hook; no behaviour change.
* **Verify** `npm run build`; presets insert identical text in both places.

#### ARCH-7 · Extract `dropService.executeDrop` from the scheduler
* **Priority** P1 · **Size** S · **Deps** ARCH-3, BUG-1
* **Files** `server/scheduler.ts` → `server/services/schedulerService.ts` (tick + next-post calc only), `server/services/dropService.ts` (former `scheduler.ts:47-191`), `server/routes/drops.ts`, `server/routes/webhook.ts`
* **Acceptance** `executeDrop(opts)` has no knowledge of timers; scheduler, routes, webhook, CLI all call it; unit test of `executeDrop` with stubbed X client covering reply/quote/standalone and dry-run.
* **Verify** `npm test`.

### Epic PORT — Portability off AI Studio

#### PORT-1 · Runtime config, Dockerfile, health endpoint, deploy docs
* **Priority** P1 · **Size** S · **Deps** ARCH-2
* **Files** `server/index.ts`, `server/config.ts`, `server/app.ts` (`GET /healthz`), `Dockerfile`, `.dockerignore`, `package.json`, `README.md`, `.env.example`
* **Problem** Port hard-coded (`server.ts:23`); `start` lacks `NODE_ENV`; no container definition.
* **Acceptance**
  1. `PORT` env honoured; `/healthz` returns `{ ok, version, store, schedulerRunning }`.
  2. Multi-stage `Dockerfile` (node:22-alpine; `npm ci`, `vite build`, run `NODE_ENV=production tsx server/index.ts`).
  3. README "Deploy" section for Cloud Run / Fly / Railway / a VPS with the full env var table, noting the
     scheduler needs a single always-on instance (`min-instances=1`, `max-instances=1`) until REL-2 lands.
* **Verify** `docker build -t chromabot . && docker run -p 3000:3000 -e AUTH_DISABLED=true chromabot` → `/healthz` 200.

#### PORT-2 · Firebase config from env, deployable rules, no hard-coded identities
* **Priority** P1 · **Size** S · **Deps** ARCH-1
* **Files** `src/lib/firebase.ts`, `firebase-applet-config.json` (keep for AI Studio, read as fallback only), `firebase.json` + `.firebaserc` (new), `firestore.rules`, `firebase-blueprint.json:102` (remove embedded rules copy), `server/twitterClient.ts:372-374`, `src/components/LiveStudio.tsx:545-561`, `src/components/TargetTweetEditor.tsx:323-329`, `metadata.json` (leave), `.env.example`, `README.md`
* **Acceptance**
  1. `VITE_FIREBASE_*` env (apiKey, authDomain, projectId, appId, firestoreDatabaseId) override the JSON.
  2. `VITE_AUTHORIZED_EMAILS` drives the UI whitelist; `firestore.rules` generated/documented from the same list.
  3. `X_HANDLE` env replaces `@bhaijahndai` in server error strings and UI copy (fallback "your account").
  4. `firebase deploy --only firestore:rules` works from the repo.
* **Verify** `grep -rn "bhaijahndai\|the.derek.leavitt" src server shared` → 0.

### Epic UX

#### UX-1 · Navigation breakpoint, error toasts, no native dialogs
* **Priority** P2 · **Size** S · **Deps** ARCH-4, ARCH-5
* **Files** `src/components/Header.tsx:132, 235`, `src/components/ui/Toast.tsx` (new), `src/hooks/useToast.ts`, `src/App.tsx`, `src/features/history/HistoryTable.tsx:55-63`
* **Acceptance** tabs visible from `lg`; every `ApiError` surfaces as a toast; History clear uses `ConfirmDialog`.
* **Verify** resize to 1280 px → tabs visible; stop the server → actions show a toast.

#### UX-2 · Polling diet
* **Priority** P2 · **Size** S · **Deps** ARCH-4, REL-3
* **Files** `src/hooks/usePolling.ts`, `src/hooks/*`, `server/routes/status.ts`
* **Acceptance** one `/api/status` poll (with `?include=queue,logs` only for the visible tab), paused when the
  tab is hidden (`document.visibilityState`), interval 10 s; `/api/status` payload < 20 KB with 14 slots.
* **Verify** DevTools network: ≤ 1 request / 10 s on the Studio tab.

---

## 5. Execution plan

Each wave contains tickets whose file sets do not overlap; run them in parallel, merge, then start the
next wave. Overlaps that remain are called out.

| Wave | Tickets | Notes on overlap |
| :-- | :-- | :-- |
| 0 (now, owner-assisted) | SEC-1 | No code conflicts; needs the owner to rotate keys and approve the history rewrite. Can proceed alongside wave 1. |
| 1 — foundation | DX-1, ARCH-2, ARCH-4, REL-1, REL-4 | DX-1 edits `tsconfig/package.json/ci.yml`; ARCH-2 edits `server.ts` + new `server/routes`; ARCH-4 edits `src/**`; REL-1 edits the scheduler workflow + `post-drop.ts`; REL-4 edits `twitterClient.ts` + `templateAgent.ts`. DX-1's unused-import fixes touch `server.ts`/components trivially — ARCH-2/ARCH-4 authors rebase on DX-1 first (merge DX-1 as soon as it is green). |
| 2 — security + shared | SEC-2, SEC-3, DX-2, ARCH-1, PORT-1 | SEC-2 and DX-2 both add deps to `package.json` (trivial merge). SEC-3 touches `storage.ts` lines 147/835/867 only. ARCH-1 touches `LiveStudio`, `ContextsManager`, `TargetTweetEditor`, `SettingsPanel` import lines — none of the others do. |
| 3 — lint (solo) | DX-3 | Runs alone because the format commit touches every file. |
| 4 — domain split + first bug fixes | ARCH-3, BUG-1, BUG-2, BUG-4, PORT-2, ARCH-5 | BUG-1 edits `scheduler.ts` schedule evaluation; ARCH-3 edits `scheduler.ts` only at its `storage` import/calls — coordinate by having BUG-1 merge first (it is S/M). BUG-2 touches `firestoreSync.ts` + hooks; BUG-4 only `SettingsPanel`; PORT-2 only firebase/config/error strings; ARCH-5 only the campaigns feature. |
| 5 — drop service | ARCH-7, REL-3, ARCH-6, SEC-4 | ARCH-7 edits `scheduler.ts` + new `dropService`; REL-3 edits `store/` + `queueService`/`logService`; ARCH-6 edits settings/studio features; SEC-4 edits `credentialService` + `x/client.ts` + `TwitterSetup`. |
| 6 — persistence + behaviour fixes | REL-2, REL-5, BUG-3, BUG-5 | REL-5 and BUG-5 both edit `dropService.ts`: BUG-5 (error classes) merges first, REL-5 rebases. BUG-3 edits routes/drops + queueService + studio/queue UI; REL-2 edits `store/`, `index.ts`, `App.tsx` init and `firestoreSync.ts` (BUG-2's earlier change is deleted here — expected). |
| 7 — polish | BUG-6, BUG-7, BUG-8, BUG-9, BUG-10, BUG-11, UX-1, UX-2 | BUG-6/BUG-9/BUG-11 all touch `dropService.ts` — run sequentially in that order or assign to one agent. BUG-7 edits `poetryAgent.ts` + `shared/template`; BUG-8 edits labels across UI + `substitute.ts` (coordinate with BUG-7 on `shared/template`: BUG-7 first). UX-1/UX-2 touch hooks/Header only. |

Critical path: DX-1 → ARCH-2 → SEC-2/SEC-3 → ARCH-3 → ARCH-7 → REL-2/REL-5. Everything P0 (SEC-1,
SEC-2, SEC-3, DX-1, DX-2, REL-1, REL-2) is done by the end of wave 6; REL-1 and SEC-1 can be
done today.

Until SEC-2 and SEC-3 are deployed, the owner should keep the AI Studio URL private and consider setting
every campaign to dry-run.

---

## 6. Open questions for the owner

1. **Q1 Scheduling home.** Should the long-running Express scheduler be the only automation path, with
   GitHub Actions removed (REL-1 disables it by default), or must Actions keep working as a fallback? If
   the app moves off AI Studio, is an always-on single instance acceptable (cost), or should scheduling
   move to an external cron hitting the webhook (then the queue/jitter logic needs to live in the trigger)?
2. **Q2 Persistence.** Keep Firebase (Firestore via `firebase-admin`, REL-2) or replace it with something
   simpler for a single-admin bot (SQLite file on a persistent volume)? REL-2 assumes Firestore because
   Auth is already Firebase.
3. **Q3 Multi-user.** Is this ever more than one admin? SEC-2/PORT-2 keep an email whitelist; a real
   roles model (`users` collection in `firebase-blueprint.json` is unused today) is out of scope unless wanted.
4. **Q4 "Ping" export tab.** Keep and fix the GitHub/Node/cURL exports (BUG-10 option a) or delete them (b)?
5. **Q5 Safe defaults.** BUG-6 proposes `globalDryRun=true` and `globalPaused=true` on a fresh store, and
   REL-5 auto-pauses a campaign after 5 consecutive errors or any 401/402. Confirm.
6. **Q6 X tier and quotas.** Which X API tier is the account on? The telemetry tier heuristics
   (`storage.ts:435-448`) and the pricing table in `RateLimitModal.tsx:310-355` are hard-coded guesses and
   may be stale; they should either be verified against current X pricing or reduced to "unknown until
   headers observed".
7. **Q7 Gemini models.** Confirm the intended model IDs (`gemini-3.8-flash`, `gemini-3.1-flash-lite`,
   `gemini-flash-latest`) and whether Gemini usage should be capped (e.g., max agent calls/day) — BUG-7
   makes them env-configurable but does not choose.
8. **Q8 Chain semantics.** In chain mode, should a *quote* or *standalone* post ever advance the chain
   anchor? Today only `reply` does (`storage.ts:782`). Also: when the target tweet ID changes, should the
   old chain's logs stay attached to the campaign?
9. **Q9 Repository visibility.** Is `derekleavitt/puja-tweet` public? If so SEC-1 is urgent regardless of
   the history rewrite (keys must be rotated first); if private, the rewrite can be scheduled.
10. **Q10 Naming.** `puja-tweet` (repo) vs `X ChromaBot` (app) vs `react-example` (package). Pick one for
    package name, Docker image, and docs.

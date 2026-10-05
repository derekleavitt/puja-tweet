# CLAUDE.md

X ChromaBot (`puja-tweet`) posts scheduled replies to X (Twitter) from several of the owner's
accounts. It covers color drops, AI poetry, and multi-account "conversation" threads. Production
state, logs and known limits are in `docs/deploy.md`; `README.md` has a docs index.

## Commands

```bash
npm ci                      # Node 22 (.nvmrc)
npm run dev                 # dashboard + API on http://localhost:3000 (tsx server.ts)
npm run typecheck           # tsc --noEmit (also type-checks tests)
npm run lint                # eslint, must have 0 errors
npm run format:check        # prettier; run `npx prettier --write <files>` before committing
npm test                    # vitest (unit + API tests)
npm run e2e                 # Playwright; first time: npx playwright install chromium
npm run build && npm run build:server
```

CI (`.github/workflows/ci.yml`) runs all of these on every PR. Run them all before pushing.

## Architecture

- **`server/`** is Express + TypeScript.
  - `routes/*`: thin HTTP layer.
  - `services/*`: domain logic.
  - `store/*`: JSON file locally, Firestore in production (`STORE=firestore`).
  - `scheduler.ts`: the tick. In production, Cloud Scheduler POSTs `/api/cron/tick` every minute
    (`SCHEDULER_MODE=external`).
- **`server/services/dropService.ts`** is the only way anything is posted. The scheduler, manual
  post, webhook and CLI all go through it.
  - Preview and post must produce the same text: the previewed `text`, `hashtags` and conversation
    turn are echoed back on post.
- **Campaigns** (`TweetContext` in `shared/types.ts`) are isolated from each other.
  - Global by design: auth, credentials, global dry-run/pause, the Gemini cap.
  - Per X account: cooldown and live spacing.
  - Read `docs/campaign-isolation.md` before touching shared state.
- **Conversation mode** has its own docs: `docs/conversations.md` and `docs/design/conversations.md`.
  - Code: `services/conversationService.ts` and `conversationTurn.ts`.
  - Turn state lives in `conversationState`, including its own transcript buffer and a summary.
- **Recovery** is described in `docs/campaign-isolation.md` §7.
  - Transient errors use exponential back-off and never pause the campaign.
  - Persistent errors trip the breaker after 5.
  - The `inFlight` marker makes posting crash-safe.
  - History lives on each campaign (`recentPosts`, `conversationState.turns`), never only in the
    shared capped log.
- **AI** is Gemini Flash-Lite (`server/geminiConfig.ts`, `templateAgent.ts` `generateAgentText`).
  When every model answers "busy", it waits once and retries.
- **X** is OAuth 1.0a per account (`server/twitterClient.ts`, `services/accountService.ts`).
  Tokens are encrypted with `CREDENTIALS_ENCRYPTION_KEY`.
- **`src/`** is React 19 + Vite + Tailwind 4 + lucide-react. Campaigns is the main screen
  (`src/features/campaigns/*`); Settings holds global switches and X accounts.
- **`shared/`** holds code used by both server and client: types, hashtags, template tokens and
  tweet length.

## Conventions

- Keep modules small: files under ~300 lines, components under ~200. Match the style and comment
  density of the code around you.
- Every behaviour change needs tests. Test X with `tests/helpers/fakeX.ts`, which checks OAuth
  signatures, and stub Gemini at the SDK level, as in `tests/unit/conversationTurn.test.ts`.
- Write user-facing docs in `docs/`. Update `docs/api.md` whenever a route or field changes.

## Hard rules

- **The repo is public.** Never commit secrets, `.env` or a `data/` directory. Secrets live in
  GCP Secret Manager (`scripts/setup-gcp-deploy.sh`).
- **Merging to `main` deploys to Cloud Run** (`.github/workflows/deploy.yml`, project
  `hitthehatch`). Work on a branch, open a PR, and merge only when CI is green.
- **Only the owner can log in** (`shared/owner.ts` `OWNER_EMAIL`, `AUTHORIZED_EMAILS`). Don't widen auth.

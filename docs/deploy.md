# Deploying X ChromaBot

X ChromaBot is a single Node process (Express API + built Vite frontend + scheduler, either an in-process
loop or driven externally through `POST /api/cron/tick`).

## Constraints (read first)

- **Never run more than one instance.** Two instances would double-post. Two supported shapes:
  - **Scale-to-zero (recommended, Cloud Run):** `SCHEDULER_MODE=external`, `STORE=firestore`,
    `--min-instances=0 --max-instances=1`. Cloud Scheduler calls `POST /api/cron/tick` every minute
    with `x-cron-secret`; no background timers run, and state is flushed before each response. The full
    keyless GitHub Actions + Cloud Scheduler walkthrough is in [gcp-setup.md](gcp-setup.md).
  - **Always-on:** default `SCHEDULER_MODE=interval` (in-process loop). Needs CPU always allocated and,
    with `STORE=json`, a persistent volume at `/app/data`.
- Posting is real. Do not set live X credentials on an environment you are only testing.

## Status: torn down (2026-10-23)

Nothing runs and there are no public endpoints. Removed from GCP project `hitthehatch` (other apps
in that project were not touched): Cloud Run `chromabot` (us-central1) and the old AI Studio service
`x-chromabot-automated-color-reply-generator` (us-west1), Cloud Scheduler `chromabot-tick`,
Artifact Registry `chromabot`, service accounts `chromabot-runtime` / `chromabot-deployer` and
their project roles, and the Workload Identity pool `github` with provider `github-actions`. The
GitHub workflow "Deploy to Cloud Run" is **disabled**, so merging to `main` deploys nothing.

Still present (data, kept on purpose): the Firestore database
`ai-studio-xchromabotautoma-f7df51c8-9507-4dbf-b83e-55995c4c0943` (campaigns, encrypted account
tokens, logs) and the Secret Manager secrets `TWITTER_API_KEY`, `TWITTER_API_SECRET`,
`TWITTER_BEARER_TOKEN`, `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_TOKEN_SECRET`, `GEMINI_API_KEY`,
`WEBHOOK_SECRET`, `CREDENTIALS_ENCRYPTION_KEY`, `CRON_SECRET` (no other app uses them). The repo
variables `GCP_*` are kept for reference.

### Rebuild and publish

1. `gcloud auth login`, then `bash scripts/setup-gcp-deploy.sh`. It recreates the APIs, Artifact
   Registry, both service accounts and roles, the Workload Identity pool + provider, and asks for any
   missing secrets (blank keeps a saved value). A deleted pool is kept for 30 days and blocks its
   name: within that time run
   `gcloud iam workload-identity-pools undelete github --location=global --project=hitthehatch`
   (and the same for the provider with `providers undelete github-actions --workload-identity-pool=github`)
   first, or the script fails on create.
2. Set the repository variables it prints (`GCP_WIF_PROVIDER`, `GCP_DEPLOY_SA`, `GCP_RUNTIME_SA`,
   `GCP_PROJECT_ID=hitthehatch`, `GCP_REGION=us-central1`) if they changed.
3. `gh workflow enable deploy.yml`, then GitHub → Actions → Deploy to Cloud Run → Run workflow. The
   summary prints the new URL.
4. `bash scripts/setup-gcp-deploy.sh --scheduler <URL>` (the minute tick), add the URL's host in
   Firebase → Authentication → Authorized domains, and register `<URL>/oauth/x/callback` in the X
   developer portal. Sign in, check the X accounts in Settings, then switch Dry Run / Pause off.

If the Firestore database or the secrets were deleted too, the setup script recreates the secrets
(generated ones get new values) and the app starts with an empty store: reconnect the X accounts and
recreate the campaigns. Full walkthrough: [gcp-setup.md](gcp-setup.md).

## Production (before the teardown)

- **App:** Google Cloud Run, project `hitthehatch`, service `chromabot` (scale-to-zero).
- **Scheduler:** Cloud Scheduler POSTs `/api/cron/tick` every minute.
- **Storage:** Firestore. **AI:** Gemini Flash-Lite only (`gemini-3.1-flash-lite`; `GEMINI_MODEL` overrides it).
- **Deploys:** every merge to `main` deploys through GitHub Actions (keyless Workload Identity
  Federation; docs-only changes are skipped). Secrets live in Secret Manager, never in the repo.
- **Quick check:** `bash scripts/prod-status.sh [30m]` prints the global switches, every campaign's
  schedule and state, and the recent scheduler log (read-only; never prints credentials). If nothing
  posts, look for `Tick skipped: Paused` first: the global Pause switch is on.
- **Logs:**

  ```bash
  gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="chromabot"' \
    --project=hitthehatch --limit=50 --freshness=2h --format='value(timestamp,textPayload)'
  ```

### Known limits and ideas for later

- **Gemini outages:** a never-ending Gemini outage, such as hitting a daily cap, keeps retrying every
  15 min instead of pausing. It shows in the status bar and logs.
- **Crash during a post:** a crash between X accepting a post and the save can post that turn twice.
- **Extra writes:** each live post makes 3 Firestore state writes. That's fine at this scale.
- **X's Free plan:** the 17 posts/day limit is per app, so extra accounts don't add capacity.
  Basic is about 100 per day per account.
- **Not built yet:** a "Generate personas" helper, hashtags every Nth conversation turn, and an AI
  that picks the next speaker.

## Local development

    npm ci && npx playwright install chromium
    npm run dev          # dashboard + API with Vite HMR on http://localhost:3000
    npm test && npm run e2e

`npm run dev` reads `.env` (gitignored; full list in `.env.example`). A dev setup only needs:

    STORE="json"                  # state in ./data/bot-store.json; delete it to reset
    AUTH_DISABLED="true"          # skip the Firebase token check on /api
    VITE_AUTH_DISABLED="true"     # skip the login screen (dev server only; inert in builds)
    SCHEDULER_MODE="interval"     # in-process 10 s loop
    CREDENTIALS_ENCRYPTION_KEY="" # `openssl rand -hex 32`, needed to save X keys/accounts from the UI

Leave `NODE_ENV` unset. Unit tests never read `.env`, and e2e passes its own env. A fresh store starts in
global dry-run and pause. With real X keys in `.env`, turning those off posts **live** from your machine,
alongside production.

To run the production build locally instead:

    npm run build
    npm start            # NODE_ENV=production, serves dist/ on $PORT (default 3000)

## Docker

    docker build -t chromabot .
    docker run -p 3000:3000 --env-file .env -v chromabot-data:/app/data chromabot
    curl http://localhost:3000/api/health

`GET /api/health` is unauthenticated and returns
`{ success, ok, version, store, schedulerRunning, uptimeSeconds }`.

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `PORT` | no (3000) | HTTP port; injected by Cloud Run / Railway / Fly |
| `NODE_ENV` | no | `production` serves `dist/`; set by the Dockerfile and `npm start` |
| `APP_VERSION` | no | Overrides the version shown by `/api/health` |
| `GEMINI_API_KEY` | for AI templates | Gemini API key |
| `GEMINI_TIMEOUT_MS`, `X_TIMEOUT_MS` | no | Upstream request timeouts |
| `TWITTER_API_KEY`, `TWITTER_API_SECRET` | to connect accounts | The X app's consumer key/secret (accounts are connected in Settings and keep their own tokens) |
| `TWITTER_BEARER_TOKEN` | no | App-only token, used to read X trends (`X_TRENDS_WOEID`) |
| `TARGET_TWEET_ID` | no | Default target tweet |
| `SCHEDULE_TIMES`, `SCHEDULE_TIMEZONE` | no | Default posting schedule |
| `APP_URL` | no | Public URL of the deployment |
| `SCHEDULER_MODE` | no (`interval`) | `external` for scale-to-zero; see docs/api.md "Serverless mode" |
| `CRON_SECRET` | with `external` | Secret for `POST /api/cron/tick` |
| `MAX_DROPS_PER_TICK` | no (5) | Drops per tick |

See `.env.example` for the full list. Set secrets through the platform's secret manager, not the image.

## Platforms

- **Cloud Run (scale-to-zero):** see [gcp-setup.md](gcp-setup.md) (`--min-instances=0 --max-instances=1
  --cpu-throttling`, `SCHEDULER_MODE=external`, Cloud Scheduler job `chromabot-tick`). Always-on variant:
  `--min-instances=1 --max-instances=1 --no-cpu-throttling` with the default interval scheduler.
  Health path: `/api/health`.
- **Fly.io:** `fly launch`, internal port 3000, `min_machines_running = 1`, `auto_stop_machines = false`,
  one machine only; add a volume mounted at `/app/data`.
- **Railway:** deploy from the Dockerfile, 1 replica, attach a volume at `/app/data`, health check `/api/health`.
- **VPS:** run the Docker command above with `--restart always` (or systemd), behind a TLS reverse proxy.

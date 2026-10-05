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

## Production today

- **App:** Google Cloud Run, project `hitthehatch`, service `chromabot` (scale-to-zero).
- **Scheduler:** Cloud Scheduler POSTs `/api/cron/tick` every minute.
- **Storage:** Firestore. **AI:** Gemini Flash-Lite only (`gemini-3.1-flash-lite`; `GEMINI_MODEL` overrides it).
- **Deploys:** every merge to `main` deploys through GitHub Actions (keyless Workload Identity
  Federation; docs-only changes are skipped). Secrets live in Secret Manager, never in the repo.
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
| `TWITTER_API_KEY`, `TWITTER_API_SECRET`, `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_TOKEN_SECRET` | for live posting | OAuth 1.0a user credentials |
| `TWITTER_BEARER_TOKEN`, `TWITTER_OAUTH2_*` | no | OAuth 2.0 alternatives |
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

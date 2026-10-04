# Deploying X ChromaBot

X ChromaBot is a single Node process (Express API + built Vite frontend + in-process scheduler).

## Constraints (read first)

- **Run exactly one instance, always on.** The scheduler runs inside the server and state is stored in
  `data/bot-store.json` on local disk. Two instances would double-post, and a scale-to-zero platform
  would miss scheduled drops. Persistence moves to Firestore in a later ticket; until then, mount a
  persistent volume at `/app/data` or accept that state resets on redeploy.
- Posting is real. Do not set live X credentials on an environment you are only testing.

## Run locally

    npm ci
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

See `.env.example` for the full list. Set secrets through the platform's secret manager, not the image.

## Platforms

- **Cloud Run:** `gcloud run deploy chromabot --source . --min-instances=1 --max-instances=1 --no-cpu-throttling`
  (CPU must stay allocated so the scheduler ticks between requests). Health path: `/api/health`.
- **Fly.io:** `fly launch`, internal port 3000, `min_machines_running = 1`, `auto_stop_machines = false`,
  one machine only; add a volume mounted at `/app/data`.
- **Railway:** deploy from the Dockerfile, 1 replica, attach a volume at `/app/data`, health check `/api/health`.
- **VPS:** run the Docker command above with `--restart always` (or systemd), behind a TLS reverse proxy.

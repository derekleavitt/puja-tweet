# Google Cloud setup (X ChromaBot)

X ChromaBot runs on Cloud Run in project `hitthehatch` (`us-central1`), deployed by GitHub Actions
with **no service-account keys** (Workload Identity Federation). Cloud Scheduler calls the server once
a minute, so the service scales to zero between ticks.

**Who can log in:** only `the.derek.leavitt@gmail.com`, enforced by the login screen
(`src/lib/firebase.ts`) and the server (`AUTHORIZED_EMAILS`, checked on every `/api/*` call). Both
default to `OWNER_EMAIL` in `shared/owner.ts`; update the email in `firestore.rules` to match.

## Cost notes

- Cloud Run: `min-instances=0`, `max-instances=1`, request-based billing (CPU throttled outside
  requests), so you pay only while handling requests. A tick every minute keeps usage small.
- Cloud Scheduler: a small number of jobs per billing account is free; this uses one.
- Firestore, Cloud Run, Secret Manager and Artifact Registry have free tiers; an Artifact Registry
  cleanup policy keeps only the last 5 images.
- Verify all of the above in the Google Cloud pricing calculator; limits and prices change.
- At hundreds of posts per day, the **X API plan limits and fees are likely to dominate cost**, not
  Google Cloud. Check your X developer plan.

## 1. One-time bootstrap (on your Mac)

```bash
gcloud auth login                  # as the.derek.leavitt@gmail.com
bash scripts/setup-gcp-deploy.sh
```

It is idempotent. It enables the APIs, creates the Artifact Registry repo (with cleanup policy), the
runtime service account `chromabot-runtime` and the deploy service account `chromabot-deployer`, a
Workload Identity Pool and GitHub OIDC provider, and the secrets (it prompts, hidden, for the X and
Gemini values; `WEBHOOK_SECRET`, `CREDENTIALS_ENCRYPTION_KEY` and `CRON_SECRET` are generated with
`openssl rand`). It never creates a key file.

IAM granted:

| Principal | Role | Scope |
| --- | --- | --- |
| `chromabot-runtime` | `roles/datastore.user` | project |
| `chromabot-runtime` | `roles/secretmanager.secretAccessor` | each of the 9 secrets only |
| `chromabot-deployer` | `roles/run.admin` | project |
| `chromabot-deployer` | `roles/artifactregistry.writer` | repo `chromabot` only |
| `chromabot-deployer` | `roles/iam.serviceAccountUser` | `chromabot-runtime` only |
| GitHub principal set (`attribute.repository/derekleavitt/puja-tweet`) | `roles/iam.workloadIdentityUser` | `chromabot-deployer` |

The OIDC provider only accepts tokens where
`assertion.repository=='derekleavitt/puja-tweet' && assertion.ref=='refs/heads/main'`, so forks, pull
requests and other branches cannot deploy (this repo is public).

## 2. Set GitHub repository variables

The script prints exact `gh variable set` commands for `GCP_PROJECT_ID`, `GCP_REGION`,
`GCP_WIF_PROVIDER`, `GCP_DEPLOY_SA`, `GCP_RUNTIME_SA`. These are variables, not secrets; none is
sensitive. Until `GCP_WIF_PROVIDER` is set, the Deploy workflow does nothing (and stays green).

## 3. First deploy

Push to `main` or run **Actions, Deploy to Cloud Run, Run workflow**. The workflow re-runs typecheck,
lint and tests, builds the image, pushes it tagged with the commit SHA, deploys, then checks
`/api/health` and that `/api/status` returns 401 when unauthenticated. The URL is in the job summary.

**Safe start:** campaigns arrive paused/dry-run (see legacy import). Keep the global dry-run or pause
switch on until a dry-run drop looks right in the history tab.

## 4. Firebase authorized domain (manual)

Firebase only allows sign-in popups from listed domains. Open
<https://console.firebase.google.com/project/hitthehatch/authentication/settings>, **Authorized
domains, Add domain**, and add the host of the service URL (e.g. `chromabot-abc123-uc.a.run.app`).
Confirm **Sign-in method, Google** is enabled.

## 5. Create the scheduler job

```bash
bash scripts/setup-gcp-deploy.sh --scheduler https://YOUR-SERVICE-URL
```

Creates or updates `chromabot-tick`: every minute, `POST /api/cron/tick` with header `x-cron-secret`
(read locally from Secret Manager, never printed), 60 s attempt deadline, no retries (the next minute
retries naturally). Pause it with `gcloud scheduler jobs pause chromabot-tick --location=us-central1`.

## Import your existing campaigns (one time)

The AI Studio version kept your campaigns, post history and settings in the Firestore collections
`contexts`, `postLogs` and `settings/global_settings` of the named database
`ai-studio-xchromabotautoma-f7df51c8-9507-4dbf-b83e-55995c4c0943` (see `firebase-applet-config.json`).
This copies them into the new state (`chromabot/state`). Run it from your Mac with Application Default
Credentials:

```bash
gcloud auth application-default login      # once
npm ci
npm run import:legacy                      # preview only: prints found / new / skipped and warnings
npm run import:legacy -- --apply           # write
```

- Safe to run twice: an id that already exists is skipped, never overwritten.
- Every imported campaign arrives **paused and in dry-run**, whatever its old state; turn each one on
  yourself once a dry-run drop looks right. Credentials and webhook secrets are never imported (they
  come from Secret Manager). Master switches in settings are left untouched.
- `--from-json export.json` reads a manual export (`{ "contexts": [...], "postLogs": [...],
  "settings": {...} }`) instead of Firestore.

The server loads state at startup and keeps it in memory, so a running instance will not see the
import (and its next save could overwrite it). Best: import **before the first deploy**. If the service
is already running, restart it right after `--apply`:

```bash
gcloud run services update chromabot --region us-central1 --update-env-vars=IMPORT_STAMP=$(date +%s)
```

Then check the dashboard; if something is missing, re-run the import.

## Rotating secrets

```bash
bash scripts/setup-gcp-deploy.sh --rotate TWITTER_API_KEY    # prompts (hidden); generated ones are regenerated
gcloud run services update chromabot --region us-central1 --update-secrets=TWITTER_API_KEY=TWITTER_API_KEY:latest
```

After rotating `CRON_SECRET`, re-run `--scheduler URL`. Rotating `CREDENTIALS_ENCRYPTION_KEY` makes
keys previously saved through the UI unreadable.

## Rollback

```bash
gcloud run revisions list --service chromabot --region us-central1
gcloud run services update-traffic chromabot --region us-central1 --to-revisions=REVISION=100
```

The next push to `main` deploys a new revision and routes all traffic to it again.

## Logs

```bash
gcloud run services logs read chromabot --region us-central1 --limit=100
```

## Firestore rules and optional config

```bash
npx firebase-tools deploy --only firestore:rules --project hitthehatch
```

`firebase.json` targets the named AI Studio database. The rules hard-code the owner email; keep it in
sync with `shared/owner.ts`. Override the database with `FIRESTORE_DATABASE_ID`. Optional env vars:
`GEMINI_MODEL`, `GEMINI_FALLBACK_MODEL`, `GEMINI_MAX_CALLS_PER_DAY`, `GEMINI_TIMEOUT_MS`, `X_HANDLE`,
and build-time `VITE_FIREBASE_*` (baked into the bundle). See `.env.example`.

## Turning off the AI Studio deployment

Once the Cloud Run URL works, stop or unpublish the AI Studio app so two deployments never both post.

## Appendix: manual deploy (no GitHub Actions)

After running the bootstrap script, you can deploy from your machine:

```bash
gcloud run deploy chromabot --source . --region us-central1 \
  --service-account=chromabot-runtime@hitthehatch.iam.gserviceaccount.com \
  --min-instances=0 --max-instances=1 --concurrency=20 --cpu-throttling --allow-unauthenticated \
  --set-env-vars="STORE=firestore,SCHEDULER_MODE=external,SCHEDULER_TICK_TIMEOUT_MS=50000,FIREBASE_PROJECT_ID=hitthehatch,AUTHORIZED_EMAILS=the.derek.leavitt@gmail.com,SCHEDULE_TIMEZONE=America/Denver,TARGET_TWEET_ID=2103110008212992249,NODE_ENV=production" \
  --set-secrets="TWITTER_API_KEY=TWITTER_API_KEY:latest,TWITTER_API_SECRET=TWITTER_API_SECRET:latest,TWITTER_ACCESS_TOKEN=TWITTER_ACCESS_TOKEN:latest,TWITTER_ACCESS_TOKEN_SECRET=TWITTER_ACCESS_TOKEN_SECRET:latest,TWITTER_BEARER_TOKEN=TWITTER_BEARER_TOKEN:latest,GEMINI_API_KEY=GEMINI_API_KEY:latest,WEBHOOK_SECRET=WEBHOOK_SECRET:latest,CREDENTIALS_ENCRYPTION_KEY=CREDENTIALS_ENCRYPTION_KEY:latest,CRON_SECRET=CRON_SECRET:latest"
```

`--source .` also needs `roles/cloudbuild.builds.editor`-style access and the Cloud Build API; the
GitHub workflow avoids it by building with Docker directly.

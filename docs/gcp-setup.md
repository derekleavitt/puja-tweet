# Google Cloud setup (X ChromaBot)

One-time setup to run X ChromaBot on your own Google Cloud project instead of AI Studio. Run it on
your own machine (or a local Claude Code session) where `gcloud` is installed and signed in as the
owner. Nothing here needs a downloaded service-account key.

**Who can log in:** only `the.derek.leavitt@gmail.com`. That is enforced twice: the login screen
(`src/lib/firebase.ts`) and the server (`AUTHORIZED_EMAILS`, checked on every `/api/*` call). Both
default to `OWNER_EMAIL` in `shared/owner.ts`; override with `VITE_AUTHORIZED_EMAILS` (client, build
time) and `AUTHORIZED_EMAILS` (server), and update the email in `firestore.rules` to match.

## 0. Prerequisites

```bash
gcloud --version                 # install: https://cloud.google.com/sdk/docs/install
gcloud auth login                # sign in as the.derek.leavitt@gmail.com
gcloud config set project hitthehatch
gcloud config set run/region us-central1   # pick your region once and keep it

export PROJECT_ID=hitthehatch
export REGION=us-central1
export SA=chromabot-runtime@${PROJECT_ID}.iam.gserviceaccount.com
```

`hitthehatch` is the Firebase project in `firebase-applet-config.json`. Check that billing is on:
`gcloud billing projects describe $PROJECT_ID` (`billingEnabled: true`).

## 1. Enable APIs

```bash
gcloud services enable \
  run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com firestore.googleapis.com \
  identitytoolkit.googleapis.com iam.googleapis.com
```

## 2. Runtime service account (no key file)

The server runs as this account. On Cloud Run, `firebase-admin` picks it up automatically through
Application Default Credentials, so `FIREBASE_SERVICE_ACCOUNT_JSON` stays empty.

```bash
gcloud iam service-accounts create chromabot-runtime --display-name="X ChromaBot runtime"

# Firestore read/write (used once persistence moves to Firestore, REL-2)
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$SA" --role="roles/datastore.user"
```

Verifying login ID tokens only needs `FIREBASE_PROJECT_ID`; it needs no extra role.

## 3. Secrets (Secret Manager)

Each command prompts for the value so it never lands in your shell history. Copy values from the
X developer portal / Google AI Studio, never from chat logs or screenshots.

```bash
add_secret () {  # usage: add_secret NAME
  read -rsp "Value for $1: " v; echo
  printf '%s' "$v" | gcloud secrets create "$1" --data-file=- 2>/dev/null \
    || printf '%s' "$v" | gcloud secrets versions add "$1" --data-file=-
  gcloud secrets add-iam-policy-binding "$1" \
    --member="serviceAccount:$SA" --role="roles/secretmanager.secretAccessor" >/dev/null
  unset v
}

add_secret TWITTER_API_KEY            # "Consumer Key"
add_secret TWITTER_API_SECRET         # "Consumer Key Secret"
add_secret TWITTER_ACCESS_TOKEN       # "Access Token"
add_secret TWITTER_ACCESS_TOKEN_SECRET
add_secret TWITTER_BEARER_TOKEN
add_secret GEMINI_API_KEY
add_secret WEBHOOK_SECRET             # any long random string, e.g. output of: openssl rand -hex 32
add_secret CREDENTIALS_ENCRYPTION_KEY # 32 bytes as hex: openssl rand -hex 32 (encrypts keys saved via the UI)
```

OAuth 2.0 values (`TWITTER_OAUTH2_CLIENT_ID`, `TWITTER_OAUTH2_CLIENT_SECRET`,
`TWITTER_OAUTH2_REFRESH_TOKEN`) are optional; add them the same way only if you use OAuth 2.0.
Environment values always take precedence and are never overwritten or returned by the API.
`CREDENTIALS_ENCRYPTION_KEY` is needed to enter keys in the UI, and to keep rotated OAuth 2.0
tokens across restarts (they are saved encrypted); without it the UI refuses to save keys.

## 4. Deploy to Cloud Run

Exactly one always-on instance: the scheduler runs inside the server, so two instances would
double-post and scale-to-zero would miss scheduled drops.

```bash
gcloud run deploy chromabot \
  --source . \
  --service-account="$SA" \
  --min-instances=1 --max-instances=1 --no-cpu-throttling \
  --allow-unauthenticated \
  --set-env-vars="FIREBASE_PROJECT_ID=${PROJECT_ID},AUTHORIZED_EMAILS=the.derek.leavitt@gmail.com,SCHEDULE_TIMEZONE=America/Denver" \
  --set-secrets="CREDENTIALS_ENCRYPTION_KEY=CREDENTIALS_ENCRYPTION_KEY:latest,TWITTER_API_KEY=TWITTER_API_KEY:latest,TWITTER_API_SECRET=TWITTER_API_SECRET:latest,TWITTER_ACCESS_TOKEN=TWITTER_ACCESS_TOKEN:latest,TWITTER_ACCESS_TOKEN_SECRET=TWITTER_ACCESS_TOKEN_SECRET:latest,TWITTER_BEARER_TOKEN=TWITTER_BEARER_TOKEN:latest,GEMINI_API_KEY=GEMINI_API_KEY:latest,WEBHOOK_SECRET=WEBHOOK_SECRET:latest"
```

`--allow-unauthenticated` only opens the web page; every `/api/*` call still requires a Firebase
login as the allowed email (except `/api/health` and the secret-protected webhook).

Get the URL:

```bash
export APP_URL=$(gcloud run services describe chromabot --format='value(status.url)')
echo $APP_URL
gcloud run services update chromabot --update-env-vars="APP_URL=${APP_URL}"
```

## 5. Allow Google sign-in from the new URL

Firebase only allows sign-in popups from listed domains. In the Firebase console:
**Authentication → Settings → Authorized domains → Add domain**, and add the host part of
`$APP_URL` (e.g. `chromabot-abc123-uc.a.run.app`). Also confirm **Sign-in method → Google** is enabled.

## 6. Verify

```bash
curl -s $APP_URL/api/health                     # {"success":true,"ok":true,...}
curl -s -o /dev/null -w '%{http_code}\n' $APP_URL/api/status   # 401 (no login) — expected
```

Then open `$APP_URL`, sign in as the.derek.leavitt@gmail.com: the dashboard loads. Any other Google
account sees the "not authorized" screen and gets 403 from the API.

**Safe start:** keep every campaign in dry-run until a dry-run drop looks right in the history tab.

## 6b. Deploy Firestore rules and optional config

```bash
npx firebase-tools deploy --only firestore:rules   # uses firebase.json + .firebaserc (project hitthehatch)
```

`firebase.json` targets the named AI Studio database. The rules hard-code the owner email (rules cannot
read env vars); keep it in sync with `shared/owner.ts`.

Optional env vars: `X_HANDLE` (server; names your X account in error messages, blank = "your account")
and build-time `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`,
`VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_FIRESTORE_DATABASE_ID`, which override
`firebase-applet-config.json` (the fallback). `VITE_*` values are baked into the bundle at build time.

## 7. Firestore database (for REL-2)

AI Studio created a named Firestore database in this project:
`ai-studio-xchromabotautoma-f7df51c8-9507-4dbf-b83e-55995c4c0943` (see `firebase-applet-config.json`).
When server-side Firestore persistence lands (REL-2), the server will use that database through the
runtime service account from step 2; no extra setup beyond the `roles/datastore.user` binding.
Deploy the security rules with the Firebase CLI if you change `firestore.rules`:

```bash
npx firebase-tools deploy --only firestore:rules --project $PROJECT_ID
```

## Updating later

- New code: re-run the `gcloud run deploy` command from step 4.
- Rotate an X key: `add_secret TWITTER_API_KEY` (adds a new version), then
  `gcloud run services update chromabot --update-secrets=TWITTER_API_KEY=TWITTER_API_KEY:latest`
  to roll a new revision.
- Logs: `gcloud run services logs read chromabot --limit=100`.

## Turning off the AI Studio deployment

Once the Cloud Run URL works, stop or unpublish the AI Studio app so the two deployments don't both
run schedulers and double-post.

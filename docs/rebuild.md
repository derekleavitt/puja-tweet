# Rebuild from source (after the 2026-10-23 teardown)

Everything this app ran on was removed on 2026-10-23: no service, no data, no secrets. This guide
takes the source code back to a live app. It takes about 30 minutes. Steps marked **(you)** need
your own logins; the rest are commands.

## What exists and what does not

| Thing | State |
| --- | --- |
| Source code (this repo) | Kept. CI still runs on every PR |
| GitHub workflow "Deploy to Cloud Run" | **Disabled** (`gh workflow enable deploy.yml` to turn it back on) |
| GitHub repo variables `GCP_*` | Kept, but they point at deleted resources until step 3 refreshes them |
| GCP project `hitthehatch` | Kept. **Shared with other apps** (`airbrush-hat-co`, `hatch-hatch`, `leavitt-company`, other Firestore databases): never delete the project or touch resources not named `chromabot*` |
| Firebase project `hitthehatch` (Google sign-in, web config in `firebase-applet-config.json`) | Kept (shared) |
| Cloud Run `chromabot`, Scheduler `chromabot-tick`, Artifact Registry `chromabot`, service accounts `chromabot-runtime` / `chromabot-deployer`, Workload Identity pool `github` | Deleted |
| Old AI Studio service `x-chromabot-automated-color-reply-generator` | Deleted (do not recreate) |
| Firestore database `ai-studio-xchromabotautoma-…` (campaigns, accounts, logs) | **Deleted**: a rebuild starts empty |
| Secret Manager secrets (X keys, Gemini key, webhook/cron/encryption secrets) | **Deleted** |

## Prerequisites (you)

- `gcloud` (signed in: `gcloud auth login`, an owner of `hitthehatch`), `gh` (signed in), Node 22.
- **X developer app** at [developer.x.com](https://developer.x.com) → your app:
  - Keys and tokens → **API Key and Secret** (regenerate them if the old ones were exposed; you
    paste them in step 2). Optional: a **Bearer Token** (only used for X trends).
  - User authentication settings: permissions **Read and Write**, type Web App / Automated App,
    callback added in step 6. X bills API calls: keep credits under **Billing**, or posting and
    "Delete all content" fail with HTTP 402.
- **Gemini API key** from [Google AI Studio](https://aistudio.google.com/apikey) (a new one if the
  old one was deleted).

## 1. Firestore database

The server keeps all state in one Firestore database, named in `firebase-applet-config.json`
(`firestoreDatabaseId`; `FIRESTORE_DATABASE_ID` overrides it). Create a new one and point the repo
at it:

```bash
gcloud firestore databases create --database=chromabot --location=us-west1 --type=firestore-native --project=hitthehatch
```

Then set `"firestoreDatabaseId": "chromabot"` in `firebase-applet-config.json` and
`"database": "chromabot"` in `firebase.json`, and commit both. Deploy the deny-all rules (the server
uses the admin SDK, which bypasses them):

```bash
npx firebase-tools deploy --only firestore:rules --project hitthehatch
```

## 2. Cloud infrastructure and secrets

```bash
bash scripts/setup-gcp-deploy.sh
```

It enables the APIs and creates Artifact Registry `chromabot` (keeps the last 5 images), the service
accounts `chromabot-runtime` (Firestore access) and `chromabot-deployer` (deploys only), the keyless
GitHub → GCP trust (Workload Identity pool `github`, provider `github-actions`, limited to this repo's
`main` branch), and the secrets. It prompts for `TWITTER_API_KEY`, `TWITTER_API_SECRET`,
`TWITTER_BEARER_TOKEN` (blank is fine) and `GEMINI_API_KEY`, and generates `WEBHOOK_SECRET`,
`CREDENTIALS_ENCRYPTION_KEY` and `CRON_SECRET`. Values are never printed.

The deleted pool `github` keeps its name for 30 days (until about 2026-11-22). Before then, run this
first or the script fails on "already exists":

```bash
gcloud iam workload-identity-pools undelete github --location=global --project=hitthehatch
```

(The script then updates the provider; if it reports the provider as deleted, also run
`gcloud iam workload-identity-pools providers undelete github-actions --workload-identity-pool=github --location=global --project=hitthehatch`.)

## 3. GitHub variables and the deploy workflow

Run the `gh variable set …` lines the script prints (`GCP_PROJECT_ID`, `GCP_REGION`,
`GCP_WIF_PROVIDER`, `GCP_DEPLOY_SA`, `GCP_RUNTIME_SA`). Then:

```bash
gh workflow enable deploy.yml
gh workflow run deploy.yml
```

The run tests, builds the image, deploys Cloud Run `chromabot` (us-central1, scale to zero, at most
1 instance) and smoke-tests it. Its summary prints the URL (`https://chromabot-…run.app`).

## 4. The minute tick

```bash
bash scripts/setup-gcp-deploy.sh --scheduler https://<the URL>
```

Creates Cloud Scheduler `chromabot-tick`, which POSTs `/api/cron/tick` every minute with the cron
secret.

## 5. Sign-in (you)

Firebase console → project `hitthehatch` → Authentication → Settings → **Authorized domains** → add
the URL's host. Only `the.derek.leavitt@gmail.com` can sign in (`shared/owner.ts`,
`AUTHORIZED_EMAILS` in `deploy.yml`).

## 6. X accounts and campaigns (you)

1. X developer portal → User authentication settings → add the callback
   `https://<the URL>/oauth/x/callback`.
2. Open the app, sign in. Settings → X accounts → **Connect account** for each account (sign in on X
   as that account first). There is no built-in default account.
3. Recreate the campaigns (the old ones were in the deleted database). Leave the header on **Dry
   Run** and **Paused** until a preview looks right, then switch them off.

Check it: `bash scripts/prod-status.sh 30m` (switches, campaigns, recent log).

## Taking it down again

In this order, only names starting with `chromabot` (the project hosts other apps):

```bash
gh workflow disable deploy.yml
gcloud scheduler jobs delete chromabot-tick --location=us-central1 --project=hitthehatch --quiet
gcloud run services delete chromabot --region=us-central1 --project=hitthehatch --quiet
gcloud projects remove-iam-policy-binding hitthehatch --member=serviceAccount:chromabot-runtime@hitthehatch.iam.gserviceaccount.com --role=roles/datastore.user --condition=None
gcloud projects remove-iam-policy-binding hitthehatch --member=serviceAccount:chromabot-deployer@hitthehatch.iam.gserviceaccount.com --role=roles/run.admin --condition=None
gcloud iam workload-identity-pools delete github --location=global --project=hitthehatch --quiet
gcloud iam service-accounts delete chromabot-deployer@hitthehatch.iam.gserviceaccount.com --project=hitthehatch --quiet
gcloud iam service-accounts delete chromabot-runtime@hitthehatch.iam.gserviceaccount.com --project=hitthehatch --quiet
gcloud artifacts repositories delete chromabot --location=us-central1 --project=hitthehatch --quiet
```

Data (deleting it cannot be undone): the Firestore database from step 1 and the secrets from step 2.

#!/usr/bin/env bash
# One-time, idempotent bootstrap for keyless GitHub Actions -> Cloud Run deploys.
# Run on your own machine, signed in with `gcloud auth login`:
#   bash scripts/setup-gcp-deploy.sh                 # bootstrap
#   Re-running prompts for every X/Gemini secret again: a value you enter overwrites the saved one,
#   blank keeps it. Generated secrets (WEBHOOK_SECRET, CREDENTIALS_ENCRYPTION_KEY, CRON_SECRET) are kept.
#   bash scripts/setup-gcp-deploy.sh --rotate NAME   # add a new version of one secret
#   bash scripts/setup-gcp-deploy.sh --scheduler URL # create/update the Cloud Scheduler job
# Creates NO service-account keys.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-hitthehatch}"
REGION="${REGION:-us-central1}"
GH_REPO="${GH_REPO:-derekleavitt/puja-tweet}"
AR_REPO=chromabot
SERVICE=chromabot
RUNTIME_SA_NAME=chromabot-runtime
DEPLOY_SA_NAME=chromabot-deployer
POOL=github
PROVIDER=github-actions
RUNTIME_SA="${RUNTIME_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
DEPLOY_SA="${DEPLOY_SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
USER_SECRETS=(TWITTER_API_KEY TWITTER_API_SECRET TWITTER_ACCESS_TOKEN TWITTER_ACCESS_TOKEN_SECRET TWITTER_BEARER_TOKEN GEMINI_API_KEY)
GEN_SECRETS=(WEBHOOK_SECRET CREDENTIALS_ENCRYPTION_KEY CRON_SECRET)

say() { printf '\n==> %s\n' "$*"; }
need() { command -v "$1" >/dev/null || { echo "Missing required tool: $1" >&2; exit 1; }; }
need gcloud
need openssl

ACTIVE="$(gcloud auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null | head -n1)"
[ -n "$ACTIVE" ] || { echo "Not signed in. Run: gcloud auth login" >&2; exit 1; }
echo "gcloud account: $ACTIVE   project: $PROJECT_ID   region: $REGION"
G() { gcloud --project "$PROJECT_ID" "$@"; }

is_generated() { printf '%s\n' "${GEN_SECRETS[@]}" | grep -qx "$1"; }

put_secret() { # NAME ; value on stdin
  if G secrets describe "$1" >/dev/null 2>&1; then
    G secrets versions add "$1" --data-file=- >/dev/null
  else
    G secrets create "$1" --replication-policy=automatic --data-file=- >/dev/null
  fi
}

# ---- --rotate NAME -------------------------------------------------------
if [ "${1:-}" = "--rotate" ]; then
  NAME="${2:?usage: --rotate NAME}"
  say "Rotating $NAME (adds a new version)"
  if is_generated "$NAME"; then
    openssl rand -hex 32 | tr -d '\n' | put_secret "$NAME"
  else
    read -rsp "New value for $NAME: " v
    echo
    [ -n "$v" ] || { echo "Empty value, aborting" >&2; exit 1; }
    printf '%s' "$v" | put_secret "$NAME"
    unset v
  fi
  echo "Done. Deploy, or: gcloud run services update $SERVICE --region $REGION --update-secrets=$NAME=$NAME:latest"
  [ "$NAME" = CRON_SECRET ] && echo "CRON_SECRET changed: re-run with --scheduler URL to update the scheduler job."
  [ "$NAME" = CREDENTIALS_ENCRYPTION_KEY ] && echo "WARNING: keys saved through the UI were encrypted with the old key and become unreadable."
  exit 0
fi

# ---- --scheduler URL -----------------------------------------------------
if [ "${1:-}" = "--scheduler" ]; then
  URL="${2:?usage: --scheduler https://SERVICE_URL}"
  URL="${URL%/}"
  say "Cloud Scheduler job chromabot-tick -> POST $URL/api/cron/tick every minute"
  SECRET_VALUE="$(G secrets versions access latest --secret=CRON_SECRET)"
  if G scheduler jobs describe chromabot-tick --location="$REGION" >/dev/null 2>&1; then
    G scheduler jobs update http chromabot-tick --location="$REGION" --schedule='* * * * *' \
      --uri="$URL/api/cron/tick" --http-method=POST --update-headers="x-cron-secret=$SECRET_VALUE" \
      --attempt-deadline=60s --max-retry-attempts=0 >/dev/null
  else
    G scheduler jobs create http chromabot-tick --location="$REGION" --schedule='* * * * *' \
      --uri="$URL/api/cron/tick" --http-method=POST --headers="x-cron-secret=$SECRET_VALUE" \
      --attempt-deadline=60s --max-retry-attempts=0 >/dev/null
  fi
  unset SECRET_VALUE
  echo "Scheduler job ready (secret header set, not printed)."
  echo "Pause: gcloud scheduler jobs pause chromabot-tick --location=$REGION"
  exit 0
fi

[ $# -eq 0 ] || { echo "Unknown arguments: $*" >&2; exit 1; }

# ---- 1. APIs --------------------------------------------------------------
say "Enabling APIs"
G services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com \
  firestore.googleapis.com iamcredentials.googleapis.com sts.googleapis.com iam.googleapis.com \
  cloudscheduler.googleapis.com cloudresourcemanager.googleapis.com
PROJECT_NUMBER="$(G projects describe "$PROJECT_ID" --format='value(projectNumber)')"

# ---- 2. Artifact Registry + cleanup ---------------------------------------
say "Artifact Registry repo $AR_REPO (keep last 5 images)"
G artifacts repositories describe "$AR_REPO" --location="$REGION" >/dev/null 2>&1 ||
  G artifacts repositories create "$AR_REPO" --repository-format=docker --location="$REGION" \
    --description="X ChromaBot images"
POLICY="$(mktemp)"
trap 'rm -f "$POLICY"' EXIT
cat >"$POLICY" <<'JSON'
[
  {"name": "keep-last-5", "action": {"type": "Keep"}, "mostRecentVersions": {"keepCount": 5}},
  {"name": "delete-the-rest", "action": {"type": "Delete"}, "condition": {"tagState": "any"}}
]
JSON
G artifacts repositories set-cleanup-policies "$AR_REPO" --location="$REGION" --policy="$POLICY" --no-dry-run

# ---- 3. Service accounts --------------------------------------------------
say "Service accounts"
for n in "$RUNTIME_SA_NAME" "$DEPLOY_SA_NAME"; do
  G iam service-accounts describe "$n@${PROJECT_ID}.iam.gserviceaccount.com" >/dev/null 2>&1 ||
    G iam service-accounts create "$n" --display-name="X ChromaBot $n"
done

say "Runtime SA role: roles/datastore.user"
G projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$RUNTIME_SA" \
  --role=roles/datastore.user --condition=None >/dev/null

say "Deploy SA roles: run.admin (project), artifactregistry.writer (repo), serviceAccountUser (runtime SA only)"
G projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$DEPLOY_SA" \
  --role=roles/run.admin --condition=None >/dev/null
G artifacts repositories add-iam-policy-binding "$AR_REPO" --location="$REGION" \
  --member="serviceAccount:$DEPLOY_SA" --role=roles/artifactregistry.writer >/dev/null
G iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --member="serviceAccount:$DEPLOY_SA" --role=roles/iam.serviceAccountUser >/dev/null

# ---- 4. Workload Identity Federation --------------------------------------
say "Workload Identity Pool + GitHub OIDC provider (only $GH_REPO on refs/heads/main)"
G iam workload-identity-pools describe "$POOL" --location=global >/dev/null 2>&1 ||
  G iam workload-identity-pools create "$POOL" --location=global --display-name="GitHub"
COND="assertion.repository=='${GH_REPO}' && assertion.ref=='refs/heads/main'"
PROV_ARGS=(--location=global --workload-identity-pool="$POOL"
  --issuer-uri="https://token.actions.githubusercontent.com"
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref"
  --attribute-condition="$COND")
if G iam workload-identity-pools providers describe "$PROVIDER" --location=global --workload-identity-pool="$POOL" >/dev/null 2>&1; then
  G iam workload-identity-pools providers update-oidc "$PROVIDER" "${PROV_ARGS[@]}" >/dev/null
else
  G iam workload-identity-pools providers create-oidc "$PROVIDER" "${PROV_ARGS[@]}" >/dev/null
fi
WIF_PROVIDER="projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/providers/${PROVIDER}"
G iam service-accounts add-iam-policy-binding "$DEPLOY_SA" --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/${GH_REPO}" >/dev/null

# ---- 5. Secrets -----------------------------------------------------------
say "Secrets (X/Gemini values: enter to overwrite, blank keeps the saved value; generated ones are kept, use --rotate NAME)"
CHANGED=0
for s in "${USER_SECRETS[@]}" "${GEN_SECRETS[@]}"; do
  if is_generated "$s"; then
    if G secrets describe "$s" >/dev/null 2>&1; then
      echo "  $s: exists, kept"
    else
      openssl rand -hex 32 | tr -d '\n' | put_secret "$s"
      echo "  $s: generated"
    fi
  else
    if G secrets describe "$s" >/dev/null 2>&1; then
      prompt="  New value for $s (hidden; blank keeps the saved value): "
    else
      prompt="  Value for $s (hidden; blank to skip): "
    fi
    read -rsp "$prompt" v
    echo
    if [ -n "$v" ]; then
      printf '%s' "$v" | put_secret "$s"
      echo "  $s: saved (overwrote any previous value)"
      CHANGED=1
    elif G secrets describe "$s" >/dev/null 2>&1; then
      echo "  $s: kept"
    else
      echo "  $s: skipped (re-run later)"
    fi
    unset v
  fi
  if G secrets describe "$s" >/dev/null 2>&1; then
    G secrets add-iam-policy-binding "$s" --member="serviceAccount:$RUNTIME_SA" \
      --role=roles/secretmanager.secretAccessor >/dev/null
  fi
done

if [ "$CHANGED" = 1 ] && G run services describe "$SERVICE" --region "$REGION" >/dev/null 2>&1; then
  say "Secrets changed: rolling a new revision so the app picks them up"
  G run services update "$SERVICE" --region "$REGION" --update-env-vars="SECRETS_UPDATED_AT=$(date +%s)" >/dev/null \
    && echo "  $SERVICE restarted with the new values." \
    || echo "  Could not restart $SERVICE; re-run the Deploy workflow instead."
fi

# ---- 6. Summary -----------------------------------------------------------
cat <<OUT

==> Bootstrap complete. Set these GitHub repository VARIABLES (not secrets):

  GCP_PROJECT_ID   = $PROJECT_ID
  GCP_REGION       = $REGION
  GCP_WIF_PROVIDER = $WIF_PROVIDER
  GCP_DEPLOY_SA    = $DEPLOY_SA
  GCP_RUNTIME_SA   = $RUNTIME_SA

  gh variable set GCP_PROJECT_ID   --repo $GH_REPO --body '$PROJECT_ID'
  gh variable set GCP_REGION       --repo $GH_REPO --body '$REGION'
  gh variable set GCP_WIF_PROVIDER --repo $GH_REPO --body '$WIF_PROVIDER'
  gh variable set GCP_DEPLOY_SA    --repo $GH_REPO --body '$DEPLOY_SA'
  gh variable set GCP_RUNTIME_SA   --repo $GH_REPO --body '$RUNTIME_SA'

Next:
  1. Push to main (or Actions -> Deploy to Cloud Run -> Run workflow). The job summary prints the URL.
  2. MANUAL console step: Firebase console -> Authentication -> Settings -> Authorized domains ->
     Add domain (host of the service URL):
     https://console.firebase.google.com/project/$PROJECT_ID/authentication/settings
  3. bash scripts/setup-gcp-deploy.sh --scheduler <SERVICE_URL>
OUT

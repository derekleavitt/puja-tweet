#!/usr/bin/env bash
# Read-only snapshot of production: global switches, every campaign's schedule state (from
# Firestore) and the recent scheduler / drop log (from Cloud Logging). Never prints credentials.
#
#   bash scripts/prod-status.sh            # last 30 minutes of logs
#   bash scripts/prod-status.sh 2h         # any gcloud --freshness value
#
# Needs `gcloud auth login` with access to project hitthehatch.
set -euo pipefail

PROJECT=hitthehatch
SERVICE=chromabot
DATABASE=ai-studio-xchromabotautoma-f7df51c8-9507-4dbf-b83e-55995c4c0943
FRESHNESS=${1:-30m}

token=$(gcloud auth print-access-token)
url="https://firestore.googleapis.com/v1/projects/$PROJECT/databases/$DATABASE/documents/chromabot/state"
# Only these fields are fetched: no credentials, accounts or logs.
mask="mask.fieldPaths=settings.globalPaused&mask.fieldPaths=settings.globalDryRun&mask.fieldPaths=contexts"

STATE_JSON=$(curl -fsS -H "Authorization: Bearer $token" "$url?$mask") python3 - <<'PY'
import datetime, json, os

def un(v):
    k, x = next(iter(v.items()))
    if k == "mapValue":
        return {a: un(b) for a, b in x.get("fields", {}).items()}
    if k == "arrayValue":
        return [un(i) for i in x.get("values", [])]
    if k == "integerValue":
        return int(x)
    return x

def at(ms):
    if not ms:
        return "-"
    return datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone.utc).strftime("%H:%M:%S UTC")

doc = {k: un(v) for k, v in json.loads(os.environ["STATE_JSON"]).get("fields", {}).items()}
s = doc.get("settings", {})
paused = s.get("globalPaused") is not False
dry = s.get("globalDryRun") is not False
print("Global:", "PAUSED (no scheduled posts)" if paused else "Running", "|", "Dry run" if dry else "LIVE")
contexts = doc.get("contexts", [])
print("Campaigns:", len(contexts))
for c in contexts:
    sch = c.get("schedule", {})
    if sch.get("mode") == "interval":
        every = "every %sm" % sch.get("intervalMinutes")
    else:
        every = "at %s %s" % (",".join(sch.get("scheduleTimes", [])), sch.get("timezone"))
    state = "on" if c.get("enabled") else "OFF" + (" (%s)" % c["autoPausedReason"] if c.get("autoPausedReason") else "")
    print("- %s [%s] %s, %s, %s, %s, last attempt %s, errors %s" % (
        c.get("name"), c.get("id"), c.get("mode") or "single", every, state,
        "dry run" if c.get("dryRun") else "live", at(c.get("lastPostedTimestamp")),
        c.get("consecutiveErrors") or 0))
    if c.get("retry"):
        print("    retry:", c["retry"])
    cs = c.get("conversationState")
    if cs:
        print("    conversation: turn %s, next speaker %s%s" % (
            cs.get("turnCount"), cs.get("nextSpeakerAccountId"), ", FINISHED" if cs.get("finished") else ""))
PY

echo
echo "Log (last $FRESHNESS, newest first):"
gcloud logging read \
  "resource.type=\"cloud_run_revision\" AND resource.labels.service_name=\"$SERVICE\" AND textPayload!=\"\" AND NOT textPayload:\"STARTUP TCP probe\"" \
  --project="$PROJECT" --freshness="$FRESHNESS" --limit=40 --format='value(timestamp,textPayload)' |
  cut -c1-220

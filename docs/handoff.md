# Handoff: where things stand

A snapshot for picking the project back up locally (Claude Code CLI on your own machine).

## Running

- **Live app:** Google Cloud Run (project `hitthehatch`), service `chromabot`.
- **Scheduler:** Cloud Scheduler POSTs `/api/cron/tick` every minute.
- **Storage:** Firestore.
- **AI:** Gemini Flash-Lite only (`gemini-3.1-flash-lite`). `GEMINI_MODEL` overrides it.
- **Deploys:** every merge to `main` deploys through GitHub Actions (keyless Workload Identity
  Federation). No secrets live in the repo; they're in Secret Manager.
- **Logs:**

  ```bash
  gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="chromabot"' \
    --project=hitthehatch --limit=50 --freshness=2h --format='value(timestamp,textPayload)'
  ```

## Features (all merged)

| Feature | Notes |
| --- | --- |
| Campaigns-only UI | Studio is removed. Each campaign card configures, previews and posts. |
| Hashtags field | Lives outside the template, with optional evolution. See `docs/hashtags.md`. |
| Several X accounts | "Posts as" per campaign. Connect accounts in Settings → X accounts (classic authorize page, or PIN). See `docs/accounts.md`. |
| Conversation campaigns | 2–5 accounts, random turns, `@next cc @others`, Unlimited or N turns per round, Resume (another round) and Restart (new thread). See `docs/conversations.md`. |
| Recovery | Temporary failures back off and never pause. Real failures pause after 5. History is per campaign, so it survives log trimming. Crash-safe posting (at most one duplicate per crash). See `docs/campaign-isolation.md` §7. |

## Known trade-offs and ideas for later

- **Gemini outages:** a never-ending Gemini outage, such as hitting a daily cap, keeps retrying every
  15 min instead of pausing. It shows in the status bar and logs.
- **Crash during a post:** a crash between X accepting a post and the save can post that turn twice.
- **Extra writes:** each live post makes 3 Firestore state writes. That's fine at this scale.
- **X's Free plan:** the 17 posts/day limit is per app, so extra accounts don't add capacity.
  Basic is about 100 per day per account.
- **Not built yet:** a "Generate personas" helper, hashtags every Nth conversation turn, and an AI
  that picks the next speaker.

## Branches on GitHub

| Branch | What it is | Status |
| --- | --- | --- |
| `main` | Everything above; this is what's deployed. | Use this. |
| `held-docs-v2` | Two old docs commits that were held at the owner's request and never merged: a "Backlog v2" regroom of `BACKLOG.md` and a docs-drift pass. Both predate the multi-account, conversation and recovery work, so parts are stale. | Reference only. Cherry-pick what's useful or delete the branch. |
| `claude/inspiring-bardeen-fhi8x3` | The cloud session's working branch. Every change on it is merged into `main` through its PRs (the last is #25). | Safe to delete. |

## Working locally

```bash
git clone https://github.com/derekleavitt/puja-tweet.git && cd puja-tweet
npm ci && npx playwright install chromium
npm run dev          # http://localhost:3000 (dev auth bypass available, see .env.example)
npm test && npm run e2e
```

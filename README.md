# 🎨 X ChromaBot

An automated, aesthetic daily chromatic reply bot for X (formerly Twitter) that posts unique sunrise and sunset palette drops with procedural 3–5 word weather descriptions and `#eternal #colors`.

## ⏰ Automated Schedule
- **Frequency**: Twice daily, 6:00 AM and 6:00 PM America/Denver. Two scheduling paths exist:
  1. **Express server scheduler (recommended, primary path)**: the long-running server evaluates `SCHEDULE_TIMES`.
  2. **GitHub Actions cron (optional fallback, off by default)**: `0 12,0 * * *` UTC (correct during DST; in standard time it fires an hour early). It only runs when the repository variable `CHROMABOT_ACTIONS_ENABLED` is `true`, and posts live only when `CHROMABOT_ACTIONS_LIVE` is also `true`; otherwise it is a dry run.
- **Color Selection**: Intelligently determines morning sunrise vs. evening sunset palettes based on current time, or custom manual slot selection.
- **Format**: `[Color Pick] [3-5 word weather description] #eternal #colors`

---

## 🚀 GitHub Actions Cloud Automation

This repository includes automated GitHub Actions workflows:

1. **`.github/workflows/chromabot-scheduler.yml`**:
   - Scheduled runs are disabled unless repository variable `CHROMABOT_ACTIONS_ENABLED=true` (Settings, Secrets and variables, Actions, Variables). Even then they are dry runs unless `CHROMABOT_ACTIONS_LIVE=true`.
   - Supports **`workflow_dispatch`** (Run workflow) from the **Actions** tab with `morning`, `evening`, or `auto`; `dry_run` defaults to on, uncheck it to post live.
   - `scripts/post-drop.ts` runs through the same `dropService` as the server (flags: `--context <id>`, `--slot`, `--dry-run`, `--live`, `--force`). It defaults to dry run (live needs `--live` or `DRY_RUN=false`), and the global switches apply: live runs are simulated while `globalDryRun` is on and refused while `globalPaused` is on (both default on; flip them in the app header, which needs a persistent store such as `STORE=firestore`). Live `--slot auto` runs are refused outside a 60-minute window after a `SCHEDULE_TIMES` entry unless `--force` is passed (window check only; it cannot detect an already-posted slot because Actions keeps no state).

2. **`.github/workflows/ci.yml`**:
   - Validates TypeScript types and builds the web dashboard.

### 🔑 GitHub Secrets Configuration

To enable the GitHub Actions workflow to post live tweets to X, navigate to your GitHub Repository:
**Settings** &rarr; **Secrets and variables** &rarr; **Actions** &rarr; **New repository secret**:

| Secret Name | Value Description |
| :--- | :--- |
| `TWITTER_API_KEY` | Your X Developer Consumer API Key |
| `TWITTER_API_SECRET` | Your X Developer Consumer API Secret |
| `TWITTER_ACCESS_TOKEN` | Your X Developer OAuth 1.0a User Access Token |
| `TWITTER_ACCESS_TOKEN_SECRET` | Your X Developer OAuth 1.0a Access Token Secret |
| `TARGET_TWEET_ID` | Optional default Target Tweet ID to reply to |

*Note: If no GitHub Secrets are configured, you can run the workflow with `dry_run: true` to simulate drops.*

---

## 🛠️ Local Development & Manual Testing

Run a test drop locally:
```bash
# Test a drop in dry-run mode (simulated; prints the context name and engagement mode)
npm run post-drop -- --dry-run

# Target a specific campaign
npm run post-drop -- --dry-run --context ctx_primary

# Test a specific slot (morning or evening)
npm run post-drop -- --slot morning
npm run post-drop -- --slot evening
```

Start the interactive web dashboard & local scheduler:
```bash
npm ci   # Node 22 (see .nvmrc)
npm run dev
```
Open `http://localhost:3000` to preview palettes, adjust the target tweet ID, or post live drops.

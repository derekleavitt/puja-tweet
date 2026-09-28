# 🎨 X ChromaBot

An automated, aesthetic daily chromatic reply bot for X (formerly Twitter) that posts unique sunrise and sunset palette drops with procedural 3–5 word weather descriptions and `#eternal #colors`.

## ⏰ Automated Schedule
- **Configured Frequency**: Runs automatically every 5 minutes (`cron: '*/5 * * * *'`) via GitHub Actions.
- **Color Selection**: Intelligently determines morning sunrise vs. evening sunset palettes based on current time, or custom manual slot selection.
- **Format**: `[Color Pick] [3-5 word weather description] #eternal #colors`

---

## 🚀 GitHub Actions Cloud Automation

This repository includes automated GitHub Actions workflows:

1. **`.github/workflows/chromabot-scheduler.yml`**:
   - Runs automatically on cron twice a day (at 6:00 AM & 6:00 PM MST).
   - Also supports **`workflow_dispatch`** (Run workflow) directly from the **Actions** tab on GitHub with options for `morning`, `evening`, or `auto`, plus dry-run simulation.

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
# Test a drop in dry-run mode (simulated)
npm run post-drop -- --dry-run

# Test a specific slot (morning or evening)
npm run post-drop -- --slot morning
npm run post-drop -- --slot evening
```

Start the interactive web dashboard & local scheduler:
```bash
npm install
npm run dev
```
Open `http://localhost:3000` to preview palettes, adjust the target tweet ID, or post live drops.

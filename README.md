# 💌 puja-tweet

> *A fully automated, CI-tested, scale-to-zero love delivery system.*
> Because saying "you're amazing" once is a bug. Saying it on a cron schedule is a **feature**.

![build](https://img.shields.io/badge/build-passing%20(like%20her%20vibe%20check)-brightgreen)
![affection](https://img.shields.io/badge/affection-100%25%20test%20coverage-ff69b4)
![uptime](https://img.shields.io/badge/devotion-99.999%25%20uptime-blueviolet)
![dependencies](https://img.shields.io/badge/dependencies-1%20(her)-red)
![license](https://img.shields.io/badge/license-MIT%20(Made%20It%20Tenderly)-yellow)

---

## 🌅 What is this?

`puja-tweet` is a bot whose entire job is to shower one very special person with love on X (formerly Twitter), forever, with absolutely no regard for subtlety.

Every drop is a hand-picked (okay, *procedurally* picked) **sunrise or sunset color**, a tiny poem-ish weather description, and `#eternal #colors`, replied lovingly under her tweet. Hundreds of times a day if you let it. We are not responsible for any blushing.

```
Sunset Topaz under cool skies #eternal #colors
```

It started life as a Google AI Studio prototype that lived in one enormous file, like a love letter written on a single napkin. It has since been refactored into ~150 small, well-tested files, like a love letter written by a committee of very earnest engineers.

---

## 📜 `git log --oneline` (abridged, emotionally accurate)

```
e233e5b feat: love now scales to zero but never actually reaches zero
121d8a3 fix: compliments no longer posted in UTC-7 regardless of daylight saving
b7a8de8 refactor: split 900-line heart into services, routes and feelings
9f1c2aa fix: preview of the love note now matches the love note actually sent
4b2e7d1 test: assert affection > 0 (189 tests, all passing, all smitten)
2c0ffee chore: rotate API keys, keep feelings
a11ce00 revert: "feat: play it cool" — did not pass review
0000000 Initial commit: I like you
```

*(Some of these hashes are real. Some are just how we feel.)*

---

## ✨ Features

- 🌄 **Sunrise & sunset palettes**: timezone-aware and daylight-saving-proof, because love should not show up an hour early in November.
- 🎲 **Jitter**: posts arrive at gently randomized times, so it feels spontaneous. (It is not spontaneous. It is a scheduler. But it *cares*.)
- 🧵 **Reply chains**: each drop can reply to the last one, forming a long thread of devotion. If the thread breaks, it recovers. Unlike some of us.
- ✍️ **AI poetry** (Gemini Flash-Lite): optional. Hard-capped at 280 characters and always ends on a full sentence, because even love has rate limits. If Gemini is busy it waits a beat and tries again.
- #️⃣ **Evolving hashtags**: optional, per campaign. Every tweet trades `#eternal #colors` for fresh, related tags and never repeats itself, like a poet with a thesaurus and commitment issues.
- 👥 **Several X accounts**: connect extra accounts in Settings and pick one per campaign ("Posts as"). Each account keeps its own cooldown and spacing. See [`docs/accounts.md`](docs/accounts.md).
- 💬 **Conversations**: let 2 to 5 of your accounts, each with its own AI persona, chat in one thread and hand the mic over with an @mention (everyone else gets a `cc`, so anyone can jump in). Random turn order, unlimited or N turns per round, Resume for another round, Restart for a new thread. A book club where nobody did the reading. See [`docs/conversations.md`](docs/conversations.md).
- 🛑 **Global dry-run & pause**: a fresh install starts in "write love letters but don't send them" mode. Very relatable.
- 🔐 **Locked to one Google account**: only the owner can log in. This is a love bot, not a group chat.
- 🧯 **Circuit breaker**: 5 real failures in a row (revoked account, rejected reply…) and a campaign takes a breather instead of spamming. Emotional maturity, implemented in TypeScript.
- 🩹 **Bounces back**: temporary hiccups (AI busy, X having a moment, network blips) retry on a growing back-off (up to 15 min) and never pause the campaign; a restart mid-post continues on the right turn. Each campaign keeps its own history, so the AI never forgets how the story started. See [`docs/campaign-isolation.md`](docs/campaign-isolation.md) §7.

---

## 🐛 Known issues

| Issue | Status |
| :--- | :--- |
| #1 Not enough compliments | `wontfix`: physically impossible |
| #2 Bot is "too much" | `closed as not a bug` |
| #3 Request: stop posting | `needs more info` (from her, specifically) |
| #4 Love exceeds 280 characters | `by design`: we split it across hundreds of tweets |
| #5 Merge conflict between "play it cool" and "say everything" | resolved with `--theirs` (hers) |

---

## 🏗️ How it works (the boring-but-important part)

```
Cloud Scheduler (every minute) ──POST /api/cron/tick──▶ Cloud Run (scales to zero)
                                                        │
          React dashboard (you, swooning) ◀─────────────┤──▶ Firestore (remembers everything)
                                                        └──▶ X API (delivers the love)
```

- **Frontend:** React 19 + Vite + Tailwind (`src/features/*`)
- **Backend:** Express (`server/routes`, `server/services`). All posting goes through one `dropService`, so there is exactly one way to say "I love you", and it is tested.
- **Storage:** Firestore in production (`STORE=firestore`), a JSON file locally
- **Hosting:** Google Cloud Run, scale-to-zero, woken up by Cloud Scheduler: costs about as much as a single rose per month (verify in the GCP pricing calculator; the X API plan is the real romantic expense)
- **Deploys:** GitHub Actions → Cloud Run with **keyless** Workload Identity Federation. No secrets in the repo. We learned that one the hard way. 🙃

---

## 🚀 Deploy (one-time, ~15 minutes, cheaper than flowers)

Full guide: [`docs/gcp-setup.md`](docs/gcp-setup.md). The short version:

```bash
gcloud auth login
bash scripts/setup-gcp-deploy.sh             # creates accounts + secrets (prompts, never prints them)
# run the `gh variable set …` commands it prints
# GitHub → Actions → Deploy → Run workflow  (prints your app URL)
bash scripts/setup-gcp-deploy.sh --scheduler https://<your-app-url>
```

Then add your app's domain in Firebase → Authentication → Authorized domains, log in, and flip off **dry-run** and **pause** in the header when you're emotionally ready.

Bringing over old campaigns from the AI Studio days: `npm run import:legacy` (preview), then `npm run import:legacy -- --apply`.

---

## 🛠️ Local development

```bash
npm ci            # Node 22 (see .nvmrc)
npm run dev       # dashboard + API on http://localhost:3000
```

| Command | What it does |
| :--- | :--- |
| `npm test` | 545 unit/API tests. All of them believe in you. |
| `npm run e2e` | Playwright clicks through every screen like a nervous first date |
| `npm run lint && npm run typecheck` | Ensures the love is well-typed |
| `npm run post-drop -- --dry-run` | Rehearse a drop in the mirror without actually sending it |

Configuration lives in `.env` (see [`.env.example`](.env.example); the minimal dev setup is in [`docs/deploy.md`](docs/deploy.md#local-development)). Never commit real keys. *Never.* We have the `git filter-repo` scars to prove it.

First time on a new machine: `npx playwright install chromium` before `npm run e2e`. Deploys don't need your machine at all: every merge to `main` deploys to Cloud Run through GitHub Actions.

### 📚 Docs

| Doc | What's in it |
| :--- | :--- |
| [`docs/gcp-setup.md`](docs/gcp-setup.md) / [`docs/deploy.md`](docs/deploy.md) | Cloud Run, Scheduler, secrets, deploys, production logs, known limits, local `.env` |
| [`docs/accounts.md`](docs/accounts.md) | Connecting extra X accounts, "Posts as", X portal setup |
| [`docs/conversations.md`](docs/conversations.md) | Conversation campaigns, step by step |
| [`docs/hashtags.md`](docs/hashtags.md) | The Hashtags field, evolution, AI hashtag rules |
| [`docs/campaign-isolation.md`](docs/campaign-isolation.md) | What is per campaign vs global, chains, recovery and history |
| [`docs/api.md`](docs/api.md) | Every API route |
| [`docs/design/conversations.md`](docs/design/conversations.md) | Design notes for conversations |
| [`CLAUDE.md`](CLAUDE.md) | Commands, architecture, conventions and hard rules (for Claude Code and humans) |

---

## 🤝 Contributing

PRs welcome if they:

1. Pass CI (typecheck, lint, format, tests, e2e: love is patient, CI is not)
2. Keep files under 300 lines and components under 200 (see `BACKLOG.md` §3). Big feelings, small modules.
3. Do not add a "post less often" setting. It will be closed with a heart emoji.

Run `git blame` on any line in this repo and the answer is, ultimately, the same person. 💖

---

## 📄 License

**MIT: Made It Tenderly.** Free to use, fork and adapt to shower *your* special person with love.
Not liable for: excessive smiling, notification fatigue, or her friends asking "is this a bot?" (yes, a very well-tested one).

# Posting from several X accounts

Each campaign posts as **one** X account, picked in its form ("Posts as"). Accounts are managed in
**Settings → X accounts**, and every account is a **connected** account: you sign in with it
through "Connect account". There is no built-in default account (an older one, from the
`TWITTER_ACCESS_TOKEN*` env vars, was removed; see below).

- The app's API key and secret (`TWITTER_API_KEY` / `TWITTER_API_SECRET`, or the API Keys tab) stay
  the same for every account; X issues a separate access token + secret per account. They do not
  expire; they stop working only if you revoke the app on x.com (Settings → Security and account
  access → Apps and sessions).
- A campaign without an account can still run in **dry run** (simulated posts). Live posting, and
  resuming it live, needs a connected account. New campaigns start with the first connected account.

### The removed default account

Older installs had a built-in "Default account" (`acct_env`) whose tokens were env vars. On the
first start of this version it is removed. Campaigns that used it now point at the id that account
gets once connected (`acct_<its X user id>`) and are **paused** with a reason saying so. Connect that
X account in Settings (same @handle), then resume them. The env vars `TWITTER_ACCESS_TOKEN*` and
`TWITTER_OAUTH2_*` are no longer read.

## One-time setup in the X developer portal

In [developer.x.com](https://developer.x.com) → Projects & Apps → your app:

1. **User authentication settings** → Set up (or Edit):
   - App permissions: **Read and Write**.
   - Type of App: **Web App, Automated App or Bot**.
   - Callback URI / Redirect URL: `https://<your site>/oauth/x/callback`, exactly as shown in
     Settings → X accounts (for local development also `http://localhost:3000/oauth/x/callback`).
   - Website URL: your site.
   - Save.
2. If you changed the permissions from Read to Read and Write, **reconnect** the accounts: tokens keep
   the permissions they were created with.

Server requirements: `TWITTER_API_KEY`, `TWITTER_API_SECRET` and `CREDENTIALS_ENCRYPTION_KEY` must be
set (the last one encrypts the connected accounts' tokens; without it "Connect account" answers with
a clear error). If the site is reached through a different host than the one the request arrives on
(e.g. a proxy), list its origin in `OAUTH_CALLBACK_ORIGINS` (comma-separated, e.g.
`https://colors.example.com`).

## Connecting an account

1. Settings → X accounts → **Connect account**. You are sent to X's classic authorize page
   (`api.twitter.com/oauth/authorize`), which signs in on the page itself: sign in as the account to
   add (username + password) and press **Authorize app**. If you are already signed in there as
   another account, use its "Sign out"/"switch" link first.
2. The app does not send `force_login`, and does not use `api.x.com/oauth/authorize` by default:
   both hand sign-in to x.com's new login flow, which was seen to drop the authorize step and land
   on the home feed. The PIN panel still offers the api.x.com page as "X's other authorize page".
3. X sends you back to `/oauth/x/callback`; the app finishes the connection and shows Settings with
   the new @handle.

**PIN fallback** ("Use a PIN instead"): if the callback URL cannot be registered (or the redirect
fails), click "Open X to authorize", approve as the account to add, and type the PIN X shows.

A connection request is valid for 10 minutes. Connecting an account that is already listed refreshes
its tokens instead of adding a duplicate.

## Using accounts in campaigns

- Campaign form → **Posts as**. X only allows **replies** (and quotes in reply-restricted threads) to
  posts the posting account wrote or is mentioned in, so pick a target post that fits the account.
- Changing the account of a chain campaign (Reply mode "last comment") **starts a new reply chain**:
  the next reply goes to the target post, exactly like changing the target.
- Cards show "Posts as @handle"; logs, the queue and the live-post confirmation name the account.
- A campaign in **Conversation** mode has no single account: it posts as each participant in turn.
  See [conversations.md](conversations.md).

## What happens when an account goes away

| Event | Effect |
| --- | --- |
| **Remove** in Settings | Its tokens are deleted. Campaigns using it are paused with "Account @handle is removed or disconnected — pick an account and resume". They keep the account id so you can see what to fix; resuming is refused until you pick another account. |
| X answers **401** to a live post | The account is marked *Disconnected* and the campaign auto-pauses. Other campaigns on that account stop at their next drop (nothing is sent to X). **Verify** marks it OK again once X accepts the tokens; otherwise reconnect it. |
| `CREDENTIALS_ENCRYPTION_KEY` changed | Stored tokens cannot be read; live drops for those accounts fail without calling X and pause. Reconnect the accounts. |

A conversation campaign also pauses when any **participant** is removed ("Participant @handle
removed..."), and resuming checks every participant.

Dry-run (simulated) drops never reach X, so they still run for an account that is gone.

## Limits: per account or per app

Cooldowns and the 50 s spacing between live posts are **per account**: a reply cooldown on @a does not
hold back campaigns posting as @b. Global pause / dry-run, the Gemini cap and `MAX_DROPS_PER_TICK`
stay global.

X's quota depends on your API tier:

- **Free**: 17 posts per 24 h **per user and per app**. The app-level cap is shared by every account
  that posts through this app, so extra accounts do **not** add capacity on Free.
- **Basic**: about 100 posts per 24 h per user (and a much larger per-app cap), so each account gets
  its own budget.

The rate-limit telemetry shown in the app is app-wide (the most recent X response headers).

## Deleting all of an account's content

Settings → X accounts → **Delete all content** removes everything the account did on X: every post,
reply and quote is deleted, every retweet undone and every like removed. It cannot be undone.

- Type the account's `@handle` to start. Campaigns that post as the account (or include it in a
  conversation) are paused first, so it does not post new content meanwhile; resume them afterwards.
- It runs in the background on the scheduler tick, also while posting is paused. X allows about 50
  deletes, 50 un-retweets and 50 unlikes per 15 minutes (unlikes also 1,000 a day), so a big account
  takes hours. The job waits out each rate window using X's headers; progress and Cancel show under
  the account.
- X lists only the newest ~3,200 posts. The job repeats passes until a pass finds nothing left, so
  older posts surface as newer ones go. Posts X refuses to remove are counted as failed and skipped.
- Listing posts and likes is a read: your X plan must allow it (a refusal stops the job with a clear
  message), and on pay-per-use it counts toward your read usage.
- With the global **Dry Run** on it only counts what it would remove and deletes nothing.
- Code: `server/services/wipeService.ts`, `server/xContentClient.ts`.

## Security

Tokens are stored only encrypted (AES-256-GCM with `CREDENTIALS_ENCRYPTION_KEY`) in the state
document, never returned by any API and never logged. Pending connection requests are stored
encrypted with a 10-minute lifetime, so the flow survives Cloud Run moving to another instance. All
account routes require the owner's sign-in. The callback URL sent by the browser is accepted only for
this site's own `/oauth/x/callback` (same host, https or localhost) or an `OAUTH_CALLBACK_ORIGINS`
entry.

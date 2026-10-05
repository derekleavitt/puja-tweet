# Posting from several X accounts

Each campaign posts as **one** X account, picked in its form ("Posts as"). Accounts are managed in
**Settings → X accounts**.

- **Default account**: the account whose tokens are in `TWITTER_ACCESS_TOKEN` /
  `TWITTER_ACCESS_TOKEN_SECRET` (normally the account that owns the X developer app). It is always
  listed, cannot be renamed or removed, and is what every campaign without an explicit choice uses
  (older campaigns need no migration). Press **Verify** once so its @handle is shown.
- **Connected accounts**: any other X account you sign in with through "Connect account". The app's
  API key and secret (`TWITTER_API_KEY` / `TWITTER_API_SECRET`) stay the same; X issues a separate
  access token + secret per account. They do not expire; they stop working only if you revoke the
  app on x.com (Settings → Security and account access → Apps and sessions).

## One-time setup in the X developer portal

In [developer.x.com](https://developer.x.com) → Projects & Apps → your app:

1. **User authentication settings** → Set up (or Edit):
   - App permissions: **Read and Write**.
   - Type of App: **Web App, Automated App or Bot**.
   - Callback URI / Redirect URL: `https://<your site>/oauth/x/callback`, exactly as shown in
     Settings → X accounts (for local development also `http://localhost:3000/oauth/x/callback`).
   - Website URL: your site.
   - Save.
2. If you changed the permissions from Read to Read and Write, **regenerate the default account's
   access token and secret** (Keys and tokens) and update the `TWITTER_ACCESS_TOKEN*` secrets: tokens
   keep the permissions they were created with.

Server requirements: `TWITTER_API_KEY`, `TWITTER_API_SECRET` and `CREDENTIALS_ENCRYPTION_KEY` must be
set (the last one encrypts the connected accounts' tokens; without it "Connect account" answers with
a clear error). If the site is reached through a different host than the one the request arrives on
(e.g. a proxy), list its origin in `OAUTH_CALLBACK_ORIGINS` (comma-separated, e.g.
`https://colors.example.com`).

## Connecting an account

1. On x.com, switch to the account you want to add (account menu, bottom left; "Add an existing
   account" if it isn't listed yet). X authorizes whichever account is active in this browser.
2. Settings → X accounts → **Connect account**. X shows "Authorize app" for that account: approve it.
   (The app does not send `force_login`: X routes it to its new login flow, which loses the
   authorize step after "Continue with Google".)
3. X sends you back to `/oauth/x/callback`; the app finishes the connection and shows Settings with
   the new @handle.

**PIN fallback** ("Use a PIN instead"): if the callback URL cannot be registered (or the redirect
fails), click "Open X to authorize", approve as the account to add, and type the PIN X shows.

A connection request is valid for 10 minutes. Connecting an account that is already listed refreshes
its tokens instead of adding a duplicate. Connecting the default account's own user as a connected
account is allowed: it then appears twice (default + connected); both work, but their cooldowns are
tracked separately, so prefer using one of them.

## Using accounts in campaigns

- Campaign form → **Posts as**. X only allows **replies** (and quotes in reply-restricted threads) to
  posts the posting account wrote or is mentioned in, so pick a target post that fits the account.
- Changing the account of a chain campaign (Reply mode "last comment") **starts a new reply chain**:
  the next reply goes to the target post, exactly like changing the target.
- Cards show "Posts as @handle"; logs, the queue and the live-post confirmation name the account.

## What happens when an account goes away

| Event | Effect |
| --- | --- |
| **Remove** in Settings | Its tokens are deleted. Campaigns using it are paused with "Account @handle is removed or disconnected — pick an account and resume". They keep the account id so you can see what to fix; resuming is refused until you pick another account. |
| X answers **401** to a live post | The account is marked *Disconnected* and the campaign auto-pauses. Other campaigns on that account stop at their next drop (nothing is sent to X). **Verify** marks it OK again once X accepts the tokens; otherwise reconnect it. |
| `CREDENTIALS_ENCRYPTION_KEY` changed | Stored tokens cannot be read; live drops for those accounts fail without calling X and pause. Reconnect the accounts. |

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

## Security

Tokens are stored only encrypted (AES-256-GCM with `CREDENTIALS_ENCRYPTION_KEY`) in the state
document, never returned by any API and never logged. Pending connection requests are stored
encrypted with a 10-minute lifetime, so the flow survives Cloud Run moving to another instance. All
account routes require the owner's sign-in. The callback URL sent by the browser is accepted only for
this site's own `/oauth/x/callback` (same host, https or localhost) or an `OAUTH_CALLBACK_ORIGINS`
entry.

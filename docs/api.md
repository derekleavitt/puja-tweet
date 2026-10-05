# X ChromaBot API

Errors: `{ "success": false, "error": "<message>" }` with a real HTTP status (400 validation, 401 auth,
404 unknown id, 500 unexpected). Unknown context ids return 404.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/status` | Settings, contexts, next posts, stats, queue, latest log, `accounts` (see [X accounts](#x-accounts)), `accountCooldowns` (per account id; `cooldownState` stays the default account's) |
| GET | `/api/rate-limits` | Telemetry, default-account `cooldownState`, `accountCooldowns` |
| POST | `/api/cooldown/clear` | Body `{ accountId? }`: clears that X account's cooldown, or every account's without it |
| GET | `/api/contexts` | Contexts, active id, next posts |
| POST | `/api/contexts` | Create a context (400 on invalid body or an unknown `accountId`). Optional `hashtagEvolution` config, see [Evolving hashtags](#evolving-hashtags) |
| PUT | `/api/contexts/:id` | Update (404 unknown id); `hashtagEvolution` merges over the stored config. The chain anchor is server-owned: a `lastPostedTweetId` string is ignored, `null`/`''` resets the chain (as does a new `targetTweetId` or a new `accountId`). An unknown `accountId` is a 400; resuming (`enabled: true`) a campaign whose account is removed or revoked is a 400 |
| DELETE | `/api/contexts/:id` | Delete (404 unknown id, 400 if last context) |
| POST | `/api/contexts/:id/activate` | 404 unknown id |
| POST | `/api/contexts/:id/toggle` | 404 unknown id |
| POST | `/api/contexts/:id/duplicate` | 404 unknown id |
| POST | `/api/contexts/:id/conversation/restart` | Conversation campaigns. Body `{ targetTweetId, openingPost, openerHandle?, firstSpeakerAccountId? }`; resets the chain, turn count and transcript, clears a "finished" pause; returns `{ context, contexts, queue }`; 400 for a non-conversation campaign or invalid input |
| POST | `/api/contexts/:id/reset-chain` | Drops the chain anchor (next reply goes to the root); 404 unknown id |
| POST | `/api/contexts/:id/clear-history` | Drops this campaign's logs, resets its stats and clock; keeps its chain anchor; 404 unknown id |
| POST | `/api/contexts/:id/trigger` | Body `{ slotType?, forceLive? }`; 404 unknown id |
| POST | `/api/settings` | Legacy settings body: campaign fields go to `contextId` (404 unknown; default: the active campaign) and never to any other campaign; the response carries `context` (the campaign edited) and its `queue`. Global switches `globalDryRun` and `globalPaused` (both default `true`, also for stores missing them). Global dry-run forces simulation on every path (`forceLive` cannot override it); global pause makes scheduled sources (scheduler, webhook/cron, CLI) stop, webhook returns 409, manual posting still works |
| POST | `/api/credentials` | Save X credentials (blank/missing fields keep stored values; 400 without `CREDENTIALS_ENCRYPTION_KEY`) |
| DELETE | `/api/credentials/:method` | Remove stored credentials for `oauth1`, `oauth2` or `bearer` |
| POST | `/api/twitter/verify` | Verify credentials; failure is `{ valid:false, message }` |
| POST | `/api/generate-color` | Body `{ slotType?, color?, contextId?, template? }` |
| POST | `/api/template/preview` | Body `{ template?, hashtags?, color?, slotType?, contextId? }` (`template`/`hashtags` preview unsaved edits; 400 when `hashtags` is not a string array); returns `previewText`, `accountId`, `accountHandle`, `breakdown` (see [Evolving hashtags](#evolving-hashtags)) and, when the campaign evolves hashtags, `hashtags` (the tags used, without `#`). For a conversation campaign it returns instead `previewText`, `charCount`, `replyToTweetId`, `lastPostedTweetId`, `isFirstInChain`, `accountId`/`accountHandle` (the speaker) and `conversation: { runId, turnNumber, speakerAccountId, speakerHandle, nextSpeakerAccountId, nextSpeakerHandle, summaryUsed, transcriptLength }` (no color, breakdown or hashtags) |
| POST | `/api/post-now` | Body `{ contextId?, slotType?, color?, forceLive?, text?, hashtags?, slotId? }`; 404 unknown `contextId`. A failed post (X error, or an AI-only template whose AI is unavailable) answers 200 with `success: false` and its error log entry, like every other failure. `text` is posted verbatim; send the preview's `hashtags` with it so the post does not re-roll them. The response carries `hashtags` when evolution is on. For a conversation campaign, send `text` with `conversation: { runId, turnNumber, speakerAccountId, nextSpeakerAccountId }` from the preview: a stale turn is a 409 ("Conversation moved on, refresh the preview"), text without the next speaker's @handle is a 400; without `text` the turn is composed fresh. Only one drop per campaign runs at a time (409 "A drop for this campaign is already running") |
| ALL | `/api/cron/trigger`, `/api/webhook/trigger` | Secret via `?secret=`, `x-cron-secret` or body; `contextId`/`slot`/`forceLive`; 404 unknown `contextId`; without `contextId` the active campaign is posted |
| GET | `/api/webhook/url` | The trigger URL; `?contextId=` pins it to one campaign (404 unknown) |
| GET | `/api/queue` | Optional `?contextId=`; each slot carries `accountHandle` |
| POST | `/api/queue/regenerate` | Body or query `contextId` |
| POST | `/api/queue/reroll` | Body `{ slotId }`; 400 missing, 404 unknown slot |
| GET | `/api/history` | `{ logs }`; each log carries `accountId` and `accountHandle` (logs from before multi-account have neither) |
| DELETE | `/api/history` | Clears logs |

## X accounts

Campaigns post as one X account each (`TweetContext.accountId`; absent = the default account
`acct_env`, whose tokens are the `TWITTER_ACCESS_TOKEN*` env vars). Owner guide:
[docs/accounts.md](accounts.md). Responses never contain tokens; all routes require the owner.

`XAccountInfo` (`shared/types.ts`): `{ id, label, handle, userId, status: 'ok'|'revoked'|'unverified',
lastVerifiedAt?, lastError?, createdAt, isDefault }`. Connected ids are `acct_<X user id>`.

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/accounts` | `{ accounts }`, default first |
| POST | `/api/accounts/connect/start` | Body `{ mode?: 'redirect'\|'pin', callbackUrl? }`. Redirect mode needs `callbackUrl` = this site's `/oauth/x/callback` (same host as the request, https or localhost, or an `OAUTH_CALLBACK_ORIGINS` origin; anything else is a 400). PIN mode uses `oob`. Returns `{ mode, authorizeUrl, oauthToken }` (`authorizeUrl` forces X to ask which account to sign in). 400 when `CREDENTIALS_ENCRYPTION_KEY` or the app API key/secret is missing; X errors are 502. The request-token secret is stored encrypted for 10 minutes |
| POST | `/api/accounts/connect/complete` | Body `{ oauthToken, verifier }` (`verifier` = `oauth_verifier` from the callback, or the PIN). 400 for an unknown/expired/used request token or when X refuses the verifier. Reconnecting an existing X user updates its tokens (no duplicate). Returns `{ account, accounts }` |
| POST | `/api/accounts/:id/verify` | `GET /2/users/me` as that account (works for `acct_env` too); stores handle and status (`ok` or `revoked`). Returns `{ valid, message, account, accounts }` |
| PATCH | `/api/accounts/:id` | Body `{ label }` (max 60 chars); 400 for `acct_env`, 404 unknown |
| DELETE | `/api/accounts/:id` | Deletes its tokens and pauses its campaigns (they keep `accountId`, `autoPausedReason` says what to fix). Returns `{ pausedCampaigns, accounts, contexts }`; 400 for `acct_env`, 404 unknown |

Posting: every drop (scheduler, webhook, CLI, manual) signs with the campaign account's tokens. A live
drop for a removed, revoked or unreadable account fails without calling X (error class `account`)
and pauses the campaign at once; a live 401 marks the account `revoked`. X cooldowns and the 50 s
live spacing are per account.

The SPA route `/oauth/x/callback?oauth_token=…&oauth_verifier=…` (served as `index.html`) calls
`connect/complete` with the owner's token, then opens Settings.

## Evolving hashtags

Per campaign, default off. Config (client-editable) and state (server-owned) on the context:

| Field | Type | Notes |
| --- | --- | --- |
| `hashtags` | string[] | The campaign's own tags (no `#`; normalised, max 10), appended after the template body. On create without `hashtags`, the template's literal tags are moved here (also done once at boot for older campaigns) |
| `hashtagEvolution.enabled` | boolean | Default `false` |
| `hashtagEvolution.maxTags` | integer 1-5 | Default `3`; 400 outside the range |
| `hashtagEvolution.keepSeedTags` | boolean | Default `false`; kept tags count toward `maxTags`, one slot always evolves |
| `hashtagState.current` | string[] | Tags (no `#`) of the latest successful post. Read-only: stripped from any client body |
| `hashtagState.recent` | string[] | Last 40 tags used, never repeated |

Full rules: [docs/hashtags.md](hashtags.md). Evolution off posts `hashtags` as-is; on, it posts evolved
tags seeded from `hashtags` (else the previous tags, the AI's own tags, or a prompt theme). The block is
appended after the body; trailing tags are dropped only if the tweet would exceed 280.

Preview `breakdown` (`DropTextBreakdown` in `shared/types.ts`):

| Field | Notes |
| --- | --- |
| `body` | Text before the tag block (static + AI text) |
| `staticText` | Template text with variables filled, AI parts left out |
| `aiText?` | The AI-written part(s) as posted |
| `tagBlock`, `hashtags` | The appended block (`'#a #b'`, `''` when none) and its tags |
| `tagSource` | `'campaign'`, `'evolved'` or `'none'` |
| `seedSource?` | Evolution only: `'campaign'`, `'previous'`, `'ai'` or `'theme'` |
| `foldedAiTags?` | AI's own tags that made it into the evolved block |
| `removedAiHashtags?` | Tags taken out of the AI text (trailing cluster, duplicates, length) |
| `dehashedAiHashtags?` | Inline AI tags turned into words |
| `removedDuplicateTags?` | Body tags removed/de-hashed because the block already has them |
| `droppedTags?` | Block tags dropped to fit 280 |

## Serverless mode

For scale-to-zero hosts (Cloud Run with request-based billing) set `SCHEDULER_MODE=external`. Default
`interval` is unchanged: an in-process loop ticks every 10 s.

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/cron/tick` | Header `x-cron-secret: <CRON_SECRET>` (timing-safe compare, no Firebase token needed). 401 missing/wrong secret, 503 when `CRON_SECRET` is unset, 409 while a tick is already running. Runs exactly one scheduler tick (same code as the interval loop, including global pause/dry-run, anti-burst, circuit breaker and the `SCHEDULER_TICK_TIMEOUT_MS` watchdog), awaits the drops, flushes state, then returns `{ success: true, fired, skipped, durationMs }`. Works in either mode, so it is also the manual test hook |

Behaviour in `external` mode:

- No interval loop; `GET /api/health` reports `schedulerMode` and `schedulerRunning: false`.
- Every non-GET `/api/*` request awaits a state flush before the response is sent (CPU is throttled
  after the response, so a debounced save could be lost). GET requests never write.
- An idle tick (nothing due) performs zero store writes; Firestore is only written when state changed.
- State is loaded from the store before the server starts listening, so a cold-start tick sees
  persisted state.

| Variable | Default | Purpose |
| --- | --- | --- |
| `SCHEDULER_MODE` | `interval` | `interval` or `external` |
| `CRON_SECRET` | unset | Shared secret for `/api/cron/tick` |
| `MAX_DROPS_PER_TICK` | `5` | Drops one tick may start; due contexts beyond the cap fire on the next tick |

```bash
curl -X POST -H "x-cron-secret: $CRON_SECRET" https://YOUR-SERVICE-URL/api/cron/tick
```

See [campaign-isolation.md](./campaign-isolation.md) for which state is global and which is per campaign.

## Server-owned campaign fields (recovery)

Read-only on `TweetContext` (stripped from client bodies). Details:
[campaign-isolation.md §7](./campaign-isolation.md#7-recovery-and-history-durability).

| Field | Notes |
| --- | --- |
| `retry` | `{ at, reason, transient, attempt, slotKey?, since? }`: next attempt after a failure (`reason` e.g. `AI busy`, `X server error`, `network error`, `last post failed`). Cleared by a success or a resume. The countdown (`secondsUntil`) and `blockedReason` ("Retrying in 2m (AI busy, attempt 3)") use it |
| `inFlight` | `{ startedAt, bootId, sentAt?, runId?, turn?, replyToTweetId?, text? }` while a drop runs (`sentAt` once it is sent to X); `blockedReason` "Posting now…" while another process's sent post is pending |
| `scheduleStartedAt` | When the schedule (re)started (create, resume, schedule change, clear-history); fixed times are never caught up from before it |
| `recentPosts` | Last 10 successful live posts `{ text, tweetId?, at, slotType?, colorName?, colorHex? }` (single mode `<history>` memory) |
| `conversationState.turns` | Turns after `summaryThroughTurn` `{ turn, accountId, handle, text, tweetId?, at }` (at most 40) |
| `consecutiveErrors` | Persistent failures in a row only (transient ones never count) |

`XErrorClass` gained `server_error` (X 5xx) and `ai_unavailable`.

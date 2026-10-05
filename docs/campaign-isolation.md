# Campaign isolation audit

Audited: branch `claude/inspiring-bardeen-fhi8x3` at `ab3358c` (after PR #9 chain fix and PR #10
evolving hashtags). `file:line` references below are to that commit; the fixes landed on top of it.

The app started as a single global `settings` object; campaigns ("contexts") were added later and
the global object was kept as a _mirror_ of the active campaign. This document inventories every
piece of state, classifies it as **global by design** or **per-campaign**, lists every path that
could leak one campaign's values into another, and records the decisions and fixes.

## 1. State inventory

### Global by design (must stay global)

| Field / state                                                       | Where                                                                      | Why global                                                   |
| :------------------------------------------------------------------ | :------------------------------------------------------------------------- | :----------------------------------------------------------- |
| Owner auth (`AUTHORIZED_EMAILS`, Firebase token)                    | `server/middleware/auth.ts`                                                | One owner                                                    |
| X app consumer key/secret, webhook secret                           | `credentialService.ts`                                                     | One X developer app                                          |
| `settings.globalDryRun`, `settings.globalPaused`                    | `settingsService.ts`                                                       | Master safety switches, override every campaign              |
| `lastCapturedRateLimitHeaders`, `postsLast24Hours`, tier detection  | `rateLimitService.getRateLimitTelemetry`                                   | Account quota telemetry                                      |
| `geminiUsage` daily cap                                             | `geminiUsageService`                                                       | One Gemini key                                               |
| `MAX_DROPS_PER_TICK`, tick lock, watchdog                           | `scheduler.ts`                                                             | Process-level                                                |
| Post log array (`logs`, capped by `MAX_LOGS`)                       | `logService`                                                               | Shared store; every entry is tagged with `contextId`         |

### Per X account (multi-account, see [accounts.md](accounts.md))

Each campaign posts as one account (`accountId`, undefined = default `acct_env`). Shared by every
campaign on the **same** account, independent between accounts:

| Field / state | Where | Why per account |
| :-- | :-- | :-- |
| User access token + secret (`BotState.accounts[].encrypted`; env for `acct_env`) | `accountService.getCredentialsForAccount` | X identity |
| Cooldown: `accountCooldowns[id]` (the default account keeps `cooldownUntilMs` / `cooldownReason` / `lastThrottledAt`) | `rateLimitService.setCooldown(…, accountId)` from that account's 429 / reply cooldown | X throttles the account, not the campaign or the app |
| 50 s live spacing: `lastLivePostByAccount[id]` (default: `lastGlobalLivePostTimestamp`) | `rateLimitService`, `scheduler.canFireNow` | Account-level anti-burst (see §4) |
| Account status (`revoked` after a live 401) | `accountService.markRevoked` | The account's tokens stopped working |
| `/api/status.stats`, `latestLog`                                    | `routes/status.ts`                                                         | Whole-bot counters (per-campaign stats live on the campaign) |
| `activeContextId`                                                   | `state.activeContextId`                                                    | UI selection only: which campaign the Studio/Settings show   |

### Conversation campaigns (`mode: 'conversation'`, see [conversations.md](conversations.md))

- **The chain anchor spans accounts.** One campaign, one thread: each turn is posted by a different
  participant but replies to the same `chainAnchor`, which only the campaign's own live posts move.
  Changing a conversation's account is meaningless (`accountId` is ignored), so `patchContext` skips
  the account-change chain reset for it. Changing `targetTweetId` or the mode starts a new run.
- **State is per run.** `conversationState` (`runId`, `turnCount`, `nextSpeakerAccountId`, summary)
  belongs to the campaign and is server-owned. Logs carry `conversationRunId` and `turn`, and the
  transcript is built from the logs of that run only, so Restart gets a clean transcript without
  deleting history, and two conversations never read each other's turns.
- **Per-account state stays per account.** Cooldown, 50 s spacing and revoked status are checked for
  the next speaker's account, so a conversation waits for one blocked voice without blocking
  single-account campaigns, and a single campaign on the same account still shares that account's
  cooldown.
- Tick-vs-manual races are closed by a per-campaign in-flight lock in `dropService`.

### Per-campaign (must be isolated)

| Field                                                                  | Written by                                                                            | Read by                                                                | Risk before this audit                            |
| :--------------------------------------------------------------------- | :------------------------------------------------------------------------------------ | :--------------------------------------------------------------------- | :------------------------------------------------ |
| `targetTweetId`, `engagementMode`, `replyTargetMode`, `autoFallbackToQuote` | `contextService.createContext/patchContext`, `settingsService.updateSettings`    | `dropService` (always from the campaign passed in), queue slot builder | Settings form wrote to the _active_ campaign      |
| `template`, `themePreference`, `schedule.*`, `dryRun`, `enabled`       | same                                                                                  | `dropService.composeText`, scheduler, queue                            | same                                              |
| `hashtagEvolution` (config), `hashtagState` (server-owned)             | `patchContext`, `setHashtagState(context.id)`                                         | `dropText`, `hashtagService.next(context)`                             | none found; duplicate dropped the config          |
| `lastPostedTweetId` + **`chainAnchor` (new)**                          | `recordContextPostResult` (own live reply only), `clearContextAnchor`, target change   | `contextChain.resolveReplyTarget`                                      | verified only via the shared capped log; client could write it |
| `lastPostedTimestamp`, `currentJitterMs`, `lastPostedSlot`, `pendingFire` | scheduler bookkeeping, `recordContextPostResult`                                   | scheduler                                                              | none found                                        |
| `consecutiveErrors`, `autoPausedReason`                                | `recordContextPostResult` (`breakerReason`)                                           | scheduler blocked reason, UI badge                                     | none found                                        |
| `stats`                                                                | `recordContextPostResult`, `clearContextHistory`                                      | UI card                                                                | none found                                        |
| Queue slots (`queue[]` tagged with `contextId`)                        | `queueService` (`clearAndRegenerateQueue(id)`, `ensureQueue(id)`, `popNextQueueSlot(type, id)`) | `dropService`, Queue tab                                        | fallbacks to the active campaign for unknown ids  |
| Series history for `<history>` agent tags: `recentPosts` (last 10 live posts, server-owned) | `dropService` via `contexts.rememberPost`                              | `templateAgent.getSeriesHistory(contextId)` → Gemini prompt            | was derived from the shared capped log (§7)       |
| `retry`, `inFlight` (server-owned)                                     | `recordContextPostResult`, `markInFlight`, `checkInFlight`                             | scheduler (`dueAt`, blocked reason)                                    | new (§7)                                          |

The legacy `BotSettings` **view** (`GET /api/status.settings`) is still served for the UI: it is
computed on every read from one campaign (`buildSettingsView`) and carries `activeContextId` = the
campaign it describes. Nothing is mirrored back into the stored `settings` object any more; the only
stored settings that matter are the two global switches and the first-run seed read by
`primaryContext.ts` / the legacy importer.

## 2. Leak paths found

Severity: **H** = can post into the wrong thread / wrong campaign; **M** = silently changes another
campaign's configuration or chain; **L** = scheduling/telemetry interference or wrong display.

| #   | Sev | Path                                                                                                   | Where (at `ab3358c`)                                                                                                                | Repro                                                                                                                                                                                                                                  | Fix                                                                                                                                                                                                                                                              |
| :-- | :-- | :----------------------------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | H   | Chain anchor trusted only if the **shared** log still holds it; logs are capped by `MAX_LOGS` across all campaigns | `contextChain.ts:72-74` (`resolveLastPostedTweetId`), `stateManager.ts:13` (`maxLogs`)                                     | Pause A after it anchored; let B post > `MAX_LOGS` times; resume A → A silently restarts at the root (and before PR #9 could follow a foreign anchor)                                                                                     | `chainAnchor { tweetId, targetTweetId, postedAt }` stored on the campaign, written only by `recordContextPostResult` for its own live in-thread reply. Verification uses the provenance; logs are only contradiction evidence. Legacy anchors are upgraded at boot when a log proves them, else dropped |
| 2   | M   | Clients could **write** `lastPostedTweetId`; the edit form echoes the whole campaign                   | `contextSchema.ts:44` (`z.string().nullish()`), `contextService.ts:203-207`, `useContextForm.ts` `openEdit` spread                   | Open "Edit" on A, let A post meanwhile, press Save → A's anchor is reverted to the stale value. `PUT /api/contexts/A { lastPostedTweetId: <B's tweet> }` → A replies into B's thread                                                      | A string anchor from a client is ignored; only an explicit `null`/`''` (or `POST …/reset-chain`) resets. Changing `targetTweetId` still starts a new chain. `useContexts.handleUpdateContext` turns `lastPostedTweetId: undefined` (the UI "Reset to Root" calls, which JSON would drop) into an explicit `null` |
| 3   | M   | **Settings form saves to the active campaign**, not the one it shows                                   | `settingsService.ts:31` (`updateSettings` → `getActiveContext()`), `routes/settings.ts`, `SettingsPanel.tsx` `onSaveSettings(changed)` | Open Timing for B; in another tab switch the active campaign to A; press Save → A gets B's template/schedule/target                                                                                                                       | `POST /api/settings` takes `contextId` (404 unknown); the form and the target editors always send the id of the campaign they rendered (`SettingsPanel`, `useSettings`)                                                                                            |
| 4   | M   | The stored settings object **mirrored the active campaign** on activate / patch / delete / post, and `settings.lastPostedTweetId` was written on every reply | `settingsMirror.ts:8-25`, `contextService.ts:93,216,263,299,312,374`, `logService.ts:53`                                   | Not directly observable (the view was already computed from the campaign) but every write was a latent cross-campaign copy and `createContext` read `settings.timezone` (`contextService.ts:119`) = the last active campaign's timezone     | Mirror writes removed; `createContext` defaults the timezone from the server default. `BotSettings` remains the API view type only                                                                                                                            |
| 5   | M   | **clear-history reset the chain anchor**                                                                | `logService.ts:51`                                                                                                                  | Clear A's history (log cleanup) → A's next drop replies to the root                                                                                                                                                                     | Clear-history resets stats, clock and slot only; the anchor stays (it no longer depends on logs). Explicit reset = "Reset to Root" / `reset-chain`                                                                                                                 |
| 6   | M   | New-campaign form **prefilled the active campaign's target**                                            | `useContextForm.ts` `openCreate` (`activeContext?.targetTweetId`)                                                                   | Add campaign while A is active → B points at A's thread unless the owner notices                                                                                                                                                         | Prefill from the server default only                                                                                                                                                                                                                              |
| 7   | L   | Duplicate dropped `hashtagEvolution` config                                                             | `contextService.ts:276-285` (`duplicateContext`)                                                                                    | Duplicate an evolving campaign → copy has evolution off                                                                                                                                                                                 | Config copied; `hashtagState`/anchor never copied                                                                                                                                                                                                                 |
| 8   | L   | **Simulated campaigns were held by the global live spacing** of another campaign's live post            | `scheduler.ts:77-81` (`canFireNow`)                                                                                                 | A live 1-min campaign + B dry-run 1-min: B fires only when ≥ 50 s passed since A's post although B never reaches X                                                                                                                     | Spacing and cooldown gate only drops that will post live                                                                                                                                                                                                          |
| 9   | L   | **Tick order = array order**: with `MAX_DROPS_PER_TICK` (or the spacing) the first campaigns in the list win every tick | `scheduler.ts:141`                                                                                                        | A (first) and C (last) both 1-min, cap 1: C waits for A even when C has waited longer                                                                                                                                                    | Enabled campaigns are evaluated longest-waiting first (`dueAt`)                                                                                                                                                                                                   |
| 10  | L   | Fallbacks to the **active** campaign for unknown ids: `getNextScheduledPost(id)`, `ensureQueue(id)`, reroll of an untagged slot | `scheduler.ts:274-275`, `queueService.ts:60,114`                                                                          | Unknown id → the active campaign's countdown / queue top-up / template                                                                                                                                                                  | Unknown id → `undefined` / no-op; untagged slot → 404                                                                                                                                                                                                              |
| 11  | L   | Webhook URL without `contextId` posts "whatever campaign is active in the UI"                           | `routes/webhook.ts:52` (`buildUrl`)                                                                                                 | Owner switches the Studio campaign → the external cron now posts the other campaign                                                                                                                                                     | `GET /api/webhook/url?contextId=` builds a pinned URL (404 unknown). The unpinned form is kept for compatibility (documented as "active campaign")                                                                                                                 |
| 12  | L   | A global-only toggle (`globalPaused`) also ran `updateContext({})` on the active campaign (bumped `updatedAt`, regenerated its queue) and the global switches relied on that side effect to be persisted | `settingsService.ts:31-63`                                                                                            | Toggle Pause all → the active campaign's queue is thrown away                                                                                                                                                                           | Global switches persist themselves; no campaign update when nothing campaign-level changed                                                                                                                                                                       |

Verified **not** leaking (kept as is): `dropService.executeDrop` reads template, target, modes,
dry-run, fallback, hashtags and chain only from the campaign it resolved (`contextId` → 404 when
unknown; no `getActiveContext()` fallback once an id is given); `recordContextPostResult`,
`setHashtagState`, `setContextLastPostedTimestamp/Slot/PendingFire` are all keyed by id; queue
slots are created, popped and consumed by `contextId`; `getSeriesHistory` is same-context only;
Firestore persists each campaign whole (so `chainAnchor`, `hashtagState`, `pendingFire` survive
scale-to-zero); the legacy importer maps each context document separately and never creates
provenance (imported anchors are unverified until a log proves them at boot).

## 3. Chain-mode continuity (`replyTargetMode: 'last_comment'`)

Requirements and where each is guaranteed (tests in `tests/unit/multiCampaignIsolation.test.ts`,
`tests/api/campaignIsolation.test.ts`, `tests/unit/chainIsolation.test.ts`):

1. **Never moved or reset by**: pause/resume (`patchContext` keeps `chainAnchor`; resume only resets
   the clock and breaker), editing schedule/template/hashtags/dry-run/name, switching the active
   campaign (touches only `activeContextId`), saving the Settings form (strings ignored), other
   campaigns posting (anchor verified by provenance, not the shared log), server restarts / cold
   starts (persisted on the campaign; verified with an empty log), clear-history, failed posts, the
   REL-5 back-off (`recordContextPostResult` only touches the anchor on its own success).
2. **New chain** when `targetTweetId` or `accountId` changes (anchor + provenance cleared, first
   reply goes to the root; another account's replies are a different thread, test "changing the
   account resets the reply chain like a target change") and on explicit reset (`POST /api/contexts/:id/reset-chain`, `PUT` with
   `lastPostedTweetId: null`, Settings "Reset to Root").
3. **Never adopts another campaign's tweet**: provenance is only written by the campaign's own
   successful in-thread reply; a client-sent id is ignored; a legacy anchor is kept only when a log
   proves it was this campaign's reply on this target.
4. `recoverChain` (anchor deleted on X → `target_missing`) resets to the root; duplicate starts
   fresh.

Decision on **clear-history**: it is history cleanup, not a chain reset. The anchor stays.

## 4. What stays global and why (recommendations)

- **50 s live spacing per X account** (`MIN_LIVE_SPACING_MS`): X's spam heuristics act on the
  account, so two campaigns posting as the same account within seconds look like one burst. Effect:
  at most one live post per ~50 s **per account**, i.e. N live 1-minute campaigns on one account
  cannot all keep a 1-minute cadence (each slips to the next tick, longest-waiting first); campaigns
  on different accounts do not hold each other back. Simulated campaigns are not affected. Never
  remove the account-level gate.
- **Cooldown per X account** (any 429 / reply-cooldown): same reason; it blocks only campaigns posting
  as the throttled account. On the Free tier the 17 posts/24 h cap is also per app, so the shared
  rate-limit telemetry (`getGlobalBlockedReason`: exhausted window) stays global.
- **Per-campaign back-off after an error** (`recordContextPostResult`, `TweetContext.retry`): 15
  minutes after a persistent error, a short exponential back-off after a transient one (see §7). It
  is per-campaign (the other campaigns' clocks are untouched, test "the 15-minute error back-off
  moves only the failing 1-minute campaign clock"); the card shows "Retrying in 14m (…)" through
  `blockedReason`.
- `/api/status.stats` and `latestLog` are whole-bot by design; per-campaign counters are
  `context.stats`.

## 5. API changes (backwards compatible)

- `POST /api/settings` accepts `contextId`; without it the active campaign is edited as before. The
  response adds `context` (the campaign edited) and the `queue` is that campaign's.
- `settings.activeContextId` in the response of `/api/settings` is the campaign the view describes.
- `PUT /api/contexts/:id` still accepts `lastPostedTweetId` but a string value is ignored; `null`/`''`
  resets the chain.
- `GET /api/webhook/url?contextId=` returns a pinned trigger URL.
- `TweetContext.chainAnchor` is a new server-owned field (never accepted from clients).

## 6. UI follow-ups (not done here; the server is correct by construction)

- `WebhookSettings`: offer the per-campaign URL (`?contextId=`) next to the legacy one.
- `LiveStudio`/`CardModeControls`/`ReplyModeSelector` call "reset" with `{ lastPostedTweetId: undefined }`;
  `useContexts` now translates that to `null`, but calling `POST …/reset-chain` directly would be
  clearer (`useContexts` could expose `handleResetChain`).
- `ReplyModeSelector` inside the edit modal resets the draft's anchor; the reset only takes effect on
  Save (by design now) — the label could say so.
- Campaign card: show the back-off ("next try in 14m after an error") distinctly from the schedule.
- After saving the Timing form for a campaign that is no longer active, the form remounts for the
  active campaign (the "Settings Saved" flash is lost). Consider keying the panel on the campaign the
  owner picked rather than on the active one.

## 7. Recovery and history durability

Requirement: whatever happens (Cloud Run restarts at any moment, scale-to-zero, Gemini 503s, X
5xx, one tick per minute from Cloud Scheduler), the repeat interval recovers and continues smoothly
with an accurate history. Tests: `tests/unit/recovery.test.ts`.

### History lives on the campaign

The post log is shared and capped (`MAX_LOGS`, default 500, across **all** campaigns). At 1-minute
intervals a campaign's older entries are trimmed within hours, so no AI memory may depend on it.

- **Conversations:** `conversationState.turns` holds every turn after `summaryThroughTurn`
  (`{ turn, accountId, handle, text ≤ 300, tweetId?, at }`). Invariant, enforced by
  `appendTurnRecord` and `refreshSummary`: the summary covers `1..summaryThroughTurn`, the buffer
  holds exactly `summaryThroughTurn+1..turnCount`; turns leave the buffer only in the same step that
  folds them into the summary (by AI; past a hard cap of 40 turns, without AI). The prompt shows the
  summary and every buffered turn. Restart / new target / mode switch start an empty buffer; Resume
  keeps it. Clear-history keeps it (the turn count goes on).
- **Single mode:** `recentPosts` holds the last 10 successful live posts (text ≤ 300, tweet id,
  time, slot, color name/hex) for `<history><agent>` prompts. Clear-history empties it.
- **Legacy state** (no buffer yet) is seeded once from whatever the log still has.
- Size: at most 40 turns or 10 posts of ≤ 300 chars per campaign, so a campaign adds at most about
  16 KB to the Firestore state document (limit 1 MiB).

### Transient vs persistent failures

| Class | Examples (`XErrorClass`) | Back-off (`retry.at`) | Breaker |
| --- | --- | --- | --- |
| Transient | `ai_unavailable` (Gemini busy / timeout / daily cap), `server_error` (X 5xx), `network` (no answer, timeout) | 1×, 2×, 4×… the interval, at least 1 min, at most 15 min (`transientRetryDelayMs`) | Never: does not touch `consecutiveErrors`, never auto-pauses |
| Throttled | `rate_limit` (429), `cooldown` | 15 min (plus the account cooldown) | Not counted |
| Persistent | `auth`, `payment`, `account` (immediate pause); `target_missing` after recovery, `reply_restricted`, `text_invalid`, `unknown`, AI not configured | max(15 min, interval) | Pauses after `MAX_CONSECUTIVE_ERRORS` (5) |

A success (live or simulated) clears `retry` and `consecutiveErrors`. Decision: transient failures
never pause a campaign, however long they last (a Gemini or X outage ends by itself; the card keeps
saying "Retrying in 15m (AI busy, attempt 7)"). An AI-only single template whose AI fails is now
recorded like any failed post (error log, back-off) instead of throwing on every tick. A fixed-time
campaign retries a transiently failed slot with the same back-off for up to an hour.

### Crash safety (no duplicates, no gaps)

Order of one live drop: compose (AI) → persist the in-flight marker
(`inFlight { startedAt, bootId, runId?, turn?, replyToTweetId, text }`, awaited flush) → X → in
one synchronous step `recordContextPostResult` (clock, anchor, retry, clears the marker) +
`recordConversationTurn` (turn count, next speaker, transcript) + `rememberPost` + log append →
awaited flush. A Firestore save writes the whole state document after the log documents, so a save
carries all of it or none.

- Crash **before** X: the marker (if written) is cleared on a later tick, nothing was posted, the
  same turn/post is attempted again.
- Crash **after X accepted, before the result was saved**: the next instance sees the marker. If it
  is younger than 5 minutes and from another process it waits (an overlapping instance may still be
  posting, e.g. during a deploy); otherwise it clears it and writes an "Interrupted" error log entry.
  The campaign continues from its last recorded post: the turn count, speaker and anchor were not
  advanced, so the same turn is written again and replies to the same tweet. **Bound: at most one
  duplicate post per crash**, which X shows as a second reply to the same tweet; the transcript and
  anchor follow the second one, so the stored history stays coherent. The window is one Firestore
  write long, because the result is flushed right after X answers.
- The cron route still flushes before replying; `/api/cron/tick` answering 409 (tick still running)
  never loses a post.

### Cadence

- **No burst after downtime:** an interval campaign is due once `interval (+ jitter)` has passed
  since its last attempt (or at `retry.at`), so after 3 hours of downtime it posts once, then
  resumes its cadence. Fixed times never post more than the most recent missed slot.
- **Missed fixed slots:** a slot whose minute was missed by a late, skipped or busy tick still fires
  within 10 minutes (`FIXED_CATCH_UP_MS`), once, and never a slot from before the campaign was
  created or resumed. A pending (jittered) fire survives restarts and is dropped after an hour.
- **1-minute campaigns on a 1-minute tick:** the clock is anchored to when the drop **started**,
  not when X answered, and live spacing is measured between X requests, so a 20-second AI call no
  longer pushes the next post a whole tick later. In `SCHEDULER_MODE=external` a campaign counts as
  due 30 s early (half a tick; 5 s for the in-process 10 s loop; override
  `SCHEDULER_DUE_TOLERANCE_MS`).
- **Resume** restarts the interval from now (no immediate post after a long pause) and clears the
  retry and breaker state.
- All times are epoch milliseconds; fixed times are evaluated in the campaign's IANA time zone
  (DST-aware).

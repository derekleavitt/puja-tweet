# Conversation campaign mode: design

Several connected X accounts take turns replying to each other in **one** thread. Each account has a
similar but unique AI persona, and each one knows the whole history.

## Owner decisions

- **Visible @mention handoff.** Every turn ends by addressing the NEXT speaker's @handle, because X
  only lets an app reply to a post its account wrote or is mentioned in. The next speaker is chosen
  BEFORE the current turn is written and is stored on the campaign, so preview, queue and post agree.
- **Owner-written opening post.** The owner posts the opening reply by hand (with @mentions) and pastes:
  - its tweet ID as the campaign target, which becomes the chain root;
  - its text into "Opening post", so the AI knows it (no X reads).
- **Random turn order.** The same account never speaks twice in a row.
- **Length.** Unlimited, or a fixed N turns. At N the campaign auto-pauses with
  "Conversation finished (N turns)". **Restart** takes a new anchor and opening post and resets the
  turn count and transcript.
- **Hashtags** are off for conversations.

## 1. Data model (`shared/types.ts`; all fields optional, so no migration)

```ts
export interface ConversationParticipant { accountId: string; persona: string } // 'acct_env' allowed
export interface ConversationConfig {          // client-editable
  participants: ConversationParticipant[];     // 2–5, unique accountId
  sharedPrompt: string;                        // premise / tone
  openingPost: string;                         // owner's own reply text (= targetTweetId)
  openerHandle?: string;                       // no '@'; the account that posted the opener
  firstSpeakerAccountId?: string;              // undefined = random participant
  maxTurns?: number;                           // undefined = unlimited, else 1–500
}
export interface ConversationState {           // server-owned, stripped from client bodies
  runId: string;                               // 'run_<ts>'; Restart creates a new one
  turnCount: number;                           // posted (live or simulated) turns in this run
  nextSpeakerAccountId: string;                // chosen BEFORE the turn is written
  summary?: string; summaryThroughTurn?: number;
}
// TweetContext additions
mode?: 'single' | 'conversation';              // undefined = 'single'
conversation?: ConversationConfig; conversationState?: ConversationState;
// PostLog additions: conversationRunId?, turn?, nextSpeakerAccountId?
//   (accountId/accountHandle hold the speaker)
// QueueSlot addition: speakerAccountId?   NextPostInfo addition: speakerHandle?
```

**How conversation mode coexists with single-account campaigns.**

These single-account fields are ignored or forced in conversation mode:

| Field | Conversation mode |
| --- | --- |
| `accountId` | ignored (the speaker changes per turn) |
| `engagementMode` | `'reply'` |
| `replyTargetMode` | `'last_comment'` |
| `autoFallbackToQuote` | `false` |
| `template`, `themePreference` | unused |
| `hashtags` | `[]` |
| `hashtagEvolution.enabled` | `false` |

`patchContext` rules:
- It skips the account-change chain reset when `mode === 'conversation'`.
- Changing `targetTweetId`, or switching mode, starts a new run (the state is reinitialised).

`conversationState` is initialised on create and on restart, with
`nextSpeaker = firstSpeakerAccountId ?? random participant`.

## 2. Turn algorithm

Code lives in `server/services/conversationService.ts`. The pure parts go in
`server/services/conversationTurn.ts`.

- **Speaker:** `speaker = state.nextSpeakerAccountId`.
- **Next speaker:** `next = pickNext(speaker, participants, rng)`, uniform random over participants
  other than the speaker. With 2 participants this is strict alternation.
- **Transcript:**
  ```ts
  logs.filter(l => l.contextId === ctx.id
    && l.conversationRunId === state.runId
    && (l.status === 'success' || l.status === 'simulated'))
  ```
  in chronological order. Restart creates a new runId, which gives a clean transcript without
  deleting any logs.
- **Summary:**
  - The last 15 turns are always included word for word.
  - When `turnCount − (summaryThroughTurn ?? 0) > 20`, one extra Gemini call folds turns
    `(summaryThroughTurn, turnCount−15]` into `summary` (at most 600 chars, merged with the old
    summary). It is persisted on `conversationState`.
  - Best effort: on failure, keep the old summary and send only the last 15 turns.
  - It is computed inside `buildTurn`, so preview and post see the same context.
- **Generation:** extract `generateAgentText(contents, {systemInstruction, maxLength})` from the
  model loop in `generatePoeticAgentText`. It covers both models, the daily cap, the too-long retry
  and `trimToCompleteSentence`. The poetry path must behave exactly as today. It throws
  `AgentUnavailableError` when every model fails or none is configured (no fallback text).
- **Length budget:** `mention = " @" + nextHandle` and
  `max = min(240, 280 − weightedTweetLength(mention))`.
- **Mention guarantee:** `ensureMention(text, nextHandle)` keeps the text when
  `/(^|[^\w])@next\b/i` matches. Otherwise it returns `trimToCompleteSentence(text, max) + mention`.
  - Any @handle that is not a participant or the opener is de-@'d (`@foo` → `foo`).
  - Finish with a final `checkTweetText` (≤ 280).
- **Building a turn:**
  - `buildTurn(ctx)` returns:
    ```ts
    { runId, turnNumber: state.turnCount + 1, speakerAccountId, speakerHandle,
      nextSpeakerAccountId, nextSpeakerHandle, text, replyToTweetId, summaryUsed }
    ```
  - Handles come from `accounts.handleOf`. A participant without a known handle (an unverified
    default account) is a 400 at save or preview: "Verify @handle first".
- **Recording a turn:** `contexts.recordConversationTurn(id, turn, status)`.
  - On success or simulated:
    - `turnCount++`;
    - `nextSpeakerAccountId = turn.nextSpeakerAccountId`;
    - regenerate the queue;
    - if `maxTurns && turnCount >= maxTurns`, set `enabled = false` and
      `autoPausedReason = 'Conversation finished (N turns)'`.
  - On error the state is untouched: the same speaker retries and the anchor stays where it is.
  - The breaker and the 15-minute back-off apply unchanged.

## 3. Gemini prompt

System instruction (`CONVERSATION_SYSTEM_INSTRUCTION`):

```
You write ONE reply in a public X (Twitter) conversation between several accounts. You speak as exactly one of them.
Output ONLY the reply text: no quotes, no preamble, no name labels, no hashtags.
Strictly under {max} characters. Always end on a complete sentence.
The reply MUST end by addressing the next speaker with their @handle exactly as given.
Never mention anyone else. Stay in character, react to what was said last, don't repeat earlier points.
```

Contents:

```
SHARED PREMISE AND TONE:
{sharedPrompt}

YOUR CHARACTER (you are @{speaker}):
{persona}

You are @{speaker}, talking with {@a, @b (everyone except speaker)}{, in a thread opened by @opener}.

OPENING POST{ by @opener}:
"{openingPost}"

{if summary} EARLIER IN THE CONVERSATION (summary of turns 1–{summaryThroughTurn}):
{summary}

CONVERSATION SO FAR (oldest first):
[Turn 7] @a: "…"
[Turn 8] @b: "…"
(no turns yet: "No one has replied yet; you reply to the opening post.")

WRITE TURN {n} AS @{speaker}. End by addressing @{next} (write "@{next}" literally, as the last words).
Output ONLY the reply text, under {max} characters, complete sentences.
```

## 4. API and UI

### Schema (`contextSchema.ts`)

```ts
mode: z.enum(['single', 'conversation'])
conversation: {
  participants: array(2–5) of { accountId: string.max(100), persona: string.max(1500) },
  sharedPrompt: string.max(3000),
  openingPost: string.max(1000),
  openerHandle: /^[A-Za-z0-9_]{1,15}$/ (optional),
  firstSpeakerAccountId: optional,
  maxTurns: int 1–500, nullish,
}
// conversationState is stripped from client bodies
```

### Service rules (each is a 400)

- Every participant passes `checkAccountId` (connected, or `acct_env`).
- No duplicate accountIds.
- `firstSpeakerAccountId` is one of the participants.
- When the opener is also a participant, it can't be the first speaker.
- The opening post must contain `@firstSpeakerHandle`. When the first speaker is random, it is picked
  only among participants mentioned in the opening post, or any participant if none is mentioned.

### Preview

`POST /api/template/preview {contextId}` for a conversation returns:

```ts
{ success, previewText, charCount, replyToTweetId, lastPostedTweetId, isFirstInChain,
  accountId: speaker, accountHandle: speakerHandle,
  conversation: { runId, turnNumber, speakerAccountId, speakerHandle,
                  nextSpeakerAccountId, nextSpeakerHandle, summaryUsed, transcriptLength } }
```

It returns no color, breakdown or hashtags, and ignores the template param.

### Post-now

- The body adds `conversation: { runId, turnNumber, speakerAccountId, nextSpeakerAccountId }`
  alongside `text`.
- `executeDrop` checks it against `conversationState`: same runId, `turnNumber = turnCount + 1`, and
  speaker = state.next. A mismatch is a 409 "Conversation moved on, refresh the preview".
- `text` must contain `@nextHandle`, otherwise 400.
- Without `text` (scheduler, webhook, trigger, CLI) it composes the turn fresh.
- **Per-campaign in-flight lock** in dropService (`Set<contextId>`; 409 "A drop for this campaign is
  already running") closes the tick-vs-manual race for all modes.

### Restart

`POST /api/contexts/:id/conversation/restart` with body
`{ targetTweetId, openingPost, openerHandle?, firstSpeakerAccountId? }`:
- patches the config;
- calls `resetContextChain`;
- creates a new `conversationState` (turnCount 0, no summary);
- clears `autoPausedReason` if it was "finished";
- leaves `enabled` as is;
- returns `{context, contexts, queue}`.

### Scheduler

- `postingAccountId(ctx)` is `state.nextSpeakerAccountId` in conversation mode, otherwise `accountId`.
  It is used in `canFireNow` and `getBlockedReason`, e.g. "Next speaker @x: cooldown 9m" or
  "…disconnected".
- **Blocked speaker:** the conversation waits and never skips.
  - Interval campaigns stay due and retry every tick.
  - Fixed-time campaigns keep their `pendingFire`.
- **Account removal:** `accountService.remove → pauseCampaignsOf` also matches participants, with
  reason "Participant @x removed…". Resuming checks every participant.
- **Mid-run cast edits:** if `nextSpeakerAccountId` is removed from the cast, the next speaker is
  re-picked from the new cast and persisted in `patchContext`.

### UI

- **Form:**
  - A "Mode" segmented control (Single account / Conversation) under the name.
  - Conversation mode hides:
    - AccountSelect;
    - the Reply and Engagement selectors and the quote fallback;
    - TemplateEditor, the hashtag editors and the theme.
  - It shows `ConversationEditor`:
    - participant rows: account dropdown (excluding accounts already chosen), persona textarea,
      remove button;
    - "Add participant" (up to 5);
    - shared prompt, opening post, opener handle;
    - first speaker select (Random, or the handles present in the opening post);
    - Turns (Unlimited or N).
  - The target label becomes "Opening reply (tweet ID/URL)".
  - Schedule, dry run and webhook stay.
- **Card:**
  - A "Conversation" badge, "Cast: @a · @b · @c" and "Next: @b · Turn 4/20".
  - The finished reason with a **Restart** button that opens `RestartConversationModal`.
  - An excerpt of the shared prompt in place of the template box.
- **Preview:**
  - Shows "Turn 4 · @b → @c" and "Reply to #anchor as @b", with no color slots.
  - Post sends the `conversation` fields.
  - A 409 shows "moved on" and reloads the preview.
- **Queue:**
  - Slot 1 is "@b (next)"; later slots are "random".
  - The preview text is "✨ AI turn, written when it posts".
  - Banner: "Conversation (3 voices)".
- **Logs:** a "@handle · Turn n" chip.

## 5. Risks and edge cases

- **Participant removed or revoked:** the conversation pauses, and resume is refused until the cast is
  fixed. A permanently blocked speaker stalls the thread, so the card's blockedReason names the handle.
- **2 participants:** strict alternation; the form hint says so.
- **X 403 "not mentioned":** `ensureMention` and the save-time validation prevent it. If it still
  happens it is `reply_restricted`: the same speaker retries and the breaker trips after 5 failures.
  The quote fallback is forced off.
- **Anchor deleted on X:** the existing `recoverChain` replies to the opening post instead.
- **Gemini down:** `AgentUnavailableError` (503) leaves state and anchor untouched and uses the
  existing back-off and breaker. Summary failures are swallowed.
- **Dry run:** simulated turns advance `turnCount` and the transcript, but never the anchor.
- **Free tier:** every turn counts against the shared daily app cap.
- **Renamed handle:** a renamed X handle breaks mentions until Verify refreshes it.

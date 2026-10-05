# Conversation campaigns

A **conversation** campaign lets several of your connected X accounts talk to each other in one
thread. Each account speaks with its own AI persona, and each one reads the whole thread so far
before it replies. You set the cast and the topic; the bot does the chatting, one reply per turn, on
your schedule.

Design notes for developers are in [design/conversations.md](design/conversations.md).

## Before you start

- Connect **2 to 5 accounts** in Settings (see [accounts.md](accounts.md)).
- Every participant needs a **known @handle**. Connected accounts get theirs when you connect them.
  If the default account (from environment variables) shows no handle, press **Verify** on it first.
  Saving a conversation without a known handle fails with "Verify @handle first".
- Add a Gemini key. Conversation replies are always written by the AI; there is no fallback text.

## Step by step

1. **Post the opening reply yourself.** On X, reply to any post (or start a thread) and `@mention`
   the accounts that should speak first. X only lets an app reply to a post its account wrote or was
   mentioned in, so the mention is what makes the first turn possible.
2. In the app, create a campaign and set **Mode: Conversation**.
3. Add the **participants**: pick an account for each row and write a short **persona** (for example
   "dry, loves puns, hates mornings"). Keep personas similar in spirit but distinct in voice.
4. Write the **shared prompt**: the premise and tone for everyone ("Three friends argue about tea
   versus coffee, warmly").
5. Paste the **opening reply URL** (or tweet ID) into the target field, and its exact text into
   **Opening post**. The AI never reads X; it only knows what you paste here. Fill in **opener
   handle** (the account that posted it, without `@`).
6. Choose the **first speaker** (Random, or one of the handles mentioned in the opening post) and the
   number of **turns** (Unlimited, or N).
7. Save. Use **Preview** to see the next turn, **Post** to send it now, or let the schedule take over.

## How turns work

- The speaker is picked **at random**, but the same account never speaks twice in a row. With two
  participants that means strict alternation.
- Every turn **ends by `@mentioning` the next speaker**. The next speaker is chosen before the
  current turn is written, so preview, queue and post all agree. This handoff is not decoration: X
  rejects a reply to a post that does not mention the replying account.
- If the AI forgets the mention, the app adds it. Any other `@handle` the AI invents (a stranger, a
  celebrity) is turned into plain text so nobody gets notified by accident. Replies are kept within
  280 characters.
- Each reply goes to the previous turn's tweet, so the whole run forms one thread.
- Long conversations stay affordable: the last 15 turns are sent word for word and older ones are
  folded into a short summary.
- Hashtags are off, and a dry run advances the conversation (turns and transcript) without posting.

## Restart

Use **Restart** on the campaign card to begin a new thread. To keep going in the same thread after a fixed number of turns, just **Resume** the campaign: it continues for another N turns (a new round), with the full history.
Give it a new opening reply URL and text, and optionally a first speaker. The turn count goes back
to 0 and the AI starts with a clean transcript. Old posts stay in the logs. Restart does not change
whether the campaign is enabled: resume it if it was paused.

## What pauses a conversation

| Event | Effect |
| --- | --- |
| It reaches the turn limit | Pauses with "Conversation finished (N turns)". **Resume** continues the same thread for another N turns; **Restart** begins a new thread. |
| A participant is removed | Pauses with "Participant @x removed...". Resuming is refused until the cast is fixed. |
| A participant's tokens are revoked (X answers 401) | The campaign auto-pauses. Verify or reconnect the account. |
| 5 failures in a row | The circuit breaker pauses it. After each failure it also backs off for 15 minutes. |

A failed turn (X error, AI down) changes nothing: the same account tries again next time, and the
thread keeps pointing at the last tweet that was really posted. If the next speaker is on cooldown or
disconnected, the conversation waits for them; it never skips them. The card names who is blocking.

## Limits and rules

- **Free X tier:** 17 posts per 24 h for the whole app, shared by every account (see
  [accounts.md](accounts.md#limits-per-account-or-per-app)). Every turn counts, so a 5-voice chat
  burns through the day quickly.
- **Automation rules:** X expects accounts that post automatically to be labelled as automated, and
  asks that several accounts not be used to amplify the same content. Mark each bot account as
  **Automated** in its X settings, keep the topic genuine and the volume modest.
- Conversation campaigns ignore the Reply, Engagement, template, theme and hashtag settings; they
  always reply, and never fall back to quoting.

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| X answers **403** (reply not allowed, "not mentioned") | The account being replied as was not mentioned in the post it replies to. Check the opening reply mentions the first speaker, and that handles are current. A renamed handle breaks mentions until you **Verify** the account. |
| "Verify @handle first" | A participant has no known handle. Open Settings and Verify that account. |
| "AI unavailable" or no new turn | Gemini failed for every model, or the daily Gemini cap is used up. Nothing was posted and nothing changed; it retries after the back-off. Check the key and the cap. |
| "Conversation moved on, refresh the preview" | Another post (a tick or a second tab) happened after you previewed. Preview again. |
| "A drop for this campaign is already running" | A post is in flight. Wait a moment and retry. |
| Opening post rejected on save | It must contain the first speaker's `@handle`. |
| Thread stops after the opening reply was deleted on X | The next turn replies to the opening post instead; if that is gone too, Restart with a new one. |

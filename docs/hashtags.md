# Hashtags

Single source of truth: `composeDropText` (`server/services/dropText.ts`), used by the preview route
and by `dropService.executeDrop` (manual, scheduler, webhook, CLI). Pure helpers live in
`shared/hashtags/` (`campaignTags.ts`, `agentText.ts`).

## Campaign hashtags live outside the template

- `TweetContext.hashtags: string[]` is the campaign's own tag set (normalised, de-duplicated, max 10).
- Boot migration (once per campaign, idempotent): when `hashtags` is undefined, the template's
  literal tags (outside `<agent>` prompts; `{weather_tweet}`, `#1`, hex codes are left alone) move into
  `hashtags` and are removed from the template, tidying only the touched lines. A tags-only last line
  leaves a line break, so the block is appended on its own line again. If nothing but tags would
  remain, the template is kept and `hashtags` is `[]`. The move is logged (`[Context] Moved template
  hashtags…`). Create (without `hashtags`), the primary campaign and the legacy importer do the same.
- The template renders the **body** (static text + AI text). The **tag block** is appended after it:
  one space, or directly after the line break when the body ends with a newline.

## Which tags

| Evolution | Campaign `hashtags` | Tag block |
| --- | --- | --- |
| off | set | the campaign hashtags as-is |
| off | empty | none (AI tags, if any, stay as the model wrote them) |
| on | any | evolved tags (`hashtagService.next`) |

Evolution seed: campaign `hashtags` → else the previous evolved tags (`hashtagState.current`) → else the
AI's own trailing tags of this drop (folded in, see below) → else a neutral theme from the template /
agent prompt keywords (love, devotion, poem→#poetry, time→#timeless …; never color terms), else
`#poetry`. `#colors` and the color name are only used when the template has color tokens
(`templateUsesColor`). `keepSeedTags` keeps some of the campaign's own `hashtags` (never a theme seed).

## Conversation campaigns

Conversation turns use the same table (built in `conversationService.buildTurn`, not
`composeDropText`). Differences:

- There is no template: an evolution with no campaign `hashtags` and no previous tags starts from a
  neutral theme of the conversation's premise. The Gemini prompt gets the premise and the latest turn
  as the topic (no color name), so the tags follow what is being talked about.
- The tags aim for **reach**: popular, established tags people follow and search for the subject
  (`#Coffee`, `#FlyFishing`), not invented compounds. Only the last two sets are off limits (color
  drops avoid the last ~40), and the campaign's own hashtags may come back, so a conversation rotates
  among the popular tags instead of drifting to obscure ones.
- **Trending on X** (optional): with `X_TRENDS_WOEID` set (repo variable in production; `1` =
  worldwide, `23424977` = United States), the prompt also lists what is trending there and may use
  one only if it truly fits the subject. The trends endpoint is not on X's Free or Basic plans (Pro, or
  pay-per-use at about $0.01 a call); it is cached for an hour and, if X refuses it, off for a day.
  `server/services/trendService.ts`.
- The tag block's room is reserved before the turn is written, after the @mentions.
- Hashtags the model writes anyway are removed: a trailing run is dropped, a `#word` inside a sentence
  becomes `word`.
- `hashtagState` advances only after a posted (live or simulated) turn of the same run; the preview
  echoes the turn's evolved tags back with Post.
- New conversation campaigns start with no `hashtags` (the color campaign's `#eternal #colors` default
  is not carried over).

## Hashtags the AI writes

When the campaign has a tag block (own hashtags or evolution on) the model is told:
"Do not write any hashtags (no #words): the app adds the hashtags itself." If it still does:

- a **trailing cluster** (≥ 2 tags, or 1 tag after a sentence end / line break) is lifted out of the
  body. With evolution on, those tags are candidates: they replace evolved tags from the end (at most
  half the evolving slots, never kept campaign tags, never recent ones, and only if the block does not
  get longer than the room reserved for it). They are never posted twice.
- **inline** tags are de-hashed to words: "this #love burns" → "this love burns", `#EternalLove` →
  "Eternal Love".
- **expressions** are left alone: `#1`, `#2026`, hex codes (`#C03F0B`), `C#`, URL `#fragments`,
  HTML entities (`&#39;`). Emoji in a cluster stay in the body.

Without a tag block (evolution off, no campaign hashtags) the AI's tags stay, minus duplicates of the
template's literal tags or of each other; its trailing tags are dropped from the end if they would push
the tweet past 280.

Across the whole tweet no hashtag appears twice (case-insensitive; `#Eternal_Love` = `#eternallove`):
body tags that are already in the block (e.g. `{weather_tweet}`'s `#eternal #colors`) are removed when
they sit among tags and de-hashed when they are part of a sentence.

## Length

The tag block is planned first. Each `<agent>` text gets `280 − static text − tag block` (split across
agent blocks, capped at 240, min 40); a too-long draft is regenerated once and then trimmed with
`trimToCompleteSentence`. If a complete sentence only fits without the block, the complete sentence
wins and trailing tags are dropped (`droppedTags`) — the AI text is never cut mid-sentence to fit tags.

## State

`hashtagState` advances only for the campaign that posted, only after a successful (live or
simulated) post, and records exactly the evolved tags present in the posted text. Preview never
advances it; post-now with the previewed `text` + `hashtags` posts exactly that text. Scheduler,
webhook and CLI compose fresh. Two campaigns with the same template evolve independently.
Queue slot previews append the campaign `hashtags` (evolved tags are picked at post time).

## Preview `breakdown`

See `docs/api.md`. Recommended UI (campaign form + campaign card preview):

- Campaign form, under the template: **Hashtags** input (chips or space-separated, `#` optional,
  max 10) saved to `hashtags`; the **Evolve hashtags** toggle (+ max tags, keep my hashtags) next to it.
- Under the preview text, one line built from `breakdown`:
  - `tagSource: 'campaign'` → "Your hashtags: #a #b"
  - `tagSource: 'evolved'` → "Evolved hashtags: #a #b (from: your hashtags | last post | AI's tags |
    prompt theme)" (+ "AI's own tags folded in: #x" when `foldedAiTags`)
  - `removedAiHashtags` → "Removed from AI text: #x #y"; `dehashedAiHashtags` → "Kept as words: love"
  - `removedDuplicateTags` → "Duplicate removed: #colors"; `droppedTags` → "Dropped to fit 280: #z"
  - When `aiText` is set, show the static and AI parts distinctly (e.g. AI part in italics).

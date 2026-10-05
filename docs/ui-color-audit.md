# UI color audit

The app started as a color bot, so the UI grew around the drop color (swatches, palettes, color
metrics) even for campaigns whose templates never mention a color. This audit lists every
color-centric UI element and what happens to it. Scope is **UI only**: the color engine, template
substitution, `/api/*` contracts, the scheduler and `dropService` are unchanged, so a template that
uses a color token still gets its color generated server-side (or by `/api/generate-color` for the
Studio preview) and posts exactly as before.

Legend:

- **REMOVE**: purely decorative / color-only, deleted.
- **GENERALIZE**: the function stays, the presentation becomes template-agnostic.
- **KEEP**: needed as is (reason given).
- **CONDITIONAL**: only shown when the template uses a color token, see
  `templateUsesColor()` in `src/lib/templateTokens.ts` (pure, client-only, derived from the shared
  `TEMPLATE_TOKENS`; no behaviour change, no change under `shared/`).

Color tokens are every entry of `TEMPLATE_TOKENS` except `{time_tag}`, plus the undocumented aliases
`substituteTemplate()` also fills from the color (`{weather_description}`, `{companions}`).
`{weather_desc}` / `{weather_tweet}` count as color tokens because the weather line comes from the
color engine.

## Header / nav (`src/components/Header.tsx`)

| Element | Class | Notes |
| --- | --- | --- |
| Amber/rose/indigo gradient brand dot | REMOVE | Decorative rainbow; replaced by a neutral dot so the brand link keeps its shape |
| "ChromaBot" name, "Log out of ChromaBot" | KEEP | Product name, not a color UI element; renaming the product is out of scope |
| Quick "Post Reply" button (posts with the Studio's current color) | KEEP | Same call as before; the color is an invisible input for color templates |
| Status colors on quota / dry-run / pause chips (amber, emerald, rose) | KEEP | Semantic state colors, not drop colors |

## Status bar (`src/components/StatusBar.tsx`)

| Element | Class | Notes |
| --- | --- | --- |
| Countdown, frequency select, target link, pause link | KEEP | No color-centric content |

## Studio (`src/features/studio/*`)

| Element | Class | Notes |
| --- | --- | --- |
| `ColorCanvas`: swatch hero filled with the drop hex, color name + mood | REMOVE | Whole component deleted |
| `ColorCanvas`: hex copy button, HEX/RGB/HSL/CMYK metrics grid | REMOVE | The values still reach the tweet through `{hex}`, `{rgb}`… and are visible in the preview text |
| `ColorCanvas`: "Harmonious Palette Bar" (base + companions) | REMOVE | Decorative |
| "Chromatic Post Studio" title | GENERALIZE | "Post Studio" |
| Slot picker "Morning Dawn / Evening Dusk / Random Pick" (re-rolls the color from the sunrise / sunset / random palette) | CONDITIONAL + GENERALIZE | Only meaningful for color templates; shown as a compact "Color" re-roll control (Morning / Evening / Random). The selected slot still defaults to `morning` and is still sent as `slotType`, so posts and logs are unchanged |
| Layout: 7/5 grid with the canvas on the left | GENERALIZE | Single centered column built around the tweet preview and the Post action |
| `TweetPreviewCard` weather breakdown row (`color.weatherDesc` + `#eternal #colors` chip) | REMOVE | Duplicates what the preview text already shows and is wrong for non-color templates (and for evolved hashtags) |
| `TweetPreviewCard` X preview text, char counter, AI/hashtag badges and re-roll, reply target, Post button, mode line | KEEP | Core of the Studio |
| `TweetMockup` avatar filled with the drop hex and a 🎨 emoji | GENERALIZE | Neutral avatar |
| Loading gate copy "Loading Chroma Engine..." | GENERALIZE | "Loading studio..." (the gate stays: the preview of a color template needs the color) |
| `PostResultToast` | KEEP | No color content |

## Queue (`src/components/QueueViewer.tsx`)

| Element | Class | Notes |
| --- | --- | --- |
| Card swatch header filled with the slot hex, hex chip, color name | REMOVE | Replaced by a plain header: slot number, date, time + timezone, morning/evening icon |
| Companion color dots + "RGB r,g" footer | REMOVE | Decorative |
| Queued message preview | GENERALIZE | Now the body of the card (the upcoming post text); the color-flavoured fallback text is replaced by a neutral "composed when it posts" note |
| "Re-roll" (new color + preview for one slot) | CONDITIONAL | Shown only when the slot's campaign template uses a color token; for other templates it changed nothing visible |
| Send button (title "Send this color reply immediately") | GENERALIZE | Same call (`post-now` with the slot's color, slot type and `slotId`), title "Send this post now" |
| "Clear & Regenerate Queue" tooltip "fresh colors & template previews" | GENERALIZE | "fresh template previews"; the action is unchanged |
| Campaign banner (target, mode, schedule, template) | KEEP | Template-agnostic already |

## History (`src/components/HistoryTable.tsx`)

| Element | Class | Notes |
| --- | --- | --- |
| "Color Swatch" column (hex square, color name, hex) | GENERALIZE | Replaced by a "Tweet" column showing the posted text (the log still stores `color`) |
| Time & slot, status, tweet reference, actions, filters, clear | KEEP | No color content |

## Campaigns (`src/features/campaigns/*`)

| Element | Class | Notes |
| --- | --- | --- |
| Name placeholder "Primary Eternal Colors, Morning Art Thread…" | GENERALIZE | Neutral examples |
| Card template text, hashtags, schedule, modes, actions | KEEP | Template-agnostic |
| New-campaign default template `{color_pick} {weather_desc} #eternal #colors` (`useContextForm`) | KEEP | Content default that mirrors the server's `DEFAULT_TWEET_TEMPLATE`; changing it would change what new campaigns post |
| Form `TemplateEditor` | see below | |

## Template editor (`src/components/TemplateEditor.tsx`, `templatePresets.ts`), used by Campaigns and Settings

| Element | Class | Notes |
| --- | --- | --- |
| Blue highlight on `{color_pick}`, `{weather_desc}`, `{weather_tweet}` token buttons | GENERALIZE | All token buttons styled the same; color tokens are no longer promoted |
| Token buttons (incl. color tokens) | KEEP | Needed to author color templates; tokens must keep working |
| Agent snippets that embed `{color_pick}` ("Write a poetic expression for {color_pick}") | GENERALIZE | Snippets no longer inject a color token |
| "Swatch + History Arc" preset (uses `{color_pick} {hex}`) | KEEP | A content preset for color campaigns, one of three; picking it is opt-in |
| "Reset to Default Formula" (`DEFAULT_TEMPLATE`) | KEEP | Mirrors the server default |
| Live Preview & Agent Test | KEEP | AI test |

## Settings (`src/features/settings/*`)

| Element | Class | Notes |
| --- | --- | --- |
| Copy "drops colors", "new color reply" | GENERALIZE | "posts", "new reply" |
| `WebhookSettings` copy "chromatic reply" | GENERALIZE | "reply" |
| Toggles, schedule, jitter, target, template | KEEP | |

## Credentials, modals, banners, footer

| Element | Class | Notes |
| --- | --- | --- |
| `TargetTweetEditor` copy "automated chromatic color drops", "publishes chromatic drops" | GENERALIZE | "automated drops", "publishes drops" |
| `TwitterSetup`, `RateLimitModal`, `CooldownBanner`, `ConfirmDialog`, `AuthGate` | KEEP | Only semantic status colors / progress bars |
| `Footer` | KEEP | No color content |

## README

The README describes the default campaign (sunrise / sunset colors, `#eternal #colors`). That is the
product's default content, not UI chrome, and it has no screenshots: KEEP.

## Counts

| Page | REMOVE | GENERALIZE | CONDITIONAL | KEEP |
| --- | --- | --- | --- | --- |
| Header / nav | 1 | 0 | 0 | 3 |
| Status bar | 0 | 0 | 0 | 1 |
| Studio | 4 | 4 | 1 | 2 |
| Queue | 2 | 3 | 1 | 1 |
| History | 0 | 1 | 0 | 1 |
| Campaigns | 0 | 1 | 0 | 2 |
| Template editor | 0 | 2 | 0 | 4 |
| Settings | 0 | 2 | 0 | 1 |
| Credentials / modals / footer | 0 | 1 | 0 | 2 |

## API endpoints

No endpoint becomes unused by the UI:

- `POST /api/generate-color` is still called (initial load, campaign switch, Studio color re-roll):
  the Studio preview and `post-now` need a color so that color templates post exactly what the
  preview shows. Skipping it for non-color templates would make `post-now` pop a queue slot for
  its color instead, which changes behaviour, so it is kept for every template.
- `POST /api/queue/reroll` is still called, but only for slots whose campaign template uses a color
  token.

All endpoints and payloads are unchanged.

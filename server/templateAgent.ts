/**
 * Template Agent Engine for X ChromaBot
 * Expands template syntax with:
 *   <agent>PROMPT</agent>
 *   <history><agent>PROMPT</agent></history>
 * Powered by Google Gemini (models configurable via GEMINI_MODEL / GEMINI_FALLBACK_MODEL)
 * for poetic, evocative generation.
 */

import { templateUsesColor } from '../shared/template/colorTokens.js';
import { HttpError } from './middleware/error.js';
import type { ColorData, PostLog } from '../shared/types.js';
import { services } from './services/index.js';
import { formatTimeInZone } from '../shared/time.js';
import { substituteTemplate } from '../shared/template/substitute.js';
import {
  COMBINED_HISTORY_AGENT_REGEX,
  STANDALONE_AGENT_REGEX,
  stripHistoryTags,
} from '../shared/template/agentTags.js';
import { getGeminiClient } from './geminiClient.js';
import { getGeminiTimeoutMs } from './timeouts.js';
import { getGeminiModels, isGeminiConfigured, tryConsumeGeminiCall } from './geminiConfig.js';
import { AGENT_TARGET_LENGTH, weightedTweetLength } from '../shared/tweetLength.js';
import { errorMessage } from './errorMessage.js';
import { finishAgentText, type ShapedAgentText } from '../shared/hashtags/agentText.js';
import {
  cleanAgentOutput,
  plainShape,
  stripColorHeader,
  type AgentTextOptions,
} from './agentOutput.js';

export { cleanAgentOutput, stripColorHeader, type AgentTextOptions };

export const POETRY_AGENT_SYSTEM_INSTRUCTION = `You are a world-class literary poet and creative writer specializing in atmospheric, earthy, and profound short-form poetry and expressions, channeling voices like Pablo Neruda, Mary Oliver, Octavio Paz, and Federico García Lorca.

Your mission is to generate the exact body of a tweet from the user's directive and any previous series history provided (and the drop color, only when one is given).

STRICT CONSTRAINTS:
1. Output ONLY the exact tweet body.
2. NEVER include conversational filler, preamble ("Here is a poem:"), explanations, or surrounding quotation marks.
3. Length: Strictly under 240 characters to fit Twitter/X limits seamlessly. Always end on a complete sentence.
4. If series history is provided, consider what has already been said in the series and let this drop build on, harmonize with, or poignantly contrast the arc of the series thus far.
5. Inhabit the requested style deeply (e.g., Pablo Neruda's visceral metaphors, earthy resonance, intimate cosmic scope).
6. Never prefix the tweet with a color name, hex code, label, or "Name (#HEX) —" header.`;

export interface ResolveTemplateOptions {
  slotLabel?: string;
  contextId?: string;
  targetTweetId?: string;
  forceFreshAgent?: boolean;
  agent?: AgentTextOptions;
}

/**
 * Replace basic variables in a string
 */
export function substituteVariables(text: string, color: ColorData, slotLabel?: string): string {
  return substituteTemplate(text, color, { slotLabel });
}

/**
 * Fetch chronological series history for context or target tweet
 */
export function getSeriesHistory(
  contextId?: string,
  targetTweetId?: string,
  limitCount = 10,
): PostLog[] {
  const allLogs = services.logs.getLogs(); // returns newest first
  // Same context only (no cross-context fallback); successful posts only.
  const matches = (log: PostLog) =>
    contextId
      ? log.contextId === contextId
      : !!targetTweetId && log.targetTweetId === targetTweetId;
  const filtered = allLogs.filter((log) => log.status === 'success' && matches(log));

  // Take most recent entries and reverse to chronological order (oldest to newest)
  return filtered.slice(0, limitCount).reverse();
}

/**
 * Format series history into a readable timeline for the agent
 */
export function formatHistoryForPrompt(history: PostLog[], includeColor = true): string {
  if (history.length === 0) {
    return 'No previous tweets in this series yet. This is the debut/opening drop.';
  }

  return history
    .map((log, idx) => {
      const date = log.timestamp ? log.timestamp.split('T')[0] : 'Past';
      const slot = log.slotType || 'drop';
      if (!includeColor) return `[Entry ${idx + 1}] (${date} - ${slot}):\n"${log.tweetText}"`;
      const colName = log.color?.name || 'Color';
      const hex = log.color?.hex || '';
      return `[Entry ${idx + 1}] (${date} - ${slot} | ${hex} ${colName}):\n"${log.tweetText}"`;
    })
    .join('\n\n');
}

/** Thrown when an AI-only (no color tokens) template cannot be generated; the drop fails visibly instead of posting color filler. */
export class AgentUnavailableError extends HttpError {
  constructor(message: string) {
    super(503, message);
  }
}

/** The user prompt for one `<agent>` block (color context only for color templates). */
function buildAgentContents(
  userPrompt: string,
  color: ColorData,
  history: PostLog[] | null,
  slotLabel: string | undefined,
  includeColor: boolean,
  agent: AgentTextOptions,
): string {
  const max = agent.maxLength ?? AGENT_TARGET_LENGTH;
  const timeTag = slotLabel || formatTimeInZone(new Date());
  const resolvedPrompt = substituteVariables(userPrompt, color, timeTag);

  // Templates without color tokens get no color context at all, so the model can't echo it.
  let contents = includeColor
    ? `CURRENT DROP COLOR & CONTEXT:
- Color Name: ${color.colorPick || color.name}
- Hex Code: ${color.hex}
- RGB: (${color.rgb.r}, ${color.rgb.g}, ${color.rgb.b})
- Mood & Atmospheric Impression: ${color.mood}
- Weather / Sky Condition: ${color.weatherDesc}
- Drop Time Slot: ${timeTag} (${color.slotType})\n\n`
    : `CURRENT CONTEXT:\n- Time: ${timeTag}\n\n`;

  if (history !== null) {
    contents += `TWEET SERIES HISTORY TO BUILD UPON:
${formatHistoryForPrompt(history, includeColor)}\n\n`;
  }

  contents += `USER DIRECTIVE FOR THIS TWEET:
${resolvedPrompt}
${agent.directive ? `\n${agent.directive}\n` : ''}
Remember: Output ONLY the exact tweet text (no quotes, no intro, under ${max} chars).`;
  return contents;
}

/** One draft, regenerated once with a stricter reminder when it is over `max` (shorter wins). */
async function draftWithRetry(
  call: (prompt: string) => Promise<string>,
  contents: string,
  shape: (text: string) => ShapedAgentText,
  max: number,
): Promise<ShapedAgentText> {
  const draft = shape(await call(contents));
  const draftLength = weightedTweetLength(draft.body);
  if (!draft.body || draftLength <= max) return draft;
  try {
    const retry = shape(
      await call(
        `${contents}\n\nYour previous draft was too long (${draftLength} chars). Write a shorter version, strictly under ${max} characters.`,
      ),
    );
    if (retry.body && weightedTweetLength(retry.body) < draftLength) return retry;
  } catch {
    // keep the first draft; it is trimmed to a complete sentence afterwards
  }
  return draft;
}

export interface GenerateAgentTextOptions {
  systemInstruction: string;
  /** Weighted-char budget; longer drafts are retried once, then trimmed to a complete sentence. */
  maxLength: number;
  /** Complete-sentence ceiling when the shaped body needs less room (defaults to `maxLength`). */
  hardMaxLength?: number;
  temperature?: number;
  /** Applies the hashtag rules to a raw draft (defaults to plain). */
  shape?: (text: string) => ShapedAgentText;
  /** Extra clean-up of each model reply (after `cleanAgentOutput`). */
  clean?: (text: string) => string;
  /** Receives the finished text (for the preview breakdown). */
  onText?: AgentTextOptions['onText'];
}

/**
 * One Gemini generation: tries every configured model (shared daily cap, timeout), regenerates a
 * too-long draft once and finishes on a complete sentence. Throws `AgentUnavailableError` when AI is
 * not configured or every model fails (callers decide on any fallback text).
 */
/** One line from a Gemini error for the log: no API keys, at most 160 chars. */
export function shortReason(err: unknown): string {
  const raw = (errorMessage(err) || String(err)).replace(/\s+/g, ' ').trim();
  // The Gemini SDK can echo a JSON body; keep its "message" when present.
  const inner = /"message"\s*:\s*"([^"]+)"/.exec(raw)?.[1];
  const text = (inner ?? raw).replace(/(key=|AIza)[\w-]+/g, '$1…');
  return text.length > 160 ? `${text.slice(0, 157)}…` : text || 'unknown error';
}

export async function generateAgentText(
  contents: string,
  opts: GenerateAgentTextOptions,
): Promise<string> {
  const max = opts.maxLength;
  const shape = opts.shape ?? plainShape;
  if (!isGeminiConfigured())
    throw new AgentUnavailableError('AI generation is not configured (GEMINI_API_KEY).');

  const callModel = async (model: string, prompt: string): Promise<string> => {
    if (!tryConsumeGeminiCall()) throw new Error('GEMINI_MAX_CALLS_PER_DAY reached');
    const response = await getGeminiClient().models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction: opts.systemInstruction,
        temperature: opts.temperature ?? 0.9,
        abortSignal: AbortSignal.timeout(getGeminiTimeoutMs()),
      },
    });
    const cleaned = cleanAgentOutput(response.text ?? '');
    return opts.clean ? opts.clean(cleaned) : cleaned;
  };

  // Why each model failed: shown in the drop's log entry, not only in the server log.
  const reasons: string[] = [];
  for (const model of getGeminiModels()) {
    try {
      const draft = await draftWithRetry((p) => callModel(model, p), contents, shape, max);
      if (draft.body) {
        const done = finishAgentText(draft, max, opts.hardMaxLength ?? max);
        opts.onText?.({ text: done.text, shaped: draft, droppedTail: done.droppedTail });
        return done.text;
      }
      reasons.push(`${model}: empty response`);
    } catch (err) {
      console.warn(
        `[TemplateAgent] Model ${model} encountered an issue:`,
        errorMessage(err) || err,
      );
      reasons.push(`${model}: ${shortReason(err)}`);
      // continue to next model in loop
    }
  }
  throw new AgentUnavailableError(
    `AI generation failed for every configured model${reasons.length ? ` (${reasons.join('; ')})` : ''}.`,
  );
}

/**
 * Call Gemini AI to generate poetic tweet content
 */
export async function generatePoeticAgentText(
  userPrompt: string,
  color: ColorData,
  history: PostLog[] | null,
  slotLabel?: string,
  includeColor = true,
  agent: AgentTextOptions = {},
): Promise<string> {
  const max = agent.maxLength ?? AGENT_TARGET_LENGTH;
  const contents = buildAgentContents(userPrompt, color, history, slotLabel, includeColor, agent);

  try {
    return await generateAgentText(contents, {
      systemInstruction: POETRY_AGENT_SYSTEM_INSTRUCTION,
      maxLength: max,
      hardMaxLength: agent.hardMaxLength,
      shape: agent.shape,
      onText: agent.onText,
      clean: includeColor ? undefined : stripColorHeader,
    });
  } catch (err) {
    // A color template falls back to its color mood; a non-color template must not post color text.
    if (!includeColor || !(err instanceof AgentUnavailableError)) throw err;
    const fallback = `${color.colorPick} (${color.hex}) — ${color.mood}`;
    agent.onText?.({ text: fallback, shaped: plainShape(fallback), droppedTail: [] });
    return fallback;
  }
}

/**
 * Main Template Resolver
 * Parses:
 *  - <history><agent>PROMPT</agent></history>
 *  - <agent><history>PROMPT</history></agent>
 *  - <agent history="true">PROMPT</agent>
 *  - <agent>PROMPT</agent>
 * along with all standard variables {color_pick}, {hex}, etc.
 */
export async function resolveTemplateText(
  template: string,
  color: ColorData,
  options: ResolveTemplateOptions = {},
): Promise<string> {
  if (!template) {
    return `${color.colorPick || color.name} ${color.hex} #eternal #colors`;
  }

  let processed = template;
  const includeColor = templateUsesColor(template);

  // 1. Process combined history + agent tags
  const combinedHistoryAgentRegex = new RegExp(COMBINED_HISTORY_AGENT_REGEX);
  const historyMatches = Array.from(processed.matchAll(combinedHistoryAgentRegex));

  for (const match of historyMatches) {
    const fullMatch = match[0];
    const prompt = (match[1] || match[2] || match[3] || '').trim();
    const history = getSeriesHistory(options.contextId, options.targetTweetId);

    const generated = await generatePoeticAgentText(
      prompt,
      color,
      history,
      options.slotLabel,
      includeColor,
      options.agent,
    );

    processed = processed.replace(fullMatch, () => generated);
  }

  // 2. Process standalone <agent>...</agent> tags
  const standaloneAgentRegex = new RegExp(STANDALONE_AGENT_REGEX);
  const agentMatches = Array.from(processed.matchAll(standaloneAgentRegex));

  for (const match of agentMatches) {
    const fullMatch = match[0];
    const prompt = match[1].trim();

    const generated = await generatePoeticAgentText(
      prompt,
      color,
      null,
      options.slotLabel,
      includeColor,
      options.agent,
    );

    processed = processed.replace(fullMatch, () => generated);
  }

  // 3. Clean any rogue <history>...</history> tags if left
  processed = stripHistoryTags(processed);

  // 4. Substitute all remaining variables
  return substituteVariables(processed, color, options.slotLabel);
}

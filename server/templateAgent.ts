/**
 * Template Agent Engine for X ChromaBot
 * Expands template syntax with:
 *   <agent>PROMPT</agent>
 *   <history><agent>PROMPT</agent></history>
 * Powered by Google Gemini (models configurable via GEMINI_MODEL / GEMINI_FALLBACK_MODEL)
 * for poetic, evocative generation.
 */

import { GoogleGenAI } from '@google/genai';
import type { ColorData, PostLog } from '../shared/types.js';
import { services } from './services/index.js';
import { formatTimeInZone } from '../shared/time.js';
import { substituteTemplate } from '../shared/template/substitute.js';
import {
  COMBINED_HISTORY_AGENT_REGEX,
  STANDALONE_AGENT_REGEX,
  stripHistoryTags,
} from '../shared/template/agentTags.js';
import { getGeminiTimeoutMs } from './timeouts.js';
import {
  getGeminiModels,
  getGeminiUserAgent,
  isGeminiConfigured,
  tryConsumeGeminiCall,
} from './geminiConfig.js';
import {
  AGENT_TARGET_LENGTH,
  truncateAtWordBoundary,
  weightedTweetLength,
} from '../shared/tweetLength.js';

let aiClient: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  aiClient ??= new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: { headers: { 'User-Agent': getGeminiUserAgent() } },
  });
  return aiClient;
}

export const POETRY_AGENT_SYSTEM_INSTRUCTION = `You are a world-class literary poet and creative writer specializing in atmospheric, earthy, and profound short-form poetry and expressions, channeling voices like Pablo Neruda, Mary Oliver, Octavio Paz, and Federico García Lorca.

Your mission is to generate the exact body of a tweet based on the color, mood, and any previous series history provided.

STRICT CONSTRAINTS:
1. Output ONLY the exact tweet body.
2. NEVER include conversational filler, preamble ("Here is a poem:"), explanations, or surrounding quotation marks.
3. Length: Strictly under 240 characters to fit Twitter/X limits seamlessly.
4. If series history is provided, consider what has already been said in the series and let this drop build on, harmonize with, or poignantly contrast the arc of the series thus far.
5. Inhabit the requested style deeply (e.g., Pablo Neruda's visceral metaphors, earthy resonance, intimate cosmic scope).`;

export interface ResolveTemplateOptions {
  slotLabel?: string;
  contextId?: string;
  targetTweetId?: string;
  forceFreshAgent?: boolean;
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
export function formatHistoryForPrompt(history: PostLog[]): string {
  if (history.length === 0) {
    return 'No previous tweets in this series yet. This is the debut/opening drop.';
  }

  return history
    .map((log, idx) => {
      const date = log.timestamp ? log.timestamp.split('T')[0] : 'Past';
      const slot = log.slotType || 'drop';
      const colName = log.color?.name || 'Color';
      const hex = log.color?.hex || '';
      return `[Entry ${idx + 1}] (${date} - ${slot} | ${hex} ${colName}):\n"${log.tweetText}"`;
    })
    .join('\n\n');
}

/** Strip accidental enclosing quotes and markdown fences from model output. */
export function cleanAgentOutput(raw: string): string {
  let text = raw.trim();
  if (text.startsWith('"') && text.endsWith('"') && text.length > 2) {
    text = text.substring(1, text.length - 1).trim();
  }
  if (text.startsWith('“') && text.endsWith('”') && text.length > 2) {
    text = text.substring(1, text.length - 1).trim();
  }
  return text
    .replace(/^```[a-z]*\n?/i, '')
    .replace(/\n?```$/i, '')
    .trim();
}

/**
 * Call Gemini AI to generate poetic tweet content
 */
export async function generatePoeticAgentText(
  userPrompt: string,
  color: ColorData,
  history: PostLog[] | null,
  slotLabel?: string,
): Promise<string> {
  const timeTag = slotLabel || formatTimeInZone(new Date());
  const resolvedPrompt = substituteVariables(userPrompt, color, timeTag);

  let contents = `CURRENT DROP COLOR & CONTEXT:
- Color Name: ${color.colorPick || color.name}
- Hex Code: ${color.hex}
- RGB: (${color.rgb.r}, ${color.rgb.g}, ${color.rgb.b})
- Mood & Atmospheric Impression: ${color.mood}
- Weather / Sky Condition: ${color.weatherDesc}
- Drop Time Slot: ${timeTag} (${color.slotType})\n\n`;

  if (history !== null) {
    contents += `TWEET SERIES HISTORY TO BUILD UPON:
${formatHistoryForPrompt(history)}\n\n`;
  }

  contents += `USER DIRECTIVE FOR THIS TWEET:
${resolvedPrompt}

Remember: Output ONLY the exact tweet text (no quotes, no intro, under 240 chars).`;

  const fallback = `${color.colorPick} (${color.hex}) — ${color.mood}`;
  if (!isGeminiConfigured()) return fallback;

  const callModel = async (model: string, prompt: string): Promise<string> => {
    if (!tryConsumeGeminiCall()) throw new Error('GEMINI_MAX_CALLS_PER_DAY reached');
    const response = await getClient().models.generateContent({
      model,
      contents: prompt,
      config: {
        systemInstruction: POETRY_AGENT_SYSTEM_INSTRUCTION,
        temperature: 0.9,
        abortSignal: AbortSignal.timeout(getGeminiTimeoutMs()),
      },
    });
    return cleanAgentOutput(response.text ?? '');
  };

  for (const model of getGeminiModels()) {
    try {
      let text = await callModel(model, contents);
      if (text && weightedTweetLength(text) > AGENT_TARGET_LENGTH) {
        // Regenerate once with a stricter reminder, then truncate at a word boundary.
        try {
          const retry = await callModel(
            model,
            `${contents}\n\nYour previous draft was too long (${weightedTweetLength(text)} chars). Write a shorter version, strictly under ${AGENT_TARGET_LENGTH} characters.`,
          );
          if (retry && weightedTweetLength(retry) < weightedTweetLength(text)) text = retry;
        } catch {
          // keep first draft; truncated below
        }
        text = truncateAtWordBoundary(text, AGENT_TARGET_LENGTH);
      }
      if (text) return text;
    } catch (err: any) {
      console.warn(`[TemplateAgent] Model ${model} encountered an issue:`, err.message || err);
      // continue to next model in loop
    }
  }

  // Graceful fallback to rich poetic mood if all models fail
  return fallback;
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

  // 1. Process combined history + agent tags
  const combinedHistoryAgentRegex = new RegExp(COMBINED_HISTORY_AGENT_REGEX);
  const historyMatches = Array.from(processed.matchAll(combinedHistoryAgentRegex));

  for (const match of historyMatches) {
    const fullMatch = match[0];
    const prompt = (match[1] || match[2] || match[3] || '').trim();
    const history = getSeriesHistory(options.contextId, options.targetTweetId);

    const generated = await generatePoeticAgentText(prompt, color, history, options.slotLabel);

    processed = processed.replace(fullMatch, () => generated);
  }

  // 2. Process standalone <agent>...</agent> tags
  const standaloneAgentRegex = new RegExp(STANDALONE_AGENT_REGEX);
  const agentMatches = Array.from(processed.matchAll(standaloneAgentRegex));

  for (const match of agentMatches) {
    const fullMatch = match[0];
    const prompt = match[1].trim();

    const generated = await generatePoeticAgentText(prompt, color, null, options.slotLabel);

    processed = processed.replace(fullMatch, () => generated);
  }

  // 3. Clean any rogue <history>...</history> tags if left
  processed = stripHistoryTags(processed);

  // 4. Substitute all remaining variables
  return substituteVariables(processed, color, options.slotLabel);
}

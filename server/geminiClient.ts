/**
 * Shared lazily-created Gemini client (template agent and hashtag evolution).
 */

import { GoogleGenAI } from '@google/genai';
import { getGeminiUserAgent } from './geminiConfig.js';

let aiClient: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI {
  aiClient ??= new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: { headers: { 'User-Agent': getGeminiUserAgent() } },
  });
  return aiClient;
}

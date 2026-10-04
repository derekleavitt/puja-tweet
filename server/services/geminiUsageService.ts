/**
 * Gemini daily call counter backed by bot state (see `geminiConfig.bindGeminiUsage`).
 */

import type { GeminiUsage, GeminiUsageStore } from '../geminiConfig.js';
import type { StateManager } from './stateManager.js';

export class GeminiUsageService implements GeminiUsageStore {
  constructor(private readonly sm: StateManager) {}

  get(): GeminiUsage {
    return this.sm.state.geminiUsage ?? { day: '', calls: 0 };
  }

  set(usage: GeminiUsage): void {
    const cur = this.sm.state.geminiUsage;
    if (cur && cur.day === usage.day && cur.calls === usage.calls) return;
    this.sm.state.geminiUsage = usage;
    this.sm.persist();
  }
}

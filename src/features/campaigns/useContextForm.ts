/**
 * X ChromaBot - useContextForm
 * State and actions for the create/edit campaign modal.
 */

import React, { useState } from 'react';
import { TweetContext, XAccountInfo } from '../../types.js';
import type { ConversationConfig } from '../../../shared/types.js';
import { DEFAULT_HASHTAG_EVOLUTION } from '../../../shared/hashtags/index.js';
import { extractTweetId } from '../../../shared/tweetId.js';
import { useServerInfo } from '../../context/serverInfo.js';
import { errorMessage } from '../../lib/errors.js';
import { invalidTimes } from './schedule.js';

export const MIN_PARTICIPANTS = 2;
export const MAX_PARTICIPANTS = 5;

/** True when `text` @mentions `handle` (case-insensitive, whole handle); mirrors the server rule. */
export const mentionsHandle = (text: string, handle: string): boolean =>
  /^\w+$/.test(handle) && new RegExp(`(^|[^\\w])@${handle}\\b`, 'i').test(text);

/** Defaults for a new conversation: two rows prefilled with the first two accounts (if any). */
export const defaultConversation = (accounts: XAccountInfo[]): ConversationConfig => ({
  participants: [0, 1].map((i) => ({ accountId: accounts[i]?.id ?? '', persona: '' })),
  sharedPrompt: '',
  openingPost: '',
  openerHandle: '',
});

/** Messages mirroring the server's conversation rules (empty = valid). */
export function conversationIssues(conv: ConversationConfig, accounts: XAccountInfo[]): string[] {
  const issues: string[] = [];
  const rows = conv.participants;
  if (rows.length < MIN_PARTICIPANTS || rows.length > MAX_PARTICIPANTS) {
    issues.push(`A conversation needs ${MIN_PARTICIPANTS} to ${MAX_PARTICIPANTS} participants.`);
  }
  const handleOf = (id: string) => accounts.find((a) => a.id === id)?.handle || '';
  rows.forEach((p, i) => {
    if (!p.accountId) return void issues.push(`Pick an account for participant ${i + 1}.`);
    if (rows.some((q, j) => j < i && q.accountId === p.accountId)) {
      issues.push('Each participant needs its own account (one is listed twice).');
    } else if (!handleOf(p.accountId)) {
      issues.push(`Participant ${i + 1}: Verify in Settings first (no known @handle yet).`);
    }
  });
  const first = rows.find((p) => p.accountId === conv.firstSpeakerAccountId);
  if (conv.firstSpeakerAccountId && !first) {
    issues.push('The first speaker must be one of the participants.');
  } else if (first) {
    const handle = handleOf(first.accountId);
    const opener = (conv.openerHandle ?? '').trim().replace(/^@/, '').toLowerCase();
    if (handle && handle.toLowerCase() === opener) {
      issues.push(`@${handle} posted the opening post, so it cannot also speak first.`);
    } else if (handle && !mentionsHandle(conv.openingPost, handle)) {
      issues.push(`The opening post must mention @${handle} (X only allows replies to mentions).`);
    }
  }
  const turns = conv.maxTurns;
  if (turns !== undefined && !(Number.isInteger(turns) && turns >= 1 && turns <= 500)) {
    issues.push('Turns must be a whole number from 1 to 500.');
  }
  return issues;
}

/** Drops empty optionals so the server sees "random first speaker" / "no opener" / "unlimited". */
const cleanConversation = (c: ConversationConfig): ConversationConfig => {
  const { openerHandle, firstSpeakerAccountId, maxTurns, ...rest } = c;
  const opener = openerHandle?.trim().replace(/^@/, '');
  return {
    ...rest,
    ...(opener ? { openerHandle: opener } : {}),
    ...(firstSpeakerAccountId ? { firstSpeakerAccountId } : {}),
    ...(maxTurns ? { maxTurns } : {}),
  };
};

interface UseContextFormOptions {
  contexts: TweetContext[];
  onCreateContext: (data: Partial<TweetContext>) => Promise<void>;
  onUpdateContext: (id: string, updates: Partial<TweetContext>) => Promise<void>;
}

export function useContextForm(opts: UseContextFormOptions) {
  const { contexts, onCreateContext, onUpdateContext } = opts;
  const { defaultTargetTweetId, accounts = [] } = useServerInfo();
  const [editingContext, setEditingContext] = useState<Partial<TweetContext> | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  /** Account the edited campaign is saved with ('' = default), to warn about chain resets. */
  const [savedAccountId, setSavedAccountId] = useState<string | undefined>(undefined);

  /** Shallow-merges fields into the draft. */
  const patch = (fields: Partial<TweetContext>) =>
    setEditingContext((prev) => (prev ? { ...prev, ...fields } : prev));

  const patchSchedule = (fields: Partial<TweetContext['schedule']>) =>
    setEditingContext((prev) =>
      prev ? { ...prev, schedule: { ...prev.schedule!, ...fields } } : prev,
    );

  /** Switches mode; both configs stay in the draft so switching back loses nothing. */
  const setMode = (mode: 'single' | 'conversation') =>
    setEditingContext((prev) => {
      if (!prev) return prev;
      const conversation =
        mode === 'conversation'
          ? (prev.conversation ?? defaultConversation(accounts))
          : prev.conversation;
      // A new conversation starts without the color campaign's default #eternal #colors.
      const hashtags = mode === 'conversation' && isCreating ? [] : prev.hashtags;
      return { ...prev, mode, conversation, hashtags };
    });

  const patchConversation = (fields: Partial<ConversationConfig>) =>
    setEditingContext((prev) =>
      prev?.conversation ? { ...prev, conversation: { ...prev.conversation, ...fields } } : prev,
    );

  const close = () => setEditingContext(null);

  const openCreate = () => {
    setFormError(null);
    setIsCreating(true);
    setSavedAccountId(undefined);
    setEditingContext({
      name: `Context #${contexts.length + 1}`,
      description: '',
      // Never prefill another campaign's target: two campaigns on one thread collide.
      targetTweetId: defaultTargetTweetId,
      enabled: true,
      dryRun: false,
      autoFallbackToQuote: false,
      schedule: {
        mode: 'interval',
        intervalMinutes: 60,
        scheduleTimes: ['06:00', '18:00'],
        timezone: 'America/Denver',
        humanizeJitterEnabled: true,
        jitterPercentage: 25,
      },
      template: '{color_pick} {weather_desc}',
      hashtags: ['eternal', 'colors'],
      themePreference: 'dynamic',
      hashtagEvolution: { ...DEFAULT_HASHTAG_EVOLUTION },
    });
  };

  const openEdit = (context: TweetContext) => {
    setFormError(null);
    setIsCreating(false);
    setSavedAccountId(context.accountId ?? '');
    setEditingContext({
      ...context,
      // An unset target starts from the server default (never a client constant).
      targetTweetId: context.targetTweetId || defaultTargetTweetId,
      schedule: { ...context.schedule },
    });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingContext) return;

    if (!editingContext.name?.trim()) {
      setFormError('Please enter a descriptive context name.');
      return;
    }
    const detectedId = extractTweetId(editingContext.targetTweetId || '');
    if (!detectedId) {
      setFormError('Please enter a valid numeric Target Tweet ID or full X/Twitter post URL.');
      return;
    }
    const isConversation = editingContext.mode === 'conversation';
    if (isConversation) {
      const issues = conversationIssues(
        editingContext.conversation ?? defaultConversation(accounts),
        accounts,
      );
      if (issues.length > 0) {
        setFormError(issues[0]);
        return;
      }
    }
    const schedule = editingContext.schedule;
    if (schedule?.mode === 'fixed_times') {
      const bad = invalidTimes(schedule.scheduleTimes || []);
      if (bad.length > 0) {
        setFormError(`Invalid time(s): ${bad.join(', ')}. Use 24-hour HH:mm, e.g. 06:00, 18:00.`);
        return;
      }
    }

    try {
      // hashtagState is server-owned: never send it back.
      // conversationState is server-owned too.
      const {
        hashtagState: _state,
        conversationState: _conv,
        conversation,
        ...editable
      } = editingContext;
      void _state;
      void _conv;
      const payload: Partial<TweetContext> = {
        ...editable,
        mode: isConversation ? 'conversation' : 'single',
        ...(isConversation && conversation
          ? { conversation: cleanConversation(conversation) }
          : {}),
        targetTweetId: detectedId,
      };
      if (isCreating) {
        await onCreateContext(payload);
      } else if (editingContext.id) {
        await onUpdateContext(editingContext.id, payload);
      }
      setEditingContext(null);
      setIsCreating(false);
    } catch (err) {
      setFormError(errorMessage(err, 'Failed to save context.'));
    }
  };

  return {
    editingContext,
    isCreating,
    formError,
    savedAccountId,
    patch,
    patchSchedule,
    setMode,
    patchConversation,
    openCreate,
    openEdit,
    close,
    save,
  };
}

export type ContextForm = ReturnType<typeof useContextForm>;

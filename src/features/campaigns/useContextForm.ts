/**
 * X ChromaBot - useContextForm
 * State and actions for the create/edit campaign modal.
 */

import React, { useState } from 'react';
import { TweetContext } from '../../types.js';
import { extractTweetId } from '../../../shared/tweetId.js';
import { useServerInfo } from '../../context/serverInfo.js';
import { invalidTimes } from './schedule.js';

interface UseContextFormOptions {
  contexts: TweetContext[];
  activeContext?: TweetContext;
  onCreateContext: (data: Partial<TweetContext>) => Promise<void>;
  onUpdateContext: (id: string, updates: Partial<TweetContext>) => Promise<void>;
}

export function useContextForm(opts: UseContextFormOptions) {
  const { contexts, activeContext, onCreateContext, onUpdateContext } = opts;
  const { defaultTargetTweetId } = useServerInfo();
  const [editingContext, setEditingContext] = useState<Partial<TweetContext> | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  /** Shallow-merges fields into the draft. */
  const patch = (fields: Partial<TweetContext>) =>
    setEditingContext((prev) => (prev ? { ...prev, ...fields } : prev));

  const patchSchedule = (fields: Partial<TweetContext['schedule']>) =>
    setEditingContext((prev) =>
      prev ? { ...prev, schedule: { ...prev.schedule!, ...fields } } : prev,
    );

  const close = () => setEditingContext(null);

  const openCreate = () => {
    setFormError(null);
    setIsCreating(true);
    setEditingContext({
      name: `Context #${contexts.length + 1}`,
      description: '',
      targetTweetId: activeContext?.targetTweetId || defaultTargetTweetId,
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
      template: '{color_pick} {weather_desc} #eternal #colors',
      themePreference: 'dynamic',
    });
  };

  const openEdit = (context: TweetContext) => {
    setFormError(null);
    setIsCreating(false);
    setEditingContext({ ...context, schedule: { ...context.schedule } });
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
    const schedule = editingContext.schedule;
    if (schedule?.mode === 'fixed_times') {
      const bad = invalidTimes(schedule.scheduleTimes || []);
      if (bad.length > 0) {
        setFormError(`Invalid time(s): ${bad.join(', ')}. Use 24-hour HH:mm, e.g. 06:00, 18:00.`);
        return;
      }
    }

    try {
      const payload: Partial<TweetContext> = { ...editingContext, targetTweetId: detectedId };
      if (isCreating) {
        await onCreateContext(payload);
      } else if (editingContext.id) {
        await onUpdateContext(editingContext.id, payload);
      }
      setEditingContext(null);
      setIsCreating(false);
    } catch (err: any) {
      setFormError(err.message || 'Failed to save context.');
    }
  };

  return {
    editingContext,
    isCreating,
    formError,
    patch,
    patchSchedule,
    openCreate,
    openEdit,
    close,
    save,
  };
}

export type ContextForm = ReturnType<typeof useContextForm>;

/**
 * X ChromaBot - ContextsManager
 * Campaign list: header, card grid, create/edit modal and confirmations.
 */

import React, { useState } from 'react';
import { Layers, Plus } from 'lucide-react';
import { TweetContext } from '../../types.js';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.js';
import { ContextCard, TriggerNotice } from './ContextCard.js';
import { ContextFormModal } from './ContextFormModal.js';
import { useContextForm } from './useContextForm.js';

interface ContextsManagerProps {
  contexts: TweetContext[];
  activeContextId: string;
  nextPosts?: any[];
  onSelectActiveContext: (id: string) => Promise<void>;
  onCreateContext: (data: Partial<TweetContext>) => Promise<void>;
  onUpdateContext: (id: string, updates: Partial<TweetContext>) => Promise<void>;
  onDeleteContext: (id: string) => Promise<void>;
  onDuplicateContext: (id: string) => Promise<void>;
  onToggleContext: (id: string) => Promise<void>;
  onTriggerContext: (id: string) => Promise<any>;
  onClearContextHistory?: (id: string) => Promise<void>;
}

type PendingConfirm = { kind: 'delete' | 'clear'; context: TweetContext } | null;

export const ContextsManager: React.FC<ContextsManagerProps> = ({
  contexts,
  activeContextId,
  nextPosts = [],
  onSelectActiveContext,
  onCreateContext,
  onUpdateContext,
  onDeleteContext,
  onDuplicateContext,
  onToggleContext,
  onTriggerContext,
  onClearContextHistory,
}) => {
  const [triggeringId, setTriggeringId] = useState<string | null>(null);
  const [triggerResult, setTriggerResult] = useState<(TriggerNotice & { id: string }) | null>(null);
  const [pending, setPending] = useState<PendingConfirm>(null);

  const activeContext = contexts.find((c) => c.id === activeContextId) || contexts[0];
  const form = useContextForm({ contexts, activeContext, onCreateContext, onUpdateContext });

  const handleTriggerDrop = async (id: string) => {
    setTriggeringId(id);
    setTriggerResult(null);
    try {
      const res = await onTriggerContext(id);
      setTriggerResult({
        id,
        success: res.success,
        message: res.success
          ? 'Reply posted successfully!'
          : res.result?.error || 'Failed to dispatch reply',
      });
    } catch (err: any) {
      setTriggerResult({ id, success: false, message: err.message || 'Trigger failed' });
    } finally {
      setTriggeringId(null);
      setTimeout(() => setTriggerResult(null), 4000);
    }
  };

  const handleConfirm = async () => {
    if (!pending) return;
    const { kind, context } = pending;
    setPending(null);
    if (kind === 'delete') {
      await onDeleteContext(context.id);
    } else if (onClearContextHistory) {
      await onClearContextHistory(context.id);
    }
  };

  return (
    <div className="space-y-6">
      <div className="border border-neutral-200 dark:border-neutral-800 rounded-xl p-5 sm:p-6 bg-white dark:bg-neutral-900 shadow-2xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center shrink-0">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-2">
                <span>Tweet Contexts &amp; Multi-Schedule</span>
                <span className="text-xs font-mono font-medium px-2 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300">
                  {contexts.length} {contexts.length === 1 ? 'campaign' : 'campaigns'}
                </span>
              </h2>
              <p className="text-xs sm:text-sm text-neutral-500 dark:text-neutral-400 mt-0.5">
                Configure distinct target posts, independent repetition schedules, anti-bot delays,
                and templates.
              </p>
            </div>
          </div>

          <button
            onClick={form.openCreate}
            className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-xs shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Add Tweet Context</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {contexts.map((ctx) => (
          <ContextCard
            key={ctx.id}
            context={ctx}
            isActive={ctx.id === activeContextId}
            countdown={nextPosts.find((p) => p.contextId === ctx.id)?.countdownFormatted}
            isTriggering={triggeringId === ctx.id}
            notice={triggerResult?.id === ctx.id ? triggerResult : null}
            canDelete={contexts.length > 1}
            onSelectActive={() => onSelectActiveContext(ctx.id)}
            onUpdate={(updates) => onUpdateContext(ctx.id, updates)}
            onToggle={() => onToggleContext(ctx.id)}
            onTrigger={() => handleTriggerDrop(ctx.id)}
            onEdit={() => form.openEdit(ctx)}
            onDuplicate={() => onDuplicateContext(ctx.id)}
            onRequestClearHistory={
              onClearContextHistory ? () => setPending({ kind: 'clear', context: ctx }) : undefined
            }
            onRequestDelete={() => setPending({ kind: 'delete', context: ctx })}
          />
        ))}
      </div>

      <ContextFormModal form={form} />

      {pending && (
        <ConfirmDialog
          title={pending.kind === 'delete' ? 'Delete context?' : 'Clear history?'}
          message={
            pending.kind === 'delete'
              ? `Are you sure you want to delete context "${pending.context.name}"?`
              : `Clear history for "${pending.context.name}"? This will remove all post logs and reset stats for this campaign.`
          }
          confirmLabel={pending.kind === 'delete' ? 'Delete' : 'Clear History'}
          destructive
          onConfirm={handleConfirm}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
};

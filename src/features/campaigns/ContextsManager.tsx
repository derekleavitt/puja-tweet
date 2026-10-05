/**
 * X ChromaBot - ContextsManager
 * The main screen: every campaign as a card (configure, preview, post), the create/edit modal
 * and confirmations. There is no "active" campaign: each action names its campaign.
 */

import React, { useState } from 'react';
import { Layers, Plus } from 'lucide-react';
import { BotSettings, ContextNextPost, DropResponse, TweetContext } from '../../types.js';
import { PostNowOptions } from '../../hooks/usePosting.js';
import type { RestartConversationBody } from '../../api/endpoints.js';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog.js';
import { ContextCard } from './ContextCard.js';
import { ContextFormModal } from './ContextFormModal.js';
import { useContextForm } from './useContextForm.js';

interface ContextsManagerProps {
  contexts: TweetContext[];
  settings: BotSettings;
  nextPosts?: ContextNextPost[];
  onCreateContext: (data: Partial<TweetContext>) => Promise<void>;
  onUpdateContext: (id: string, updates: Partial<TweetContext>) => Promise<void>;
  onDeleteContext: (id: string) => Promise<void>;
  onDuplicateContext: (id: string) => Promise<void>;
  onToggleContext: (id: string) => Promise<void>;
  onClearContextHistory?: (id: string) => Promise<void>;
  onRestartConversation: (id: string, body: RestartConversationBody) => Promise<void>;
  /** Manual post for one campaign (asks for confirmation when it would go live). */
  onPostNow: (contextId: string, opts?: PostNowOptions) => Promise<DropResponse | undefined>;
}

type PendingConfirm = { kind: 'delete' | 'clear'; context: TweetContext } | null;

export const ContextsManager: React.FC<ContextsManagerProps> = ({
  contexts,
  settings,
  nextPosts = [],
  onCreateContext,
  onUpdateContext,
  onDeleteContext,
  onDuplicateContext,
  onToggleContext,
  onClearContextHistory,
  onRestartConversation,
  onPostNow,
}) => {
  const [pending, setPending] = useState<PendingConfirm>(null);

  const form = useContextForm({ contexts, onCreateContext, onUpdateContext });

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
                Everything about a campaign lives on its card: target, modes, schedule, template,
                hashtags, dry run. Use “Preview &amp; post” to see and send its exact next tweet.
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
            countdown={nextPosts.find((p) => p.contextId === ctx.id)?.countdownFormatted}
            globalDryRun={settings.globalDryRun !== false}
            canDelete={contexts.length > 1}
            onUpdate={(updates) => onUpdateContext(ctx.id, updates)}
            onToggle={() => onToggleContext(ctx.id)}
            onPost={(opts) => onPostNow(ctx.id, opts)}
            onRestart={(body) => onRestartConversation(ctx.id, body)}
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

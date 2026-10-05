/**
 * X ChromaBot - ContextFormModal
 * Create / edit campaign modal: the ONE place that configures everything about a campaign
 * (target, modes, schedule, jitter, template, hashtags, dry run, webhook URL). State lives in
 * useContextForm.
 */

import React from 'react';
import { Sliders, X, AlertCircle } from 'lucide-react';
import { TweetContext } from '../../types.js';
import { ContextForm } from './useContextForm.js';
import { FIELD_CLASS, LABEL_CLASS } from './constants.js';
import { ReplyModeSelector } from './ReplyModeSelector.js';
import { EngagementModeSelector } from './EngagementModeSelector.js';
import { ScheduleEditor } from './ScheduleEditor.js';
import { TemplateEditor } from '../../components/TemplateEditor.js';
import { HashtagEvolutionEditor } from './HashtagEvolutionEditor.js';
import { TargetField } from './TargetField.js';
import { CampaignWebhookUrl } from './CampaignWebhookUrl.js';

interface ContextFormModalProps {
  form: ContextForm;
}

export const ContextFormModal: React.FC<ContextFormModalProps> = ({ form }) => {
  const { editingContext: ctx, isCreating, formError, patch, patchSchedule, close } = form;
  if (!ctx) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between pb-3 border-b border-neutral-200 dark:border-neutral-800">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
              <Sliders className="w-4 h-4" />
            </div>
            <h3 className="text-base font-bold text-neutral-900 dark:text-neutral-100">
              {isCreating ? 'Create Tweet Context' : `Edit "${ctx.name}"`}
            </h3>
          </div>
          <button
            onClick={close}
            className="p-1.5 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 rounded-md cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {formError && (
          <div className="p-3 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 rounded-lg text-xs text-red-600 dark:text-red-400 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        <form onSubmit={form.save} className="space-y-4 text-xs">
          <div className="space-y-1.5">
            <label className={LABEL_CLASS}>Context Name *</label>
            <input
              type="text"
              required
              value={ctx.name || ''}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="e.g. Morning Thread, Daily Quotes, Product Launch"
              className={FIELD_CLASS}
            />
          </div>

          <TargetField
            value={ctx.targetTweetId || ''}
            onChange={(targetTweetId) => patch({ targetTweetId })}
          />

          <ReplyModeSelector context={ctx} onChange={patch} />
          <EngagementModeSelector
            value={ctx.engagementMode}
            onChange={(engagementMode) => patch({ engagementMode })}
          />
          {(ctx.engagementMode || 'reply') === 'reply' && (
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={ctx.autoFallbackToQuote ?? false}
                onChange={(e) => patch({ autoFallbackToQuote: e.target.checked })}
                className="mt-0.5 h-4 w-4 rounded border-neutral-300 text-neutral-900 focus:ring-neutral-500"
              />
              <span className="text-xs text-neutral-700 dark:text-neutral-300">
                Fall back to a Quote Tweet
                <span className="block text-[11px] text-neutral-500">
                  If X refuses the reply (reply cooldown or restricted thread), retry once as a
                  quote of the target post on your timeline. Off by default.
                </span>
              </span>
            </label>
          )}
          <ScheduleEditor schedule={ctx.schedule} onChange={patchSchedule} />
          <TemplateEditor
            template={ctx.template || ''}
            onChange={(template) => patch({ template })}
            contextId={ctx.id}
            rows={3}
          />
          <HashtagEvolutionEditor
            template={ctx.template || ''}
            value={ctx.hashtagEvolution}
            onChange={(hashtagEvolution) => patch({ hashtagEvolution })}
          />

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className={LABEL_CLASS}>Theme Preference</label>
              <select
                value={ctx.themePreference || 'dynamic'}
                onChange={(e) =>
                  patch({ themePreference: e.target.value as TweetContext['themePreference'] })
                }
                className={FIELD_CLASS}
              >
                <option value="dynamic">Dynamic (Atmospheric)</option>
                <option value="vibrant">Vibrant &amp; Saturated</option>
                <option value="minimal">Minimal &amp; Modern</option>
                <option value="poetic">Poetic &amp; Evocative</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className={LABEL_CLASS}>Posting Mode</label>
              <select
                aria-label="Posting Mode"
                title="Per-campaign mode. The global Dry Run switch in the header overrides Live."
                value={ctx.dryRun ? 'simulated' : 'live'}
                onChange={(e) => patch({ dryRun: e.target.value === 'simulated' })}
                className={FIELD_CLASS}
              >
                <option value="live">Live X API (Real Tweets)</option>
                <option value="simulated">Dry Run (Simulated / Safe)</option>
              </select>
            </div>
          </div>

          {!isCreating && ctx.id && <CampaignWebhookUrl contextId={ctx.id} />}

          <div className="pt-3 border-t border-neutral-200 dark:border-neutral-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <span className="text-[11px] text-neutral-500">
              Saving automatically clears and regenerates this campaign's 14-slot scheduled queue.
            </span>
            <div className="flex items-center justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={close}
                className="px-4 py-2 rounded-lg text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 rounded-lg font-semibold text-white bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 transition-colors cursor-pointer shadow-xs"
              >
                {isCreating ? 'Create Context' : 'Save & Regenerate Queue'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

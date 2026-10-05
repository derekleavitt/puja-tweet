/**
 * X ChromaBot - ContextCard
 * One campaign card: status, dry run, target, schedule, modes, template, hashtags, history, and the
 * "Preview & post" panel. Every action here acts on THIS campaign only.
 */

import React, { useState } from 'react';
import { Play, Pause, FlaskConical, Radio } from 'lucide-react';
import { DropResponse, TweetContext } from '../../types.js';
import { PostNowOptions } from '../../hooks/usePosting.js';
import type { RestartConversationBody } from '../../api/endpoints.js';
import { CardTarget } from './CardTarget.js';
import { CardFrequency } from './CardFrequency.js';
import { CardModeControls } from './CardModeControls.js';
import { CardActions } from './CardActions.js';
import { AutoPausedBadge } from './AutoPausedBadge.js';
import { CardHashtags } from './CardHashtags.js';
import { CardHistory } from './CardHistory.js';
import { CardConversation } from './CardConversation.js';
import { CampaignPreview } from './CampaignPreview.js';
import { useServerInfo } from '../../context/serverInfo.js';
import { accountName, findAccount } from '../../lib/accounts.js';

interface ContextCardProps {
  context: TweetContext;
  countdown?: string;
  /** The global dry run is on (overrides this campaign's own switch). */
  globalDryRun: boolean;
  onUpdate: (updates: Partial<TweetContext>) => Promise<void>;
  onToggle: () => void;
  onPost: (opts: PostNowOptions) => Promise<DropResponse | undefined>;
  onRestart: (body: RestartConversationBody) => Promise<void>;
  onEdit: () => void;
  onDuplicate: () => void;
  onRequestClearHistory?: () => void;
  onRequestDelete: () => void;
}

const BADGE = 'text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0';
const MODE_BADGES = {
  quote: {
    label: 'Quote Tweet',
    className:
      'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800',
  },
  standalone: {
    label: 'Timeline Drop',
    className:
      'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
  },
  reply: {
    label: 'Direct Reply',
    className:
      'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800',
  },
};

const CHIP =
  'px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-all flex items-center gap-1.5 cursor-pointer shrink-0';

export const ContextCard: React.FC<ContextCardProps> = (props) => {
  const { context: ctx, globalDryRun } = props;
  const [previewOpen, setPreviewOpen] = useState(false);
  const conversation = ctx.mode === 'conversation';
  const finished = !!ctx.autoPausedReason?.startsWith('Conversation finished');
  const badge = conversation
    ? {
        label: 'Conversation',
        className:
          'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800',
      }
    : MODE_BADGES[ctx.engagementMode || 'reply'];
  const campaignDryRun = ctx.dryRun === true;
  const { accounts } = useServerInfo();
  const account = findAccount(accounts, ctx.accountId);

  return (
    <div
      data-testid="campaign-card"
      data-campaign-id={ctx.id}
      className="border rounded-xl p-5 bg-white dark:bg-neutral-900 transition-all flex flex-col justify-between gap-4 border-neutral-200 dark:border-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-700 shadow-xs"
    >
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-bold text-neutral-900 dark:text-neutral-100 truncate">
                {ctx.name}
              </h3>
              <span className={`${BADGE} ${badge.className}`}>{badge.label}</span>
              <AutoPausedBadge context={ctx} />
            </div>
            {ctx.description && (
              <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5 line-clamp-1">
                {ctx.description}
              </p>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => props.onUpdate({ dryRun: !campaignDryRun })}
              aria-label={`Campaign dry run: ${campaignDryRun ? 'on' : 'off'}`}
              title={
                campaignDryRun
                  ? 'This campaign only simulates. Click to let it post live (the global dry run still applies).'
                  : globalDryRun
                    ? 'This campaign is set to Live, but the global dry run simulates everything. Click to make it always simulate.'
                    : 'This campaign posts live to X. Click to simulate its posts.'
              }
              className={`${CHIP} ${
                campaignDryRun
                  ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/40'
                  : 'bg-neutral-50 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-700'
              }`}
            >
              {campaignDryRun ? (
                <FlaskConical className="w-3.5 h-3.5" />
              ) : (
                <Radio className="w-3.5 h-3.5" />
              )}
              <span>
                {campaignDryRun ? 'Dry run' : globalDryRun ? 'Live (global sim)' : 'Live'}
              </span>
            </button>

            <button
              type="button"
              onClick={props.onToggle}
              className={`${CHIP} ${
                ctx.enabled
                  ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 shadow-xs'
                  : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/40'
              }`}
              title={ctx.enabled ? 'Click to Pause this campaign' : 'Click to Resume this campaign'}
            >
              {ctx.enabled ? (
                <Pause className="w-3.5 h-3.5 fill-current" />
              ) : (
                <Play className="w-3.5 h-3.5 fill-current" />
              )}
              <span>{ctx.enabled ? 'Active' : ctx.autoPausedReason ? 'Resume' : 'Paused'}</span>
            </button>
          </div>
        </div>

        {!ctx.enabled && ctx.autoPausedReason && !(conversation && finished) && (
          <p
            data-testid="auto-paused-reason"
            className="p-2 rounded-lg text-[11px] bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800"
          >
            Auto-paused: {ctx.autoPausedReason} Press “Resume” to restart this campaign.
          </p>
        )}

        {!conversation && (
          <p data-testid="posts-as" className="text-xs text-neutral-600 dark:text-neutral-400">
            Posts as{' '}
            <span className="font-semibold text-neutral-900 dark:text-neutral-100">
              {accountName(account, ctx.accountId)}
            </span>
            {account?.status === 'revoked' && (
              <span className="ml-1.5 text-red-600 dark:text-red-400">(disconnected)</span>
            )}
            {ctx.accountId && !account && (
              <span className="ml-1.5 text-red-600 dark:text-red-400">(pick another account)</span>
            )}
          </p>
        )}

        <CardTarget targetTweetId={ctx.targetTweetId} />

        <CardFrequency context={ctx} countdown={props.countdown} onUpdate={props.onUpdate} />
        {conversation ? (
          <CardConversation context={ctx} onRestart={props.onRestart} />
        ) : (
          <>
            <CardModeControls context={ctx} onUpdate={props.onUpdate} />

            <div className="text-xs">
              <span className="text-[10px] uppercase font-mono text-neutral-400">Template:</span>
              <div className="mt-1 p-2 rounded-md bg-neutral-100/70 dark:bg-neutral-800/80 font-mono text-[11px] text-neutral-700 dark:text-neutral-300 break-words">
                {ctx.template}
              </div>
            </div>

            <CardHashtags context={ctx} />
          </>
        )}

        <CardHistory stats={ctx.stats} onRequestClearHistory={props.onRequestClearHistory} />

        {previewOpen && (
          <CampaignPreview
            context={ctx}
            simulated={globalDryRun || campaignDryRun}
            onPost={props.onPost}
            onClose={() => setPreviewOpen(false)}
          />
        )}
      </div>

      <CardActions
        previewOpen={previewOpen}
        onTogglePreview={() => setPreviewOpen((open) => !open)}
        onEdit={props.onEdit}
        onDuplicate={props.onDuplicate}
        onRequestClearHistory={props.onRequestClearHistory}
        onRequestDelete={props.onRequestDelete}
      />
    </div>
  );
};

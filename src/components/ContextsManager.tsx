import React, { useState } from 'react';
import {
  Layers,
  Plus,
  Play,
  Pause,
  ExternalLink,
  Edit2,
  Copy,
  Trash2,
  Sparkles,
  Clock,
  Check,
  AlertCircle,
  ShieldAlert,
  Flame,
  Globe,
  Sliders,
  X,
  Repeat,
  Link2,
  GitFork,
  RotateCcw,
  Target,
  MessageSquare,
  Quote,
  History,
} from 'lucide-react';
import { TweetContext, TweetContextSchedule } from '../types.js';

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

const COMMON_TIMEZONES = [
  'America/Denver',
  'America/Los_Angeles',
  'America/New_York',
  'America/Chicago',
  'America/Phoenix',
  'Europe/London',
  'Europe/Paris',
  'Asia/Tokyo',
  'UTC',
];

const INTERVAL_PRESETS = [
  { label: 'Every 1 minute (Test)', minutes: 1 },
  { label: 'Every 15 minutes', minutes: 15 },
  { label: 'Every 30 minutes', minutes: 30 },
  { label: 'Every 1 hour', minutes: 60 },
  { label: 'Every 3 hours', minutes: 180 },
  { label: 'Every 6 hours', minutes: 360 },
  { label: 'Every 12 hours', minutes: 720 },
  { label: 'Every 24 hours', minutes: 1440 },
];

export function extractTweetId(input: string): string | null {
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/(?:twitter\.com|x\.com)\/[^/]+\/status\/(\d+)/i);
  if (urlMatch && urlMatch[1]) return urlMatch[1];
  const digitMatch = trimmed.match(/\b\d{8,25}\b/);
  if (digitMatch) return digitMatch[0];
  return null;
}

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
  const [editingContext, setEditingContext] = useState<Partial<TweetContext> | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [triggeringId, setTriggeringId] = useState<string | null>(null);
  const [triggerResult, setTriggerResult] = useState<{ id: string; success: boolean; message: string } | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [testingAi, setTestingAi] = useState(false);
  const [aiPreviewResult, setAiPreviewResult] = useState<string | null>(null);

  const testAiGeneration = async () => {
    if (!editingContext?.template) return;
    setTestingAi(true);
    setAiPreviewResult(null);
    try {
      const res = await fetch('/api/template/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template: editingContext.template,
          contextId: editingContext.id,
        }),
      });
      const data = await res.json();
      if (data.previewText) {
        setAiPreviewResult(data.previewText);
      } else {
        setAiPreviewResult('Could not generate preview.');
      }
    } catch (err: any) {
      setAiPreviewResult(`Error: ${err.message}`);
    } finally {
      setTestingAi(false);
    }
  };

  const activeContext = contexts.find(c => c.id === activeContextId) || contexts[0];

  const handleOpenCreate = () => {
    setFormError(null);
    setIsCreating(true);
    setEditingContext({
      name: `Context #${contexts.length + 1}`,
      description: '',
      targetTweetId: activeContext?.targetTweetId || '2091597504928428416',
      enabled: true,
      dryRun: false,
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

  const handleOpenEdit = (context: TweetContext) => {
    setFormError(null);
    setIsCreating(false);
    setEditingContext({
      ...context,
      schedule: { ...context.schedule },
    });
  };

  const handleSaveForm = async (e: React.FormEvent) => {
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

    try {
      const payload: Partial<TweetContext> = {
        ...editingContext,
        targetTweetId: detectedId,
      };

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

  const handleTriggerDrop = async (id: string) => {
    setTriggeringId(id);
    setTriggerResult(null);
    try {
      const res = await onTriggerContext(id);
      setTriggerResult({
        id,
        success: res.success,
        message: res.success ? 'Reply posted successfully!' : (res.result?.error || 'Failed to dispatch reply'),
      });
      setTimeout(() => setTriggerResult(null), 4000);
    } catch (err: any) {
      setTriggerResult({
        id,
        success: false,
        message: err.message || 'Trigger failed',
      });
      setTimeout(() => setTriggerResult(null), 4000);
    } finally {
      setTriggeringId(null);
    }
  };

  const copyTweetId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
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
                Configure distinct target posts, independent repetition schedules, anti-bot delays, and templates.
              </p>
            </div>
          </div>

          <button
            onClick={handleOpenCreate}
            className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 rounded-lg transition-colors flex items-center justify-center gap-2 cursor-pointer shadow-xs shrink-0"
          >
            <Plus className="w-4 h-4" />
            <span>Add Tweet Context</span>
          </button>
        </div>
      </div>

      {/* Context Cards Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {contexts.map((ctx) => {
          const isActive = ctx.id === activeContextId;
          const nextInfo = nextPosts.find(p => p.contextId === ctx.id);
          const isTriggering = triggeringId === ctx.id;
          const resultNotice = triggerResult?.id === ctx.id ? triggerResult : null;

          return (
            <div
              key={ctx.id}
              className={`border rounded-xl p-5 bg-white dark:bg-neutral-900 transition-all flex flex-col justify-between gap-4 ${
                isActive
                  ? 'border-indigo-500 dark:border-indigo-400 ring-2 ring-indigo-500/20 shadow-sm'
                  : 'border-neutral-200 dark:border-neutral-800 hover:border-neutral-300 dark:hover:border-neutral-700'
              }`}
            >
              {/* Card Header */}
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-bold text-neutral-900 dark:text-neutral-100 truncate">
                        {ctx.name}
                      </h3>
                      {isActive && (
                        <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 shrink-0">
                          Active in Studio
                        </span>
                      )}
                      {ctx.engagementMode === 'quote' ? (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 shrink-0">
                          Quote Tweet
                        </span>
                      ) : ctx.engagementMode === 'standalone' ? (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 shrink-0">
                          Timeline Drop
                        </span>
                      ) : (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 shrink-0">
                          Direct Reply
                        </span>
                      )}
                    </div>
                    {ctx.description && (
                      <p className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5 line-clamp-1">
                        {ctx.description}
                      </p>
                    )}
                  </div>

                  {/* Dedicated Pausability Toggle */}
                  <button
                    type="button"
                    onClick={() => onToggleContext(ctx.id)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all flex items-center gap-1.5 cursor-pointer shrink-0 ${
                      ctx.enabled
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 shadow-xs'
                        : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/40'
                    }`}
                    title={ctx.enabled ? 'Click to Pause this campaign' : 'Click to Resume this campaign'}
                  >
                    {ctx.enabled ? (
                      <>
                        <Pause className="w-3.5 h-3.5 fill-current" />
                        <span>Active</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>Paused</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Target Tweet ID & URL */}
                <div className="p-2.5 rounded-lg bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200/80 dark:border-neutral-700/60 flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-neutral-400 font-mono text-[11px]">Target Post:</span>
                    <a
                      href={`https://x.com/i/status/${ctx.targetTweetId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono font-semibold text-neutral-900 dark:text-neutral-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors inline-flex items-center gap-1 truncate"
                      title="Open target post on X"
                    >
                      <span className="truncate">#{ctx.targetTweetId}</span>
                      <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  </div>

                  <button
                    onClick={() => copyTweetId(ctx.targetTweetId)}
                    className="p-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 rounded transition-colors cursor-pointer shrink-0"
                    title="Copy Tweet ID"
                  >
                    {copiedId === ctx.targetTweetId ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>

                {/* Campaign Frequency Controller (Independent per Campaign) */}
                <div className="p-2.5 rounded-lg bg-neutral-50 dark:bg-neutral-800/40 border border-neutral-200/80 dark:border-neutral-700/60 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-neutral-700 dark:text-neutral-200 font-medium">
                      <Clock className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                      <span>Campaign Frequency:</span>
                      <span className="text-indigo-600 dark:text-indigo-400 font-mono text-[11px]">
                        {ctx.schedule.mode === 'interval'
                          ? `Every ${ctx.schedule.intervalMinutes}m`
                          : `${(ctx.schedule.scheduleTimes || ['06:00', '18:00']).join(', ')} MST`}
                      </span>
                    </div>

                    <div className="flex items-center gap-1 text-[11px] font-mono text-neutral-500">
                      <span>Next:</span>
                      <span className="font-semibold text-neutral-800 dark:text-neutral-200">
                        {ctx.enabled ? (nextInfo?.countdownFormatted || 'Calculating...') : 'Paused'}
                      </span>
                    </div>
                  </div>

                  {/* Frequency Presets Selector */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {[
                      { label: '15m', minutes: 15 },
                      { label: '30m', minutes: 30 },
                      { label: '1h', minutes: 60 },
                      { label: '3h', minutes: 180 },
                      { label: '6h', minutes: 360 },
                      { label: '12h', minutes: 720 },
                      { label: '24h', minutes: 1440 },
                    ].map(preset => {
                      const isSelected =
                        ctx.schedule.mode === 'interval' && ctx.schedule.intervalMinutes === preset.minutes;
                      return (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() =>
                            onUpdateContext(ctx.id, {
                              schedule: {
                                ...ctx.schedule,
                                mode: 'interval',
                                intervalMinutes: preset.minutes,
                              },
                            })
                          }
                          className={`px-2 py-0.5 text-[11px] font-mono font-medium rounded-md border transition-colors cursor-pointer ${
                            isSelected
                              ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                              : 'bg-white dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-700'
                          }`}
                        >
                          {preset.label}
                        </button>
                      );
                    })}

                    <button
                      type="button"
                      onClick={() =>
                        onUpdateContext(ctx.id, {
                          schedule: {
                            ...ctx.schedule,
                            mode: 'fixed_times',
                            scheduleTimes: ['06:00', '18:00'],
                            timezone: ctx.schedule.timezone || 'America/Denver',
                          },
                        })
                      }
                      className={`px-2 py-0.5 text-[11px] font-mono font-medium rounded-md border transition-colors cursor-pointer ${
                        ctx.schedule.mode === 'fixed_times'
                          ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                          : 'bg-white dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 border-neutral-200 dark:border-neutral-700 hover:border-neutral-300 dark:hover:border-neutral-600 hover:bg-neutral-100 dark:hover:bg-neutral-700'
                      }`}
                      title="Post at 6:00 AM & 6:00 PM Mountain Standard Time (MST)"
                    >
                      6am/6pm MST
                    </button>
                  </div>
                </div>

                {/* Engagement Style Selector: In-Thread Reply vs Quote Tweet vs Timeline Drop */}
                <div className="p-2.5 rounded-lg bg-neutral-50 dark:bg-neutral-800/40 border border-neutral-200/80 dark:border-neutral-700/60 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-neutral-600 dark:text-neutral-400">
                      Engagement Format
                    </span>
                    <div className="flex items-center gap-1 bg-neutral-200/70 dark:bg-neutral-700/70 p-0.5 rounded-md">
                      <button
                        type="button"
                        onClick={() => onUpdateContext(ctx.id, { engagementMode: 'reply' })}
                        className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors cursor-pointer flex items-center gap-1 ${
                          (ctx.engagementMode || 'reply') === 'reply'
                            ? 'bg-blue-600 text-white shadow-xs'
                            : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100'
                        }`}
                        title="Comment in thread under root/last tweet"
                      >
                        <MessageSquare className="w-2.5 h-2.5" />
                        <span>Reply Thread</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => onUpdateContext(ctx.id, { engagementMode: 'quote' })}
                        className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors cursor-pointer flex items-center gap-1 ${
                          ctx.engagementMode === 'quote'
                            ? 'bg-amber-600 text-white shadow-xs'
                            : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100'
                        }`}
                        title="Quote Tweet target post on your timeline (Bypasses in-thread reply restrictions)"
                      >
                        <Quote className="w-2.5 h-2.5" />
                        <span>Quote Tweet</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => onUpdateContext(ctx.id, { engagementMode: 'standalone' })}
                        className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors cursor-pointer flex items-center gap-1 ${
                          ctx.engagementMode === 'standalone'
                            ? 'bg-emerald-600 text-white shadow-xs'
                            : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100'
                        }`}
                        title="Standalone timeline drop without attaching to post"
                      >
                        <Globe className="w-2.5 h-2.5" />
                        <span>Timeline</span>
                      </button>
                    </div>
                  </div>
                  <div className="text-[10px] text-neutral-500">
                    {(ctx.engagementMode || 'reply') === 'reply' && 'Replies directly in the comment thread of the target post.'}
                    {ctx.engagementMode === 'quote' && 'Embeds the target post as an aesthetic Quote Tweet on your profile (bypasses reply cooldowns).'}
                    {ctx.engagementMode === 'standalone' && 'Publishes directly to your timeline without referencing a parent post.'}
                  </div>
                </div>

                {/* Reply Threading Strategy Bar (Active in Reply Thread Mode) */}
                {(ctx.engagementMode || 'reply') === 'reply' && (
                <div className="p-2.5 rounded-lg bg-neutral-50 dark:bg-neutral-800/40 border border-neutral-200/80 dark:border-neutral-700/60 space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-neutral-600 dark:text-neutral-400">
                      Reply Behavior
                    </span>
                    <div className="flex items-center gap-1 bg-neutral-200/70 dark:bg-neutral-700/70 p-0.5 rounded-md">
                      <button
                        type="button"
                        onClick={() => onUpdateContext(ctx.id, { replyTargetMode: 'original_post' })}
                        className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors cursor-pointer ${
                          ctx.replyTargetMode !== 'last_comment'
                            ? 'bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 shadow-xs'
                            : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100'
                        }`}
                        title="All drops comment directly under the campaign's root post"
                      >
                        Root Mode
                      </button>
                      <button
                        type="button"
                        onClick={() => onUpdateContext(ctx.id, { replyTargetMode: 'last_comment' })}
                        className={`px-2 py-0.5 text-[10px] font-medium rounded transition-colors cursor-pointer ${
                          ctx.replyTargetMode === 'last_comment'
                            ? 'bg-purple-600 text-white shadow-xs'
                            : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100'
                        }`}
                        title="Each drop replies to the previous comment, creating a cascading thread"
                      >
                        Chain Mode
                      </button>
                    </div>
                  </div>

                  <div className="text-[11px] text-neutral-600 dark:text-neutral-400 flex items-center justify-between gap-2">
                    {ctx.replyTargetMode === 'last_comment' ? (
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Link2 className="w-3.5 h-3.5 text-purple-500 shrink-0" />
                        <span className="truncate">
                          {ctx.lastPostedTweetId
                            ? `Chain active: next drop replies to comment #${ctx.lastPostedTweetId}`
                            : `Starting chain: next drop will reply to root #${ctx.targetTweetId}`}
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Target className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                        <span className="truncate">
                          All drops reply directly under root post #{ctx.targetTweetId}
                        </span>
                      </div>
                    )}

                    {ctx.replyTargetMode === 'last_comment' && ctx.lastPostedTweetId && (
                      <button
                        type="button"
                        onClick={async () => {
                          await onUpdateContext(ctx.id, { lastPostedTweetId: undefined });
                        }}
                        className="px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded hover:bg-amber-100 transition-colors flex items-center gap-1 cursor-pointer shrink-0"
                        title="Restart chain from original root post"
                      >
                        <RotateCcw className="w-2.5 h-2.5" />
                        <span>Reset to Root</span>
                      </button>
                    )}
                  </div>
                </div>
                )}

                {/* Template Preview */}
                <div className="text-xs">
                  <span className="text-[10px] uppercase font-mono text-neutral-400">Template:</span>
                  <div className="mt-1 p-2 rounded-md bg-neutral-100/70 dark:bg-neutral-800/80 font-mono text-[11px] text-neutral-700 dark:text-neutral-300 break-words">
                    {ctx.template}
                  </div>
                </div>

                {/* Campaign History & Clear Button */}
                <div className="p-2.5 rounded-lg bg-neutral-50 dark:bg-neutral-800/50 border border-neutral-200/70 dark:border-neutral-700/60 flex items-center justify-between gap-2 text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <History className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                    <div className="min-w-0 truncate">
                      <span className="font-medium text-neutral-700 dark:text-neutral-300">
                        History: {ctx.stats?.totalPosts || 0} drops
                      </span>
                      {ctx.stats && ctx.stats.totalPosts > 0 && (
                        <span className="text-[10px] text-neutral-400 ml-1.5 font-mono">
                          ({ctx.stats.successfulPosts} sent, {ctx.stats.failedPosts} failed)
                        </span>
                      )}
                    </div>
                  </div>

                  {onClearContextHistory && (
                    <button
                      type="button"
                      onClick={async () => {
                        if (
                          confirm(
                            `Clear history for "${ctx.name}"?\n\nThis will remove all post logs and reset stats for this campaign.`
                          )
                        ) {
                          await onClearContextHistory(ctx.id);
                        }
                      }}
                      className="px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100 dark:hover:bg-amber-900/60 rounded border border-amber-200 dark:border-amber-800 transition-colors flex items-center gap-1 cursor-pointer shrink-0"
                      title="Clear history and reset stats for this campaign"
                    >
                      <Trash2 className="w-3 h-3" />
                      <span>Clear History</span>
                    </button>
                  )}
                </div>

                {/* Notice message if triggered */}
                {resultNotice && (
                  <div
                    className={`p-2 rounded-lg text-xs flex items-center gap-2 ${
                      resultNotice.success
                        ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                        : 'bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
                    }`}
                  >
                    {resultNotice.success ? <Check className="w-3.5 h-3.5 shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 shrink-0" />}
                    <span>{resultNotice.message}</span>
                  </div>
                )}
              </div>

              {/* Card Footer Actions */}
              <div className="pt-3 border-t border-neutral-100 dark:border-neutral-800 flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-1.5">
                  {!isActive && (
                    <button
                      onClick={() => onSelectActiveContext(ctx.id)}
                      className="px-2.5 py-1 text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-md transition-colors cursor-pointer"
                    >
                      Set Active
                    </button>
                  )}
                  <button
                    onClick={() => handleTriggerDrop(ctx.id)}
                    disabled={isTriggering}
                    className="px-2.5 py-1 text-xs font-medium text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-100 dark:hover:bg-indigo-950 rounded-md border border-indigo-200 dark:border-indigo-800 transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {isTriggering ? (
                      <span className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Sparkles className="w-3 h-3" />
                    )}
                    <span>Trigger Drop</span>
                  </button>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleOpenEdit(ctx)}
                    className="p-1.5 text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-md transition-colors cursor-pointer"
                    title="Edit context & schedule"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => onDuplicateContext(ctx.id)}
                    className="p-1.5 text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 rounded-md transition-colors cursor-pointer"
                    title="Duplicate context"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  {onClearContextHistory && (
                    <button
                      onClick={async () => {
                        if (
                          confirm(
                            `Clear history for "${ctx.name}"?\n\nThis will remove all post logs and reset stats for this campaign.`
                          )
                        ) {
                          await onClearContextHistory(ctx.id);
                        }
                      }}
                      className="p-1.5 text-neutral-400 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40 rounded-md transition-colors cursor-pointer"
                      title="Clear history for this campaign"
                    >
                      <History className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {contexts.length > 1 && (
                    <button
                      onClick={() => {
                        if (confirm(`Are you sure you want to delete context "${ctx.name}"?`)) {
                          onDeleteContext(ctx.id);
                        }
                      }}
                      className="p-1.5 text-neutral-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-md transition-colors cursor-pointer"
                      title="Delete context"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Create / Edit Modal */}
      {editingContext && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-neutral-200 dark:border-neutral-800">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                  <Sliders className="w-4 h-4" />
                </div>
                <h3 className="text-base font-bold text-neutral-900 dark:text-neutral-100">
                  {isCreating ? 'Create Tweet Context' : `Edit "${editingContext.name}"`}
                </h3>
              </div>
              <button
                onClick={() => setEditingContext(null)}
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

            <form onSubmit={handleSaveForm} className="space-y-4 text-xs">
              {/* Context Name & Description */}
              <div className="space-y-1.5">
                <label className="font-semibold text-neutral-700 dark:text-neutral-300">
                  Context Name *
                </label>
                <input
                  type="text"
                  required
                  value={editingContext.name || ''}
                  onChange={(e) => setEditingContext({ ...editingContext, name: e.target.value })}
                  placeholder="e.g. Primary Eternal Colors, Morning Art Thread, Product Launch"
                  className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* Target Tweet ID or URL */}
              <div className="space-y-1.5">
                <label className="font-semibold text-neutral-700 dark:text-neutral-300">
                  Target Tweet ID or URL *
                </label>
                <input
                  type="text"
                  required
                  value={editingContext.targetTweetId || ''}
                  onChange={(e) => setEditingContext({ ...editingContext, targetTweetId: e.target.value })}
                  placeholder="e.g. 2091597504928428416 or https://x.com/user/status/2091597504928428416"
                  className="w-full px-3 py-2 font-mono rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <p className="text-[11px] text-neutral-500">
                  Numeric tweet ID of the post your automated replies will attach to.
                </p>
              </div>

              {/* Reply Threading Strategy Toggle */}
              <div className="space-y-2 pt-2 border-t border-neutral-100 dark:border-neutral-800">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-neutral-700 dark:text-neutral-300">
                    Reply Threading Strategy
                  </label>
                  <span className="text-[11px] font-mono text-neutral-400">
                    {editingContext.replyTargetMode === 'last_comment' ? 'Cascading Chain' : 'Root Anchor'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setEditingContext({
                        ...editingContext,
                        replyTargetMode: 'original_post',
                      })
                    }
                    className={`p-3 rounded-lg border text-left cursor-pointer transition-all flex flex-col justify-between ${
                      (editingContext.replyTargetMode || 'original_post') === 'original_post'
                        ? 'border-indigo-600 bg-indigo-50/60 dark:bg-indigo-950/40 text-indigo-900 dark:text-indigo-100 font-semibold ring-1 ring-indigo-500/30'
                        : 'border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/60 text-neutral-700 dark:text-neutral-300 hover:border-neutral-300'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-xs">
                      <Target className="w-3.5 h-3.5 text-blue-500" />
                      <span>Reply to Original Post</span>
                    </div>
                    <div className="text-[10px] text-neutral-500 dark:text-neutral-400 font-normal mt-1 leading-snug">
                      All drops reply directly to the root post (#{editingContext.targetTweetId || '...'}).
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setEditingContext({
                        ...editingContext,
                        replyTargetMode: 'last_comment',
                      })
                    }
                    className={`p-3 rounded-lg border text-left cursor-pointer transition-all flex flex-col justify-between ${
                      editingContext.replyTargetMode === 'last_comment'
                        ? 'border-purple-600 bg-purple-50/60 dark:bg-purple-950/40 text-purple-900 dark:text-purple-100 font-semibold ring-1 ring-purple-500/30'
                        : 'border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/60 text-neutral-700 dark:text-neutral-300 hover:border-neutral-300'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-xs">
                      <Link2 className="w-3.5 h-3.5 text-purple-500" />
                      <span>Reply to Last Comment</span>
                    </div>
                    <div className="text-[10px] text-neutral-500 dark:text-neutral-400 font-normal mt-1 leading-snug">
                      Each next drop replies to the last comment made by us, forming an unbroken cascading thread.
                    </div>
                  </button>
                </div>

                {/* Sub-status when last_comment is selected */}
                {editingContext.replyTargetMode === 'last_comment' && (
                  <div className="p-2.5 rounded-lg bg-purple-50/70 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800/60 text-xs flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-2 h-2 rounded-full bg-purple-500 shrink-0" />
                      <div className="truncate text-purple-900 dark:text-purple-200 text-[11px]">
                        {editingContext.lastPostedTweetId ? (
                          <span>
                            Current chain anchor: <strong className="font-mono">#{editingContext.lastPostedTweetId}</strong>
                          </span>
                        ) : (
                          <span>
                            No prior comment recorded. First drop will reply to root post <strong className="font-mono">#{editingContext.targetTweetId}</strong> to begin the chain.
                          </span>
                        )}
                      </div>
                    </div>

                    {editingContext.lastPostedTweetId && (
                      <button
                        type="button"
                        onClick={() =>
                          setEditingContext({
                            ...editingContext,
                            lastPostedTweetId: undefined,
                          })
                        }
                        className="px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-950/60 rounded border border-amber-300 dark:border-amber-800 hover:bg-amber-200 cursor-pointer flex items-center gap-1 shrink-0"
                        title="Reset chain anchor back to original post"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Reset to Root</span>
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Engagement Type: Direct Reply vs Quote Tweet vs Standalone */}
              <div className="space-y-2 pt-2 border-t border-neutral-100 dark:border-neutral-800">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-neutral-700 dark:text-neutral-300">
                    Engagement Mode on X
                  </label>
                  <span className="text-[11px] font-mono text-neutral-400">
                    {editingContext.engagementMode === 'quote'
                      ? 'Quote Tweet'
                      : editingContext.engagementMode === 'standalone'
                      ? 'Standalone Post'
                      : 'Direct Reply'}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setEditingContext({
                        ...editingContext,
                        engagementMode: 'reply',
                      })
                    }
                    className={`p-2.5 rounded-lg border text-left cursor-pointer transition-all flex flex-col justify-between ${
                      (editingContext.engagementMode || 'reply') === 'reply'
                        ? 'border-indigo-600 bg-indigo-50/60 dark:bg-indigo-950/40 text-indigo-900 dark:text-indigo-100 font-semibold ring-1 ring-indigo-500/30'
                        : 'border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/60 text-neutral-700 dark:text-neutral-300 hover:border-neutral-300'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-xs">
                      <MessageSquare className="w-3.5 h-3.5 text-blue-500" />
                      <span>Direct Reply</span>
                    </div>
                    <div className="text-[10px] text-neutral-500 dark:text-neutral-400 font-normal mt-1 leading-snug">
                      Posts as a comment under the target tweet.
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setEditingContext({
                        ...editingContext,
                        engagementMode: 'quote',
                      })
                    }
                    className={`p-2.5 rounded-lg border text-left cursor-pointer transition-all flex flex-col justify-between ${
                      editingContext.engagementMode === 'quote'
                        ? 'border-amber-600 bg-amber-50/60 dark:bg-amber-950/40 text-amber-900 dark:text-amber-100 font-semibold ring-1 ring-amber-500/30'
                        : 'border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/60 text-neutral-700 dark:text-neutral-300 hover:border-neutral-300'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-xs">
                      <Quote className="w-3.5 h-3.5 text-amber-500" />
                      <span>Quote Tweet</span>
                    </div>
                    <div className="text-[10px] text-neutral-500 dark:text-neutral-400 font-normal mt-1 leading-snug">
                      Quotes target post on timeline (Supported on all X tiers).
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setEditingContext({
                        ...editingContext,
                        engagementMode: 'standalone',
                      })
                    }
                    className={`p-2.5 rounded-lg border text-left cursor-pointer transition-all flex flex-col justify-between ${
                      editingContext.engagementMode === 'standalone'
                        ? 'border-emerald-600 bg-emerald-50/60 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-100 font-semibold ring-1 ring-emerald-500/30'
                        : 'border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/60 text-neutral-700 dark:text-neutral-300 hover:border-neutral-300'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-xs">
                      <Globe className="w-3.5 h-3.5 text-emerald-500" />
                      <span>Timeline Drop</span>
                    </div>
                    <div className="text-[10px] text-neutral-500 dark:text-neutral-400 font-normal mt-1 leading-snug">
                      Direct post to timeline without attaching to post.
                    </div>
                  </button>
                </div>
              </div>

              {/* Schedule Mode Selector */}
              <div className="space-y-2 pt-2 border-t border-neutral-100 dark:border-neutral-800">
                <label className="font-semibold text-neutral-700 dark:text-neutral-300">
                  Repetition Mode
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setEditingContext({
                        ...editingContext,
                        schedule: { ...editingContext.schedule!, mode: 'interval' },
                      })
                    }
                    className={`p-2.5 rounded-lg border text-left cursor-pointer transition-colors ${
                      editingContext.schedule?.mode === 'interval'
                        ? 'border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/40 text-indigo-900 dark:text-indigo-100 font-semibold'
                        : 'border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300'
                    }`}
                  >
                    <div>Repeating Interval</div>
                    <div className="text-[10px] text-neutral-500 font-normal">Every X minutes or hours</div>
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      setEditingContext({
                        ...editingContext,
                        schedule: { ...editingContext.schedule!, mode: 'fixed_times' },
                      })
                    }
                    className={`p-2.5 rounded-lg border text-left cursor-pointer transition-colors ${
                      editingContext.schedule?.mode === 'fixed_times'
                        ? 'border-indigo-600 bg-indigo-50/50 dark:bg-indigo-950/40 text-indigo-900 dark:text-indigo-100 font-semibold'
                        : 'border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300'
                    }`}
                  >
                    <div>Fixed Clock Drops</div>
                    <div className="text-[10px] text-neutral-500 font-normal">e.g. 6:00 AM &amp; 6:00 PM</div>
                  </button>
                </div>
              </div>

              {/* Interval Selection */}
              {editingContext.schedule?.mode === 'interval' && (
                <div className="space-y-1.5">
                  <label className="font-semibold text-neutral-700 dark:text-neutral-300">
                    Interval Frequency
                  </label>
                  <select
                    value={editingContext.schedule?.intervalMinutes || 60}
                    onChange={(e) =>
                      setEditingContext({
                        ...editingContext,
                        schedule: { ...editingContext.schedule!, intervalMinutes: parseInt(e.target.value, 10) },
                      })
                    }
                    className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {INTERVAL_PRESETS.map((p) => (
                      <option key={p.minutes} value={p.minutes}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Fixed Clock Times & Timezone */}
              {editingContext.schedule?.mode === 'fixed_times' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="font-semibold text-neutral-700 dark:text-neutral-300">
                      Times (comma separated)
                    </label>
                    <input
                      type="text"
                      value={(editingContext.schedule?.scheduleTimes || []).join(', ')}
                      onChange={(e) =>
                        setEditingContext({
                          ...editingContext,
                          schedule: {
                            ...editingContext.schedule!,
                            scheduleTimes: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                          },
                        })
                      }
                      placeholder="06:00, 18:00"
                      className="w-full px-3 py-2 font-mono rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="font-semibold text-neutral-700 dark:text-neutral-300">
                      Timezone
                    </label>
                    <select
                      value={editingContext.schedule?.timezone || 'America/Denver'}
                      onChange={(e) =>
                        setEditingContext({
                          ...editingContext,
                          schedule: { ...editingContext.schedule!, timezone: e.target.value },
                        })
                      }
                      className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    >
                      {COMMON_TIMEZONES.map((tz) => (
                        <option key={tz} value={tz}>
                          {tz}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {/* Anti-Bot Humanized Jitter */}
              <div className="p-3 rounded-lg bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200/80 dark:border-neutral-700 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Flame className="w-3.5 h-3.5 text-amber-500" />
                    <span className="font-semibold text-neutral-800 dark:text-neutral-200">
                      Anti-Bot Humanized Timing Delay
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={editingContext.schedule?.humanizeJitterEnabled ?? true}
                    onChange={(e) =>
                      setEditingContext({
                        ...editingContext,
                        schedule: { ...editingContext.schedule!, humanizeJitterEnabled: e.target.checked },
                      })
                    }
                    className="rounded text-indigo-600 focus:ring-indigo-500"
                  />
                </div>
                <p className="text-[11px] text-neutral-500">
                  Adds a random delay (0 to {editingContext.schedule?.jitterPercentage ?? 25}%) so replies don't post at exact mathematical minute marks.
                </p>
              </div>

              {/* Tweet Text Template */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-neutral-700 dark:text-neutral-300">
                    Tweet Text Template
                  </label>
                  <button
                    type="button"
                    onClick={testAiGeneration}
                    disabled={testingAi}
                    className="text-[11px] font-semibold text-purple-600 dark:text-purple-400 hover:text-purple-700 flex items-center gap-1 cursor-pointer disabled:opacity-50"
                  >
                    {testingAi ? (
                      <span className="w-2.5 h-2.5 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Sparkles className="w-3 h-3 text-purple-500" />
                    )}
                    <span>Test AI Generation</span>
                  </button>
                </div>

                <textarea
                  rows={3}
                  value={editingContext.template || ''}
                  onChange={(e) => setEditingContext({ ...editingContext, template: e.target.value })}
                  placeholder="{color_pick} {weather_desc} #eternal #colors"
                  className="w-full px-3 py-2 font-mono rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 leading-relaxed text-xs"
                />

                {/* AI Agent Presets */}
                <div className="space-y-1">
                  <span className="text-[10px] uppercase font-mono text-neutral-400 font-semibold">
                    AI Poetry Presets (Gemini):
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => setEditingContext({ ...editingContext, template: '<history><agent>consider whats already and been said and respond with just the body of a tweet that is unique pablo neruda like expression that plays on the series thats been written thus far</agent></history>' })}
                      className="px-2 py-0.5 text-[11px] font-medium rounded bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-800 hover:bg-amber-100 cursor-pointer"
                    >
                      📜 Neruda Arc with History
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingContext({ ...editingContext, template: '<agent>respond with just the body of a tweet that is unique pablo neruda like expression</agent>' })}
                      className="px-2 py-0.5 text-[11px] font-medium rounded bg-purple-50 dark:bg-purple-950/40 text-purple-800 dark:text-purple-300 border border-purple-300 dark:border-purple-800 hover:bg-purple-100 cursor-pointer"
                    >
                      ✍️ Neruda Solo Poem
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingContext({ ...editingContext, template: '{color_pick} {hex} | <history><agent>Write a visceral 2-line Neruda-style poem connecting this new hue to previous drops</agent></history> #eternal #colors' })}
                      className="px-2 py-0.5 text-[11px] font-medium rounded bg-indigo-50 dark:bg-indigo-950/40 text-indigo-800 dark:text-indigo-300 border border-indigo-300 dark:border-indigo-800 hover:bg-indigo-100 cursor-pointer"
                    >
                      ✨ Swatch + History Arc
                    </button>
                  </div>
                </div>

                {/* Tokens */}
                <div className="flex flex-wrap items-center gap-1 text-[10px] text-neutral-400 font-mono">
                  <span>Tokens:</span>
                  <button
                    type="button"
                    onClick={() => setEditingContext({ ...editingContext, template: `${editingContext.template || ''} <agent>Write a poetic expression</agent>` })}
                    className="bg-purple-100 dark:bg-purple-900/60 px-1 py-0.5 rounded text-purple-700 dark:text-purple-300 cursor-pointer"
                  >
                    + &lt;agent&gt;
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingContext({ ...editingContext, template: `${editingContext.template || ''} <history><agent>Consider prior tweets...</agent></history>` })}
                    className="bg-amber-100 dark:bg-amber-900/60 px-1 py-0.5 rounded text-amber-700 dark:text-amber-300 cursor-pointer"
                  >
                    + &lt;history&gt;&lt;agent&gt;
                  </button>
                  <span className="bg-neutral-100 dark:bg-neutral-800 px-1 py-0.5 rounded text-neutral-600 dark:text-neutral-300">{'{color_pick}'}</span>
                  <span className="bg-neutral-100 dark:bg-neutral-800 px-1 py-0.5 rounded text-neutral-600 dark:text-neutral-300">{'{hex}'}</span>
                  <span className="bg-neutral-100 dark:bg-neutral-800 px-1 py-0.5 rounded text-neutral-600 dark:text-neutral-300">{'{mood}'}</span>
                </div>

                {/* AI Preview Output in Modal */}
                {aiPreviewResult && (
                  <div className="p-2.5 bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800 rounded-lg text-xs space-y-1">
                    <div className="font-semibold text-purple-800 dark:text-purple-300 text-[11px] flex items-center justify-between">
                      <span>Live AI Output:</span>
                      <span className="font-mono">{aiPreviewResult.length} / 280</span>
                    </div>
                    <p className="text-neutral-800 dark:text-neutral-200 leading-relaxed font-sans">
                      {aiPreviewResult}
                    </p>
                  </div>
                )}
              </div>

              {/* Theme Preference */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="font-semibold text-neutral-700 dark:text-neutral-300">
                    Theme Preference
                  </label>
                  <select
                    value={editingContext.themePreference || 'dynamic'}
                    onChange={(e: any) => setEditingContext({ ...editingContext, themePreference: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="dynamic">Dynamic (Atmospheric)</option>
                    <option value="vibrant">Vibrant &amp; Saturated</option>
                    <option value="minimal">Minimal &amp; Modern</option>
                    <option value="poetic">Poetic &amp; Evocative</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="font-semibold text-neutral-700 dark:text-neutral-300">
                    Posting Mode
                  </label>
                  <select
                    value={editingContext.dryRun ? 'simulated' : 'live'}
                    onChange={(e) => setEditingContext({ ...editingContext, dryRun: e.target.value === 'simulated' })}
                    className="w-full px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="live">Live X API (Real Tweets)</option>
                    <option value="simulated">Dry Run (Simulated / Safe)</option>
                  </select>
                </div>
              </div>

              {/* Modal Buttons */}
              <div className="pt-3 border-t border-neutral-200 dark:border-neutral-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <span className="text-[11px] text-neutral-500">
                  Saving automatically clears and regenerates this campaign's 14-slot scheduled queue.
                </span>
                <div className="flex items-center justify-end gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setEditingContext(null)}
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
      )}
    </div>
  );
};

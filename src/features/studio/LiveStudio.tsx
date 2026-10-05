/**
 * X ChromaBot - LiveStudio
 * Loading gate plus the studio body that wires color, preview and posting together.
 */

import React, { useState } from 'react';
import { ColorData, BotSettings, DropResponse, TweetContext } from '../../types.js';
import { TargetTweetEditor } from '../../components/TargetTweetEditor.js';
import { substituteTemplate } from '../../../shared/template/substitute.js';
import { formatTimeInZone } from '../../../shared/time.js';
import {
  hasAgentTag as templateHasAgentTag,
  hasHistoryTag as templateHasHistoryTag,
} from '../../../shared/template/agentTags.js';
import { ColorCanvas } from './ColorCanvas.js';
import { TweetPreviewCard } from './TweetPreviewCard.js';
import { PostResultToast } from './PostResultToast.js';
import { StudioHeader, StudioSlot } from './StudioHeader.js';
import { useAiPreview } from './useAiPreview.js';

interface LiveStudioProps {
  color: ColorData | null;
  onGenerateColor: (slot: 'morning' | 'evening' | 'random') => void;
  onPostNow: (
    customColor?: ColorData,
    slotType?: 'morning' | 'evening' | 'manual',
    contextId?: string,
    opts?: { text?: string; hashtags?: string[]; slotId?: string },
  ) => Promise<DropResponse | undefined>;
  settings: BotSettings;
  isPosting: boolean;
  lastPostedResult: DropResponse | null;
  onUpdateTargetTweetId: (newId: string) => Promise<void>;
  contexts?: TweetContext[];
  activeContextId?: string;
  onSelectContext?: (id: string) => Promise<void>;
  onUpdateContext?: (id: string, updates: Partial<TweetContext>) => Promise<void>;
}

type LiveStudioReadyProps = Omit<LiveStudioProps, 'color'> & { color: ColorData };

const SLOT_BADGE: Record<StudioSlot, string> = {
  morning: 'Morning Slot',
  evening: 'Evening Slot',
  manual: 'Custom Slot',
};

/**
 * Loading gate: the studio body owns many hooks, so the "no color yet" state is rendered here
 * (before the hooks run) rather than as an early return in the middle of the body.
 */
export const LiveStudio: React.FC<LiveStudioProps> = ({ color, ...props }) => {
  if (!color) {
    return (
      <div className="p-12 text-center text-neutral-500">
        <div className="w-8 h-8 mx-auto mb-3 rounded-full border-2 border-neutral-300 border-t-neutral-800 animate-spin" />
        <p>Loading Chroma Engine...</p>
      </div>
    );
  }
  return <LiveStudioReady color={color} {...props} />;
};

const LiveStudioReady: React.FC<LiveStudioReadyProps> = ({
  color,
  onGenerateColor,
  onPostNow,
  settings,
  isPosting,
  lastPostedResult,
  onUpdateTargetTweetId,
  contexts = [],
  activeContextId = '',
  onSelectContext,
  onUpdateContext,
}) => {
  const [selectedSlot, setSelectedSlot] = useState<StudioSlot>('morning');
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const currentContext = contexts.find((c) => c.id === activeContextId) || contexts[0];
  const replyTargetMode =
    currentContext?.replyTargetMode || settings.replyTargetMode || 'original_post';
  const lastPostedTweetId = currentContext?.lastPostedTweetId || settings.lastPostedTweetId;

  const copyToClipboard = (text: string, fieldName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 1800);
  };

  const hasAgentTag = templateHasAgentTag(settings.template);
  const hasHistoryTag = templateHasHistoryTag(settings.template);

  const staticTweetText = substituteTemplate(settings.template, color, {
    slotLabel: formatTimeInZone(new Date(), settings.timezone),
    fallbackWeatherDesc: 'warming crisp morning air',
  });
  const evolving = currentContext?.hashtagEvolution?.enabled === true;
  const serverRendered = hasAgentTag || evolving;
  const { aiPreviewText, aiPreviewTags, isGeneratingAi, fetchAiPreview } = useAiPreview({
    serverRendered,
    refreshKey: (currentContext?.hashtagState?.current ?? []).join(','),
    template: settings.template,
    color,
    slotType: selectedSlot,
    contextId: activeContextId,
  });
  const tweetText = serverRendered ? aiPreviewText || staticTweetText : staticTweetText;

  const updateContext = async (updates: Partial<TweetContext>) => {
    if (currentContext && onUpdateContext) {
      await onUpdateContext(currentContext.id, updates);
    }
  };

  const pickSlot = (slot: StudioSlot) => {
    setSelectedSlot(slot);
    onGenerateColor(slot === 'manual' ? 'random' : slot);
  };

  return (
    <div className="space-y-6">
      <StudioHeader
        contexts={contexts}
        activeContextId={activeContextId}
        targetTweetId={settings.targetTweetId}
        selectedSlot={selectedSlot}
        onSelectContext={onSelectContext}
        onPickSlot={pickSlot}
      />

      <TargetTweetEditor
        currentTargetId={settings.targetTweetId}
        onSave={onUpdateTargetTweetId}
        replyTargetMode={replyTargetMode}
        engagementMode={currentContext?.engagementMode || settings.engagementMode || 'reply'}
        lastPostedTweetId={lastPostedTweetId}
        onToggleEngagementMode={(engagementMode) => updateContext({ engagementMode })}
        onToggleReplyTargetMode={(newMode) => updateContext({ replyTargetMode: newMode })}
        onResetChain={() => updateContext({ lastPostedTweetId: undefined })}
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div className="lg:col-span-7 space-y-6">
          <ColorCanvas
            color={color}
            slotBadge={SLOT_BADGE[selectedSlot]}
            copiedField={copiedField}
            onCopy={copyToClipboard}
          />
        </div>

        <div className="lg:col-span-5 space-y-4">
          <TweetPreviewCard
            color={color}
            tweetText={tweetText}
            targetTweetId={settings.targetTweetId}
            dryRun={settings.globalDryRun !== false || settings.dryRun}
            replyTargetMode={replyTargetMode}
            lastPostedTweetId={lastPostedTweetId}
            hasAgentTag={hasAgentTag}
            hasHistoryTag={hasHistoryTag}
            evolving={evolving}
            isGeneratingAi={isGeneratingAi}
            isPosting={isPosting}
            onRegenerate={fetchAiPreview}
            onPost={() =>
              onPostNow(color, selectedSlot, undefined, {
                // Post exactly what the preview shows (skip an agent tag's unresolved fallback).
                text: !serverRendered || aiPreviewText ? tweetText : undefined,
                hashtags: evolving ? aiPreviewTags : undefined,
              })
            }
          />
          {lastPostedResult && <PostResultToast lastPostedResult={lastPostedResult} />}
        </div>
      </div>
    </div>
  );
};

/**
 * X ChromaBot - LiveStudio
 * Loading gate plus the studio body: the tweet preview (with evolved hashtags) and the Post action.
 * The generated color is an invisible input; color controls only appear for color templates.
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
import { TweetPreviewCard } from './TweetPreviewCard.js';
import { PostResultToast } from './PostResultToast.js';
import { StudioHeader, StudioSlot } from './StudioHeader.js';
import { useAiPreview } from './useAiPreview.js';
import { templateUsesColor } from '../../lib/templateTokens.js';

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

/**
 * Loading gate: the studio body owns many hooks, so the "no color yet" state (the preview of a
 * color template needs it) is rendered here
 * (before the hooks run) rather than as an early return in the middle of the body.
 */
export const LiveStudio: React.FC<LiveStudioProps> = ({ color, ...props }) => {
  if (!color) {
    return (
      <div className="p-12 text-center text-neutral-500">
        <div className="w-8 h-8 mx-auto mb-3 rounded-full border-2 border-neutral-300 border-t-neutral-800 animate-spin" />
        <p>Loading studio...</p>
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

  const currentContext = contexts.find((c) => c.id === activeContextId) || contexts[0];
  const replyTargetMode =
    currentContext?.replyTargetMode || settings.replyTargetMode || 'original_post';
  const lastPostedTweetId = currentContext?.lastPostedTweetId || settings.lastPostedTweetId;

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
        showColorSlots={templateUsesColor(settings.template)}
        onSelectContext={onSelectContext}
        onPickSlot={pickSlot}
      />

      <div className="max-w-2xl mx-auto w-full space-y-4">
        <TweetPreviewCard
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
    </div>
  );
};

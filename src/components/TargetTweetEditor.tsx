import React, { useState } from 'react';
import {
  ExternalLink,
  Check,
  Edit2,
  RotateCcw,
  AlertCircle,
  MessageSquare,
  Link2,
  Target,
  Quote,
  Globe,
} from 'lucide-react';
import { useServerInfo } from '../context/serverInfo.js';
import { extractTweetId } from '../../shared/tweetId.js';
import { errorMessage } from '../lib/errors.js';

interface TargetTweetEditorProps {
  currentTargetId: string;
  onSave: (newTargetId: string) => Promise<void>;
  compact?: boolean;
  replyTargetMode?: 'original_post' | 'last_comment';
  engagementMode?: 'reply' | 'quote' | 'standalone';
  lastPostedTweetId?: string;
  onToggleReplyTargetMode?: (newMode: 'original_post' | 'last_comment') => Promise<void>;
  onToggleEngagementMode?: (newMode: 'reply' | 'quote' | 'standalone') => Promise<void>;
  onResetChain?: () => Promise<void>;
}

export const TargetTweetEditor: React.FC<TargetTweetEditorProps> = ({
  currentTargetId,
  onSave,
  compact = false,
  replyTargetMode = 'original_post',
  engagementMode = 'reply',
  lastPostedTweetId,
  onToggleReplyTargetMode,
  onToggleEngagementMode,
  onResetChain,
}) => {
  const { defaultTargetTweetId } = useServerInfo();
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState(currentTargetId || defaultTargetTweetId);
  const [isSaving, setIsSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detectedId = extractTweetId(inputValue);

  const handleSave = async () => {
    if (!detectedId) {
      setError('Please enter a valid numeric Tweet ID or full X/Twitter post URL.');
      return;
    }
    setError(null);
    setIsSaving(true);
    try {
      await onSave(detectedId);
      setSavedSuccess(true);
      setIsEditing(false);
      setTimeout(() => setSavedSuccess(false), 2500);
    } catch (err) {
      setError(errorMessage(err, 'Failed to save target tweet ID'));
    } finally {
      setIsSaving(false);
    }
  };

  if (compact) {
    return (
      <div className="relative inline-flex items-center">
        {!isEditing ? (
          <div className="flex items-center gap-1.5 text-xs bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-lg px-2.5 py-1">
            <MessageSquare className="w-3 h-3 text-neutral-500" />
            <span className="text-neutral-500">Replying to:</span>
            <a
              href={`https://x.com/i/status/${currentTargetId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono font-semibold text-neutral-900 dark:text-neutral-100 hover:text-blue-600 underline inline-flex items-center gap-0.5"
            >
              #
              {currentTargetId.length > 12
                ? `${currentTargetId.slice(0, 6)}...${currentTargetId.slice(-4)}`
                : currentTargetId}
              <ExternalLink className="w-2.5 h-2.5" />
            </a>
            <button
              onClick={() => {
                setInputValue(currentTargetId);
                setIsEditing(true);
              }}
              className="ml-1 text-[11px] font-medium text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100 underline cursor-pointer"
            >
              Change
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 bg-white dark:bg-neutral-900 border border-neutral-300 dark:border-neutral-700 rounded-lg p-1 shadow-md z-20">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                setError(null);
              }}
              placeholder="Paste Tweet ID or URL"
              className="px-2 py-0.5 text-xs font-mono border-none focus:outline-none bg-transparent text-neutral-900 dark:text-neutral-100 w-44"
              autoFocus
            />
            <button
              onClick={handleSave}
              disabled={isSaving || !detectedId}
              className="px-2 py-1 text-xs font-semibold rounded bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:opacity-90 disabled:opacity-40 cursor-pointer"
            >
              Save
            </button>
            <button
              onClick={() => setIsEditing(false)}
              className="px-1.5 py-1 text-xs text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 cursor-pointer"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="border border-neutral-200 dark:border-neutral-800 rounded-xl p-4 sm:p-5 bg-white dark:bg-neutral-900 space-y-3.5 shadow-xs">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center">
            <MessageSquare className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-700 dark:text-neutral-300">
              Target Reply Post
            </h3>
            <p className="text-xs text-neutral-500">
              The X post where ChromaBot posts automated chromatic color drops.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {savedSuccess && (
            <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
              <Check className="w-3 h-3" /> Updated
            </span>
          )}
          <a
            href={`https://x.com/i/status/${currentTargetId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-neutral-600 dark:text-neutral-400 hover:text-blue-600 font-mono inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 hover:bg-neutral-100"
          >
            View on X <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>

      {!isEditing ? (
        <div className="flex items-center justify-between p-3 rounded-lg bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800">
          <div className="flex items-center gap-2.5 font-mono text-sm">
            <span className="text-neutral-400">Post ID:</span>
            <span className="font-bold text-neutral-900 dark:text-neutral-100 tracking-wide">
              {currentTargetId}
            </span>
          </div>

          <button
            onClick={() => {
              setInputValue(currentTargetId);
              setIsEditing(true);
            }}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-neutral-900 hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200 text-white flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Edit2 className="w-3 h-3" />
            Change Target Post ID
          </button>
        </div>
      ) : (
        <div className="space-y-3 p-4 rounded-lg bg-neutral-50 dark:bg-neutral-950 border border-neutral-300 dark:border-neutral-700">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
              Paste New Post ID or Full X/Twitter URL:
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={inputValue}
                onChange={(e) => {
                  setInputValue(e.target.value);
                  setError(null);
                }}
                placeholder="Tweet ID or https://x.com/username/status/..."
                className="flex-1 px-3 py-2 text-sm font-mono border border-neutral-300 dark:border-neutral-700 rounded-lg bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
              />
              <button
                onClick={handleSave}
                disabled={isSaving || !detectedId}
                className="px-4 py-2 text-xs font-bold rounded-lg bg-blue-600 hover:bg-blue-700 text-white flex items-center gap-1.5 cursor-pointer disabled:opacity-40 transition-colors shadow-xs"
              >
                {isSaving ? 'Saving...' : 'Save Target'}
              </button>
              <button
                onClick={() => setIsEditing(false)}
                className="px-3 py-2 text-xs font-medium rounded-lg border border-neutral-300 dark:border-neutral-700 text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>

          {detectedId && (
            <div className="flex items-center justify-between text-xs text-neutral-600 dark:text-neutral-400 bg-white dark:bg-neutral-900 p-2.5 rounded border border-neutral-200 dark:border-neutral-800">
              <span className="flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5 text-emerald-600" />
                Detected Post ID:{' '}
                <strong className="font-mono text-neutral-900 dark:text-neutral-100">
                  {detectedId}
                </strong>
              </span>
              <a
                href={`https://x.com/i/status/${detectedId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 dark:text-blue-400 underline hover:opacity-80 inline-flex items-center gap-0.5"
              >
                Preview on X <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}

          {error && (
            <div className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1.5 bg-red-50 dark:bg-red-950/40 p-2 rounded border border-red-200 dark:border-red-900">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            <span className="text-[11px] text-neutral-400">
              Tip: You can paste directly from your browser's address bar.
            </span>
          </div>
        </div>
      )}
      {/* Engagement Mode Selector: Direct Reply vs Quote Tweet */}
      {onToggleEngagementMode && (
        <div className="pt-3 border-t border-neutral-100 dark:border-neutral-800/80 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-neutral-700 dark:text-neutral-300 flex items-center gap-1.5">
              <span>Engagement Style:</span>
            </span>

            <div className="flex items-center p-0.5 bg-neutral-100 dark:bg-neutral-800 rounded-lg text-xs">
              <button
                type="button"
                onClick={() => onToggleEngagementMode('reply')}
                className={`px-2.5 py-1 font-medium rounded-md transition-colors flex items-center gap-1 cursor-pointer ${
                  engagementMode === 'reply'
                    ? 'bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100 shadow-xs font-semibold'
                    : 'text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'
                }`}
                title="Post as in-thread comment reply"
              >
                <MessageSquare className="w-3 h-3 text-blue-500" />
                <span>Direct Reply</span>
              </button>

              <button
                type="button"
                onClick={() => onToggleEngagementMode('quote')}
                className={`px-2.5 py-1 font-medium rounded-md transition-colors flex items-center gap-1 cursor-pointer ${
                  engagementMode === 'quote'
                    ? 'bg-amber-600 text-white shadow-xs font-semibold'
                    : 'text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'
                }`}
                title="Embed target post as a Quote Tweet on timeline (Supported across all X API tiers)"
              >
                <Quote className="w-3 h-3" />
                <span>Quote Tweet</span>
              </button>

              <button
                type="button"
                onClick={() => onToggleEngagementMode('standalone')}
                className={`px-2.5 py-1 font-medium rounded-md transition-colors flex items-center gap-1 cursor-pointer ${
                  engagementMode === 'standalone'
                    ? 'bg-emerald-600 text-white shadow-xs font-semibold'
                    : 'text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'
                }`}
                title="Post standalone drop to your timeline"
              >
                <Globe className="w-3 h-3" />
                <span>Timeline</span>
              </button>
            </div>
          </div>
          <p className="text-[11px] text-neutral-500">
            {engagementMode === 'quote'
              ? '💡 Quote Tweet mode embeds the target post directly into your timeline drop. 100% permitted on all X developer tiers.'
              : engagementMode === 'standalone'
                ? "💡 Standalone mode publishes chromatic drops directly to your account's feed."
                : "💡 Direct Reply posts into the target post's comments. If X restricts replies, you can enable the Quote Tweet fallback in the campaign settings."}
          </p>
        </div>
      )}

      {/* Reply Threading Strategy Toggle Pill */}
      {onToggleReplyTargetMode && (
        <div className="pt-3 border-t border-neutral-100 dark:border-neutral-800/80 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-neutral-700 dark:text-neutral-300 flex items-center gap-1.5">
              <span>Reply Mode:</span>
            </span>

            {/* Segmented Toggle Control */}
            <div className="flex items-center p-0.5 bg-neutral-100 dark:bg-neutral-800 rounded-lg text-xs">
              <button
                type="button"
                onClick={() => onToggleReplyTargetMode('original_post')}
                className={`px-3 py-1 font-medium rounded-md transition-colors flex items-center gap-1.5 cursor-pointer ${
                  replyTargetMode === 'original_post'
                    ? 'bg-white dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100 shadow-xs font-semibold'
                    : 'text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'
                }`}
              >
                <Target className="w-3 h-3 text-blue-500" />
                <span>Original Post</span>
              </button>

              <button
                type="button"
                onClick={() => onToggleReplyTargetMode('last_comment')}
                className={`px-3 py-1 font-medium rounded-md transition-colors flex items-center gap-1.5 cursor-pointer ${
                  replyTargetMode === 'last_comment'
                    ? 'bg-purple-600 text-white shadow-xs font-semibold'
                    : 'text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'
                }`}
              >
                <Link2 className="w-3 h-3" />
                <span>Last Comment (Chain)</span>
              </button>
            </div>
          </div>

          <div className="text-[11px] text-neutral-500 dark:text-neutral-400 leading-normal flex items-center justify-between gap-2">
            <div>
              {replyTargetMode === 'original_post' ? (
                <span>
                  Every post branches directly under root post{' '}
                  <strong className="font-mono">#{currentTargetId}</strong>.
                </span>
              ) : (
                <span>
                  Each next drop replies to the previous comment made by us.
                  {lastPostedTweetId ? (
                    <span>
                      {' '}
                      Next drop attaches to{' '}
                      <strong className="font-mono">#{lastPostedTweetId}</strong>.
                    </span>
                  ) : (
                    <span>
                      {' '}
                      Debut drop initiates chain at{' '}
                      <strong className="font-mono">#{currentTargetId}</strong>.
                    </span>
                  )}
                </span>
              )}
            </div>

            {replyTargetMode === 'last_comment' && lastPostedTweetId && onResetChain && (
              <button
                type="button"
                onClick={onResetChain}
                className="text-[10px] text-amber-700 dark:text-amber-300 hover:underline flex items-center gap-1 cursor-pointer shrink-0 font-medium"
                title="Restart chain from original root post"
              >
                <RotateCcw className="w-2.5 h-2.5" />
                <span>Reset to Root</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

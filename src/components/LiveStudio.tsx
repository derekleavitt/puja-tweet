import React, { useState } from 'react';
import { Sun, Moon, Shuffle, Send, ExternalLink, Check, Copy, AlertCircle, ArrowUpRight } from 'lucide-react';
import { ColorData, BotSettings } from '../types.js';
import { TargetTweetEditor } from './TargetTweetEditor.js';

interface LiveStudioProps {
  color: ColorData | null;
  onGenerateColor: (slot: 'morning' | 'evening' | 'random') => void;
  onPostNow: (customColor?: ColorData, slotType?: 'morning' | 'evening' | 'manual') => Promise<any>;
  settings: BotSettings;
  isPosting: boolean;
  lastPostedResult: any;
  onUpdateTargetTweetId: (newId: string) => Promise<void>;
}

export const LiveStudio: React.FC<LiveStudioProps> = ({
  color,
  onGenerateColor,
  onPostNow,
  settings,
  isPosting,
  lastPostedResult,
  onUpdateTargetTweetId,
}) => {
  const [selectedSlot, setSelectedSlot] = useState<'morning' | 'evening' | 'manual'>('morning');
  const [copiedField, setCopiedField] = useState<string | null>(null);

  if (!color) {
    return (
      <div className="p-12 text-center text-neutral-500">
        <div className="w-8 h-8 mx-auto mb-3 rounded-full border-2 border-neutral-300 border-t-neutral-800 animate-spin" />
        <p>Loading Chroma Engine...</p>
      </div>
    );
  }

  const copyToClipboard = (text: string, fieldName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 1800);
  };

  const slotLabel = selectedSlot === 'morning' ? '6:00 AM' : selectedSlot === 'evening' ? '6:00 PM' : 'Live Drop';

  // Construct Tweet text based on settings template
  const colorPick = color.colorPick || color.name;
  const weatherDesc = color.weatherDesc || 'warming crisp morning air';
  const weatherTweet = `${colorPick} ${weatherDesc} #eternal #colors`;

  const tweetText = settings.template
    .replace(/{weather_tweet}/g, weatherTweet)
    .replace(/{color_pick}/g, colorPick)
    .replace(/{weather_desc}/g, weatherDesc)
    .replace(/{weather_description}/g, weatherDesc)
    .replace(/{time_tag}/g, slotLabel)
    .replace(/{color_name}/g, color.name)
    .replace(/{hex}/g, color.hex)
    .replace(/{rgb}/g, `${color.rgb.r}, ${color.rgb.g}, ${color.rgb.b}`)
    .replace(/{hsl}/g, `${color.hsl.h}°, ${color.hsl.s}%, ${color.hsl.l}%`)
    .replace(/{cmyk}/g, `C:${color.cmyk.c}% M:${color.cmyk.m}% Y:${color.cmyk.y}% K:${color.cmyk.k}%`)
    .replace(/{mood}/g, color.mood)
    .replace(/{swatch_bar}/g, color.swatchBar)
    .replace(/{companions}/g, color.companions.join(' '));

  const charCount = tweetText.length;
  const isOverLimit = charCount > 280;
  const weatherWordsCount = (color.weatherDesc || '').split(/\s+/).filter(Boolean).length;

  return (
    <div className="space-y-6">
      {/* Top Banner / Goal-to-Mechanism */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-neutral-200 dark:border-neutral-800">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">
            Chromatic Post Studio
          </h1>
          <p className="text-sm text-neutral-500 mt-0.5">
            Automated reply generator targeting X status{' '}
            <a
              href={`https://x.com/i/status/${settings.targetTweetId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-neutral-800 dark:text-neutral-200 underline hover:text-blue-600 inline-flex items-center gap-0.5"
            >
              #{settings.targetTweetId}
              <ArrowUpRight className="w-3.5 h-3.5" />
            </a>
          </p>
        </div>

        {/* Quick Slot Generator Selectors */}
        <div className="flex items-center gap-1.5 p-1 bg-neutral-100 dark:bg-neutral-900 rounded-lg self-start sm:self-auto">
          <button
            onClick={() => {
              setSelectedSlot('morning');
              onGenerateColor('morning');
            }}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 cursor-pointer ${
              selectedSlot === 'morning'
                ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 shadow-xs'
                : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200'
            }`}
          >
            <Sun className="w-3.5 h-3.5 text-amber-500" />
            6:00 AM Dawn
          </button>

          <button
            onClick={() => {
              setSelectedSlot('evening');
              onGenerateColor('evening');
            }}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 cursor-pointer ${
              selectedSlot === 'evening'
                ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 shadow-xs'
                : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200'
            }`}
          >
            <Moon className="w-3.5 h-3.5 text-indigo-400" />
            6:00 PM Dusk
          </button>

          <button
            onClick={() => {
              setSelectedSlot('manual');
              onGenerateColor('random');
            }}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1.5 cursor-pointer ${
              selectedSlot === 'manual'
                ? 'bg-white dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 shadow-xs'
                : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-200'
            }`}
          >
            <Shuffle className="w-3.5 h-3.5 text-rose-500" />
            Random Pick
          </button>
        </div>
      </div>

      {/* Target Tweet Quick Editor */}
      <TargetTweetEditor
        currentTargetId={settings.targetTweetId}
        onSave={onUpdateTargetTweetId}
      />

      {/* Main Grid: Left Color Canvas | Right X Tweet Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left Column: Visual Swatch Card (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          <div className="border border-neutral-200 dark:border-neutral-800 rounded-xl overflow-hidden bg-white dark:bg-neutral-900 shadow-xs">
            {/* Color Canvas Header Swatch */}
            <div
              className="h-56 w-full p-6 flex flex-col justify-between transition-colors duration-500 relative"
              style={{ backgroundColor: color.hex }}
            >
              <div className="flex items-center justify-between">
                <span
                  className="px-2.5 py-1 text-xs font-mono font-medium rounded-md shadow-xs backdrop-blur-md"
                  style={{
                    backgroundColor: color.contrastText === '#000000' ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.5)',
                    color: color.contrastText === '#000000' ? '#111' : '#fff',
                  }}
                >
                  {selectedSlot === 'morning' ? '6:00 AM Slot' : selectedSlot === 'evening' ? '6:00 PM Slot' : 'Custom Slot'}
                </span>

                <button
                  onClick={() => copyToClipboard(color.hex, 'hex-canvas')}
                  className="px-2.5 py-1 text-xs font-mono font-semibold rounded-md shadow-xs backdrop-blur-md flex items-center gap-1 cursor-pointer"
                  style={{
                    backgroundColor: color.contrastText === '#000000' ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.5)',
                    color: color.contrastText === '#000000' ? '#111' : '#fff',
                  }}
                >
                  {copiedField === 'hex-canvas' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  {color.hex}
                </button>
              </div>

              {/* Big Display Name */}
              <div style={{ color: color.contrastText }}>
                <h2 className="text-3xl font-extrabold tracking-tight drop-shadow-xs">
                  {color.name}
                </h2>
                <p className="text-sm opacity-90 font-medium max-w-lg mt-1 line-clamp-2">
                  "{color.mood}"
                </p>
              </div>
            </div>

            {/* Color Metrics Grid */}
            <div className="p-6 grid grid-cols-2 sm:grid-cols-4 gap-4 border-b border-neutral-200 dark:border-neutral-800 text-xs">
              <div className="space-y-1">
                <span className="text-neutral-500 uppercase font-semibold text-[10px] tracking-wider">HEX Code</span>
                <div className="font-mono font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-1.5 tabular-nums">
                  <span className="w-3 h-3 rounded-full inline-block border border-neutral-300 dark:border-neutral-700" style={{ backgroundColor: color.hex }} />
                  {color.hex}
                </div>
              </div>

              <div className="space-y-1">
                <span className="text-neutral-500 uppercase font-semibold text-[10px] tracking-wider">RGB Values</span>
                <div className="font-mono text-neutral-900 dark:text-neutral-100 tabular-nums">
                  {color.rgb.r}, {color.rgb.g}, {color.rgb.b}
                </div>
              </div>

              <div className="space-y-1">
                <span className="text-neutral-500 uppercase font-semibold text-[10px] tracking-wider">HSL Profile</span>
                <div className="font-mono text-neutral-900 dark:text-neutral-100 tabular-nums">
                  {color.hsl.h}°, {color.hsl.s}%, {color.hsl.l}%
                </div>
              </div>

              <div className="space-y-1">
                <span className="text-neutral-500 uppercase font-semibold text-[10px] tracking-wider">CMYK Print</span>
                <div className="font-mono text-neutral-900 dark:text-neutral-100 tabular-nums">
                  {color.cmyk.c}, {color.cmyk.m}, {color.cmyk.y}, {color.cmyk.k}
                </div>
              </div>
            </div>

            {/* Harmonious Companions Bar */}
            <div className="p-6">
              <div className="flex items-center justify-between mb-3 text-xs">
                <span className="font-semibold text-neutral-700 dark:text-neutral-300">Harmonious Palette Bar</span>
                <span className="text-neutral-400 font-mono text-[11px]">Analogous · Triad · Complementary</span>
              </div>

              <div className="grid grid-cols-5 gap-2 h-12 rounded-lg overflow-hidden border border-neutral-200 dark:border-neutral-800">
                <div
                  className="flex items-end justify-center pb-1 text-[10px] font-mono font-bold transition-transform hover:scale-105"
                  style={{ backgroundColor: color.hex, color: color.contrastText }}
                  title={`Primary: ${color.hex}`}
                >
                  Base
                </div>
                {color.companions.map((compHex, idx) => (
                  <div
                    key={idx}
                    onClick={() => copyToClipboard(compHex, `comp-${idx}`)}
                    className="flex items-end justify-center pb-1 text-[10px] font-mono cursor-pointer transition-transform hover:scale-105"
                    style={{ backgroundColor: compHex, color: '#FFFFFF' }}
                    title={`Click to copy: ${compHex}`}
                  >
                    {copiedField === `comp-${idx}` ? 'Copied' : compHex}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Authentic Twitter / X Reply Card (5 cols) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="border border-neutral-200 dark:border-neutral-800 rounded-xl p-5 bg-white dark:bg-neutral-900 shadow-xs space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-neutral-100 dark:border-neutral-800 text-xs">
              <span className="font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
                X Live Reply Preview
              </span>

              <span
                className={`font-mono tabular-nums ${
                  isOverLimit ? 'text-red-500 font-bold' : 'text-neutral-400'
                }`}
              >
                {charCount} / 280
              </span>
            </div>

            {/* Target Post Context indicator & Weather Breakdown */}
            <div className="bg-neutral-50 dark:bg-neutral-950/60 rounded-lg p-3 text-xs border border-neutral-200 dark:border-neutral-800 space-y-2">
              <div className="flex items-center justify-between text-neutral-500">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                  Replying directly to:
                </span>
                <a
                  href={`https://x.com/i/status/${settings.targetTweetId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-neutral-800 dark:text-neutral-200 hover:text-blue-600 font-medium"
                >
                  #{settings.targetTweetId}
                </a>
              </div>

              {color.weatherDesc && (
                <div className="pt-2 border-t border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-neutral-600 dark:text-neutral-400">
                    <span className="text-amber-500">🌤️</span>
                    <span>Weather ({weatherWordsCount} words):</span>
                    <strong className="text-neutral-900 dark:text-neutral-100 font-medium">
                      "{color.weatherDesc}"
                    </strong>
                  </div>
                  <span className="text-[10px] font-mono bg-neutral-200 dark:bg-neutral-800 px-1.5 py-0.5 rounded text-neutral-700 dark:text-neutral-300">
                    #eternal #colors
                  </span>
                </div>
              )}
            </div>

            {/* Tweet Mockup Card */}
            <div className="space-y-3 pt-1">
              <div className="flex items-center gap-2.5">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shadow-xs"
                  style={{ backgroundColor: color.hex }}
                >
                  🎨
                </div>
                <div>
                  <div className="flex items-center gap-1.5 leading-none">
                    <span className="font-bold text-sm text-neutral-900 dark:text-neutral-100">
                      ChromaBot
                    </span>
                    <span className="text-xs text-neutral-500">@chromabot</span>
                    <span className="text-xs text-neutral-400">· Now</span>
                  </div>
                  <div className="text-xs text-neutral-500 mt-1">
                    Replying to <span className="text-blue-500">@pfinallyhere</span>
                  </div>
                </div>
              </div>

              {/* Formatted Text Box */}
              <div className="bg-neutral-50 dark:bg-neutral-950 p-3.5 rounded-lg border border-neutral-100 dark:border-neutral-800 text-sm font-sans text-neutral-800 dark:text-neutral-200 whitespace-pre-line leading-relaxed selection:bg-neutral-200">
                {tweetText}
              </div>

              {/* Tweet Action Icons */}
              <div className="flex items-center justify-between text-neutral-400 text-xs px-2 pt-1 border-t border-neutral-100 dark:border-neutral-800/60">
                <span>💬 0</span>
                <span>🔁 0</span>
                <span>❤️ 0</span>
                <span>📊 1</span>
              </div>
            </div>

            {/* Primary Action Button */}
            <div className="pt-2 space-y-2">
              <button
                onClick={() => onPostNow(color, selectedSlot)}
                disabled={isPosting || isOverLimit}
                className="w-full py-2.5 px-4 bg-neutral-900 hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-200 text-white text-sm font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer shadow-xs"
              >
                {isPosting ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Posting to X...
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    {settings.dryRun ? 'Simulate Post to X' : 'Post Reply to X Now'}
                  </>
                )}
              </button>

              <div className="flex items-center justify-between text-[11px] text-neutral-500 px-1">
                <span>
                  Mode: <strong className="text-neutral-700 dark:text-neutral-300">{settings.dryRun ? 'Dry Run Simulation' : 'Live X API'}</strong>
                </span>
                <a
                  href={`https://x.com/i/status/${settings.targetTweetId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline hover:text-blue-600 dark:hover:text-blue-400 font-mono inline-flex items-center gap-1"
                >
                  Target: #{settings.targetTweetId} <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>
            </div>
          </div>

          {/* Feedback / Last Post Toast */}
          {lastPostedResult && (
            <div
              className={`p-4 rounded-xl border text-xs space-y-1.5 transition-all ${
                lastPostedResult.success
                  ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                  : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800 text-red-900 dark:text-red-200'
              }`}
            >
              <div className="flex items-center justify-between font-semibold">
                <span className="flex items-center gap-1.5">
                  {lastPostedResult.success ? (
                    <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
                  )}
                  {lastPostedResult.result?.simulated
                    ? 'Reply Simulated Successfully'
                    : lastPostedResult.success
                    ? 'Reply Successfully Posted to X!'
                    : 'Failed to Post Reply'}
                </span>
                {lastPostedResult.result?.url && (
                  <a
                    href={lastPostedResult.result.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline font-mono inline-flex items-center gap-1 hover:text-blue-600"
                  >
                    View on X <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
              <p className="text-[11px] opacity-90 leading-relaxed">
                {lastPostedResult.result?.simulated
                  ? 'Simulated payload validated. Simulated replies show exact text, character count, and time tags without spending X credits.'
                  : lastPostedResult.success
                  ? `Tweet ID: ${lastPostedResult.result?.tweetId}`
                  : `Error: ${lastPostedResult.error || lastPostedResult.result?.error}`}
              </p>

              {!lastPostedResult.success && (lastPostedResult.error || '').includes('Credits Depleted') && (
                <div className="mt-2 pt-2 border-t border-red-200 dark:border-red-800/60 text-[11px] space-y-1">
                  <p className="font-medium text-red-900 dark:text-red-200">
                    💡 Why this happens: Your account is verified as <strong>@bhaijahndai</strong>, but X (Twitter) now requires prepaid developer credits to send live automated tweets.
                  </p>
                  <div className="flex items-center gap-3 pt-1">
                    <a
                      href="https://developer.x.com/en/portal/billing"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline font-semibold inline-flex items-center gap-1 text-red-800 dark:text-red-200 hover:text-blue-600"
                    >
                      Open X Billing / Credits Portal <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

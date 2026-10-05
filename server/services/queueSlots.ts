/**
 * Pure builders for upcoming-queue slots (preview colour + rendered tweet text).
 */

import { ColorData, DEFAULT_TWEET_TEMPLATE, generateColor } from '../colorEngine.js';
import { substituteTemplate } from '../../shared/template/substitute.js';
import { stripAgentTags } from '../../shared/template/agentTags.js';
import type { QueueSlot, TweetContext } from '../../shared/types.js';
import { appendTagBlock, dedupeHashtags } from '../../shared/hashtags/index.js';

export const QUEUE_SLOTS_PER_CONTEXT = 14;

export const formatSlotPreviewText = (
  template: string,
  color: ColorData,
  slotLabel: string,
  hashtags: readonly string[] = [],
): string => {
  const colorPick = color.colorPick || color.name;
  const weatherDesc = color.weatherDesc || 'warming crisp morning air';
  const weatherTweet = `${colorPick} ${weatherDesc} #eternal #colors`;

  const substituted = substituteTemplate(template || DEFAULT_TWEET_TEMPLATE, color, {
    slotLabel,
    fallbackWeatherDesc: 'warming crisp morning air',
  });
  // AI text is only written when the post goes out; never show color/hex or the raw prompt here.
  const resolved = stripAgentTags(substituted);
  // The campaign's own tags are appended like at post time (evolved tags are only picked then).
  const body = resolved.trim() ? dedupeHashtags(resolved, hashtags).text : '';
  return body || hashtags.length ? appendTagBlock(body, hashtags) : weatherTweet;
};

const intervalSlotTime = (
  futureDate: Date,
  tz: string,
): { dateStr: string; timeSlot: string; isMorning: boolean } => {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(futureDate);
    const y = parts.find((p) => p.type === 'year')?.value || '2026';
    const m = parts.find((p) => p.type === 'month')?.value || '01';
    const d = parts.find((p) => p.type === 'day')?.value || '01';
    const hr = parseInt(parts.find((p) => p.type === 'hour')?.value || '6', 10) % 24;
    const mn = parts.find((p) => p.type === 'minute')?.value || '00';
    return {
      dateStr: `${y}-${m}-${d}`,
      timeSlot: `${hr.toString().padStart(2, '0')}:${mn}`,
      isMorning: hr < 12,
    };
  } catch {
    const hr = futureDate.getUTCHours();
    const mn = futureDate.getUTCMinutes().toString().padStart(2, '0');
    return {
      dateStr: futureDate.toISOString().split('T')[0],
      timeSlot: `${hr.toString().padStart(2, '0')}:${mn}`,
      isMorning: hr < 12,
    };
  }
};

export const createQueueSlotForContext = (
  ctx: TweetContext,
  slotIndex: number,
  baseTimeMs = Date.now(),
): QueueSlot => {
  const tz =
    !ctx.schedule?.timezone || ctx.schedule.timezone === 'MST'
      ? 'America/Denver'
      : ctx.schedule.timezone;

  let dateStr: string;
  let timeSlot: string;
  let slotType: 'morning' | 'evening';
  let slotId: string;
  const suffix = Math.random().toString(36).substring(2, 6);

  if (ctx.schedule?.mode === 'interval') {
    const intervalMins = Math.max(1, ctx.schedule.intervalMinutes || 15);
    const futureDate = new Date(baseTimeMs + (slotIndex + 1) * intervalMins * 60 * 1000);
    const t = intervalSlotTime(futureDate, tz);
    dateStr = t.dateStr;
    timeSlot = t.timeSlot;
    slotType = t.isMorning ? 'morning' : 'evening';
    slotId = `slot_${ctx.id}_${Date.now()}_${slotIndex}_${suffix}`;
  } else {
    const times = ctx.schedule?.scheduleTimes?.length
      ? ctx.schedule.scheduleTimes
      : ['06:00', '18:00'];
    const dayOffset = Math.floor(slotIndex / times.length);
    timeSlot = times[slotIndex % times.length] || '06:00';
    slotType = parseInt(timeSlot.split(':')[0] || '6', 10) < 12 ? 'morning' : 'evening';
    dateStr = new Date(baseTimeMs + dayOffset * 86400000).toISOString().split('T')[0];
    slotId = `slot_${ctx.id}_${dateStr}_${timeSlot}_${slotIndex}_${suffix}`;
  }

  const color = generateColor(slotType);
  return {
    slotId,
    dateStr,
    timeSlot,
    slotType,
    color,
    contextId: ctx.id,
    contextName: ctx.name,
    previewText: formatSlotPreviewText(ctx.template, color, timeSlot, ctx.hashtags ?? []),
    targetTweetId: ctx.targetTweetId,
    replyTargetMode: ctx.replyTargetMode || 'original_post',
  };
};

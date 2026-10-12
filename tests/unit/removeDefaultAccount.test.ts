/**
 * The one-time removal of the built-in default account (`acct_env`): campaigns move to the id the
 * account gets once connected (`acct_<userId>`) and wait for it, paused; it runs once per store.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  LEGACY_DEFAULT_ACCOUNT_ID,
  removeDefaultAccount,
} from '../../server/migration/removeDefaultAccount.js';
import { createServices } from '../../server/services/index.js';
import { createDefaultState, normalizeState } from '../../server/store/defaults.js';
import { MemoryStore } from '../../server/store/MemoryStore.js';
import type { BotState } from '../../server/store/Store.js';
import type { TweetContext } from '../../shared/types.js';

vi.spyOn(console, 'warn').mockImplementation(() => {});

const single = (name: string, accountId?: string): TweetContext =>
  ({ id: `ctx_${name}`, name, enabled: true, accountId, schedule: {} }) as TweetContext;

const conversation = (name: string): TweetContext =>
  ({
    id: `ctx_${name}`,
    name,
    enabled: true,
    mode: 'conversation',
    schedule: {},
    conversation: {
      participants: [
        { accountId: LEGACY_DEFAULT_ACCOUNT_ID, persona: 'a' },
        { accountId: 'acct_2', persona: 'b' },
      ],
      sharedPrompt: '',
      openingPost: '',
      firstSpeakerAccountId: LEGACY_DEFAULT_ACCOUNT_ID,
    },
    conversationState: {
      runId: 'r',
      turnCount: 1,
      nextSpeakerAccountId: LEGACY_DEFAULT_ACCOUNT_ID,
      turns: [
        {
          turn: 1,
          accountId: LEGACY_DEFAULT_ACCOUNT_ID,
          handle: 'bhaijahndai',
          text: 'hi',
          at: '',
        },
      ],
    },
  }) as TweetContext;

/** A store written before the removal (raw data, as loaded from Firestore). */
const legacyState = (extra: Record<string, unknown> = {}): BotState =>
  normalizeState({
    contexts: [
      single('A'),
      single('B', LEGACY_DEFAULT_ACCOUNT_ID),
      single('C', 'acct_2'),
      conversation('T'),
    ],
    accounts: [{ id: 'acct_2', userId: '2', handle: 'two', encrypted: 'x', status: 'ok' }],
    defaultAccount: { handle: 'bhaijahndai', userId: '1925' },
    accountCooldowns: { acct_env: { untilMs: 1, reason: 'x', lastThrottledAt: '' } },
    wipeJobs: { acct_env: {} },
    ...extra,
  });

describe('removeDefaultAccount', () => {
  it('moves its campaigns to the account it will be connected as, and pauses them meanwhile', () => {
    const state = legacyState();
    const { ran, paused } = removeDefaultAccount(state);
    expect(ran).toBe(true);
    expect(paused).toEqual(['A', 'B', 'T']);
    const [a, b, c, t] = state.contexts;
    expect(a).toMatchObject({ accountId: 'acct_1925', enabled: false });
    expect(a.autoPausedReason).toBe(
      '@bhaijahndai is no longer built in: connect it in Settings → X accounts, then resume',
    );
    expect(b).toMatchObject({ accountId: 'acct_1925', enabled: false });
    expect(c).toMatchObject({ accountId: 'acct_2', enabled: true }); // untouched
    expect(t.conversation?.participants.map((p) => p.accountId)).toEqual(['acct_1925', 'acct_2']);
    expect(t.conversation?.firstSpeakerAccountId).toBe('acct_1925');
    expect(t.conversationState?.nextSpeakerAccountId).toBe('acct_1925');
    expect(t.conversationState?.turns?.[0].accountId).toBe('acct_1925');
    expect(t).toMatchObject({ enabled: false });
    expect(state.defaultAccount).toBeUndefined();
    expect(state.accountCooldowns).toEqual({});
    expect(state.wipeJobs).toEqual({});
    expect(state.defaultAccountRemoved).toBe(true);
  });

  it('keeps campaigns running when that account is already connected', () => {
    const state = legacyState({
      accounts: [
        { id: 'acct_2', userId: '2', handle: 'two', encrypted: 'x', status: 'ok' },
        { id: 'acct_1925', userId: '1925', handle: 'bhaijahndai', encrypted: 'y', status: 'ok' },
      ],
    });
    expect(removeDefaultAccount(state).paused).toEqual([]);
    expect(state.contexts.every((c) => c.enabled)).toBe(true);
    expect(state.contexts[0].accountId).toBe('acct_1925');
  });

  it('without a known user id: no account for single campaigns, the cast keeps the old id', () => {
    const state = legacyState({ defaultAccount: {} });
    removeDefaultAccount(state);
    expect(state.contexts[0]).toMatchObject({ accountId: undefined, enabled: false });
    expect(state.contexts[0].autoPausedReason).toMatch(/pick a connected account/);
    expect(state.contexts[3].conversation?.participants[0].accountId).toBe('acct_env');
    expect(state.contexts[3].enabled).toBe(false);
  });

  it('runs once: later campaigns without an account are left alone', () => {
    const state = legacyState();
    removeDefaultAccount(state);
    state.contexts.push(single('new'));
    expect(removeDefaultAccount(state)).toEqual({ ran: false, paused: [] });
    expect(state.contexts[4]).toMatchObject({ enabled: true, accountId: undefined });
    // A brand-new store never needs it.
    expect(createDefaultState().defaultAccountRemoved).toBe(true);
  });

  it('runs at startup on an old store and persists that it ran', async () => {
    const store = new MemoryStore();
    await store.save(legacyState());
    const svc = await createServices(store);
    expect(svc.contexts.getContext('ctx_A')).toMatchObject({
      accountId: 'acct_1925',
      enabled: false,
    });
    expect(svc.accounts.list().map((a) => a.id)).toEqual(['acct_2']);
    await svc.flush();
    const saved = await store.load();
    expect(saved.defaultAccountRemoved).toBe(true);
    expect(saved.defaultAccount).toBeUndefined();
  });
});

/**
 * SEC-2: every /api route except health and the secret-protected triggers needs an admin ID token.
 */

import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { makeApp } from '../helpers/makeApp.js';

vi.mock('../../server/twitterClient.js');

const verifyToken = async (token: string) => {
  if (token === 'admin-token') return { email: 'admin@example.com', email_verified: true };
  if (token === 'other-token') return { email: 'someone@example.com', email_verified: true };
  throw new Error('invalid token');
};

const app = makeApp({ verifyToken, authorizedEmails: ['admin@example.com'] });

describe('SEC-2 auth', () => {
  it('rejects requests without a token with 401', async () => {
    const res = await request(app).get('/api/status');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it('rejects an invalid token with 401', async () => {
    const res = await request(app).get('/api/status').set('Authorization', 'Bearer junk');
    expect(res.status).toBe(401);
  });

  it('rejects a valid token for a non-admin email with 403', async () => {
    const res = await request(app).get('/api/status').set('Authorization', 'Bearer other-token');
    expect(res.status).toBe(403);
  });

  it('allows an allow-listed admin', async () => {
    const res = await request(app).get('/api/status').set('Authorization', 'Bearer admin-token');
    expect(res.status).toBe(200);
  });

  it('blocks destructive routes without a token', async () => {
    expect((await request(app).delete('/api/history')).status).toBe(401);
    expect((await request(app).post('/api/post-now').send({ forceLive: true })).status).toBe(401);
  });

  it('keeps /api/health public', async () => {
    expect((await request(app).get('/api/health')).status).toBe(200);
  });
});

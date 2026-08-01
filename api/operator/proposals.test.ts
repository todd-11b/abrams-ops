import { beforeEach, describe, expect, it, vi } from 'vitest';
import handler from './proposals';
import { issueOperatorToken } from '../_lib/operator-auth';

describe('proposal token issuance', () => {
  beforeEach(() => {
    process.env.OPERATOR_SESSION_SECRET = 'test-secret-that-is-at-least-32-bytes-long'; process.env.GHL_LOCATION_ID = 'location-1';
    process.env.SUPABASE_URL = 'https://test.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'; vi.restoreAllMocks();
  });
  it('requires operator authorization and stores only a 64-character hash', async () => {
    expect((await handler(new Request('http://test/api/operator/proposals', { method: 'POST' }))).status).toBe(401);
    let stored = ''; vi.stubGlobal('fetch', vi.fn(async (_input, init) => { stored = String(init?.body); return new Response(JSON.stringify([{}]), { status: 201 }); }));
    const { token } = await issueOperatorToken('ty', 'pin');
    const response = await handler(new Request('http://test/api/operator/proposals', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ contact_id: 'c1', proposal_id: 'p1' }) }));
    const body = await response.json(); expect(response.status).toBe(201); expect(body.token).toMatch(/^[a-f0-9]{64}$/);
    expect(stored).not.toContain(body.token); expect(JSON.parse(stored).token_hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

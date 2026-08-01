import { beforeEach, describe, expect, it, vi } from 'vitest';
import ghlHandler from './ghl';
import dataHandler from './data';
import { issueOperatorToken } from '../_lib/operator-auth';

describe('operator endpoint authorization', () => {
  beforeEach(() => {
    process.env.OPERATOR_SESSION_SECRET = 'test-secret-that-is-at-least-32-bytes-long'; process.env.GHL_LOCATION_ID = 'location-1';
    process.env.GHL_API_KEY = 'ghl'; process.env.SUPABASE_URL = 'https://test.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
    vi.restoreAllMocks();
  });
  it('returns 401 without a session and 403 when field requests owner-only SMS', async () => {
    const unauthorized = await ghlHandler(new Request('http://test/api/operator/ghl', { method: 'POST', body: JSON.stringify({ action: 'sendSms' }) }));
    expect(unauthorized.status).toBe(401);
    const { token } = await issueOperatorToken('ty', 'pin');
    const forbidden = await ghlHandler(new Request('http://test/api/operator/ghl', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ action: 'sendSms', contactId: 'c1', body: 'test' }) }));
    expect(forbidden.status).toBe(403);
  });
  it('rejects an arbitrary select projection before calling the service role', async () => {
    const { token } = await issueOperatorToken('todd', 'pin'); const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const response = await dataHandler(new Request('http://test/api/operator/data', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ table: 'jobs', select: '*,secret_column' }) }));
    expect(response.status).toBe(400); expect(fetchMock).not.toHaveBeenCalled();
  });
});

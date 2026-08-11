import { beforeEach, describe, expect, it, vi } from 'vitest';
import handler from './sso';

const SECRET = 'shared-secret-value';
const LOCATION = '5W6GR1I8ongw4p16jiRf';
// Decrypts to userId MKQJ7wOVVmNOMvrnKKKK in location 5W6GR1I8ongw4p16jiRf.
const TY_PAYLOAD = 'U2FsdGVkX19xJGNnzis+rFMSSHOgW940CJLtvvh6RPmZEuVEAtcNmdoSM8uNUmQhzEfiUuoOw2OJ30UaNKkaNXZlmj/Qw1iS2zeZkdZ7uS4trWdsvGlbf8kNBhXCyoDkaKbKcPJ0mcYDEJNh0WWi/rj2gvCdyuVsIzzFUWNqUCXqjIjjE4/n0LWzKESMmBaDqfTVFtHvEgi+Gt54RHQjdlzoMGNHZCuusb9kuzvcmmkEEhiAZ2Dx6lSSG2PBnKeWcHuBEG8i7y7LpFD58/wM5A==';

function post(body: unknown, address = '203.0.113.4') {
  return new Request('http://test/api/operator/sso', {
    method: 'POST',
    headers: { 'x-vercel-forwarded-for': address },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  process.env.OPERATOR_SESSION_SECRET = 'test-secret-that-is-at-least-32-bytes-long';
  process.env.GHL_LOCATION_ID = LOCATION;
  process.env.GHL_APP_SHARED_SECRET = SECRET;
  process.env.GHL_SSO_TODD_USER_ID = 'toddUser';
  process.env.GHL_SSO_TY_USER_ID = 'MKQJ7wOVVmNOMvrnKKKK';
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  process.env.OPERATOR_RATE_LIMIT_PEPPER = 'test-rate-limit-pepper-at-least-32-bytes';
  vi.restoreAllMocks();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('true', { status: 200 })));
});

describe('operator HighLevel SSO endpoint', () => {
  it('signs in the mapped operator and marks the session as coming from HighLevel', async () => {
    const res = await handler(post({ encryptedData: TY_PAYLOAD }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ actor: 'ty', role: 'field', provider: 'ghl' });
  });

  it('rejects a payload encrypted with a different shared secret', async () => {
    process.env.GHL_APP_SHARED_SECRET = 'another-secret';
    const res = await handler(post({ encryptedData: TY_PAYLOAD }));
    expect(res.status).toBe(401);
    expect(await res.json()).not.toHaveProperty('token');
  });

  it('rejects a HighLevel user who is not mapped to an operator', async () => {
    process.env.GHL_SSO_TY_USER_ID = 'someoneElse';
    const res = await handler(post({ encryptedData: TY_PAYLOAD }));
    expect(res.status).toBe(401);
  });

  it('rejects a session whose active location is not the Abrams sub-account', async () => {
    process.env.GHL_LOCATION_ID = 'another-location';
    const res = await handler(post({ encryptedData: TY_PAYLOAD }));
    expect(res.status).toBe(401);
  });

  it('spends a login attempt so a stolen payload cannot be brute forced', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('false', { status: 200 })));
    const res = await handler(post({ encryptedData: TY_PAYLOAD }));
    expect(res.status).toBe(401);
    expect(res.headers.get('Retry-After')).toBe('900');
  });

  it('fails closed before decrypting when SSO is not configured', async () => {
    process.env.GHL_APP_SHARED_SECRET = '';
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await handler(post({ encryptedData: TY_PAYLOAD }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'HighLevel SSO is not configured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['GET', new Request('http://test/api/operator/sso')],
  ])('refuses %s', async (_method, request) => {
    expect((await handler(request)).status).toBe(405);
  });

  it('rejects a malformed body', async () => {
    const res = await handler(new Request('http://test/api/operator/sso', { method: 'POST', body: 'not json' }));
    expect(res.status).toBe(400);
  });
});

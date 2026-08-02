import { beforeEach, describe, expect, it, vi } from 'vitest';
import handler from './session';

beforeEach(() => {
  process.env.OPERATOR_SESSION_SECRET = 'test-secret-that-is-at-least-32-bytes-long';
  process.env.GHL_LOCATION_ID = 'location-1';
  process.env.OPERATOR_TODD_PIN = '1357'; process.env.OPERATOR_TY_PIN = '2468';
  process.env.SUPABASE_URL = 'https://test.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  process.env.OPERATOR_RATE_LIMIT_PEPPER = 'test-rate-limit-pepper-at-least-32-bytes';
  vi.restoreAllMocks();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('true', { status: 200 })));
});

describe('operator session endpoint', () => {
  it('rejects an invalid PIN and issues no token', async () => {
    const res = await handler(new Request('http://test/api/operator/session', { method: 'POST', headers: { 'x-vercel-forwarded-for': '203.0.113.4' }, body: JSON.stringify({ pin: '0000' }) }));
    expect(res.status).toBe(401); expect(await res.json()).not.toHaveProperty('token');
  });
  it('returns a provider-neutral operator identity for a valid server PIN', async () => {
    const res = await handler(new Request('http://test/api/operator/session', { method: 'POST', headers: { 'x-vercel-forwarded-for': '203.0.113.4' }, body: JSON.stringify({ pin: '2468' }) }));
    expect(res.status).toBe(200); expect(await res.json()).toMatchObject({ actor: 'ty', role: 'field', provider: 'pin' });
  });
  it('rejects direct API access without a bearer token', async () => {
    const res = await handler(new Request('http://test/api/operator/session'));
    expect(res.status).toBe(401);
  });
  it('fails closed with the same generic response when the durable limiter is locked or unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('false', { status: 200 })));
    const locked = await handler(new Request('http://test/api/operator/session', { method: 'POST', headers: { 'x-vercel-forwarded-for': '203.0.113.4' }, body: JSON.stringify({ pin: '2468' }) }));
    expect(locked.status).toBe(401);
    expect(await locked.json()).toEqual({ error: 'invalid credentials' });
    expect(locked.headers.get('Retry-After')).toBe('900');
  });
  it('rejects missing or ambiguous trusted address input and ignores spoofable forwarding headers', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const spoofed = await handler(new Request('http://test/api/operator/session', { method: 'POST', headers: { 'x-forwarded-for': '203.0.113.4' }, body: JSON.stringify({ pin: '2468' }) }));
    expect(spoofed.status).toBe(401); expect(fetchMock).not.toHaveBeenCalled();
    const ambiguous = await handler(new Request('http://test/api/operator/session', { method: 'POST', headers: { 'x-vercel-forwarded-for': '203.0.113.4, 198.51.100.2' }, body: JSON.stringify({ pin: '2468' }) }));
    expect(ambiguous.status).toBe(401); expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([
    ['', '2468'],
    ['1357', ''],
    ['13a7', '2468'],
    ['135', '2468'],
    ['13570', '2468'],
    ['1357', '1357'],
  ])('fails closed before identity resolution when PIN configuration is invalid', async (todd, ty) => {
    process.env.OPERATOR_TODD_PIN = todd; process.env.OPERATOR_TY_PIN = ty;
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const response = await handler(new Request('http://test/api/operator/session', { method: 'POST', headers: { 'x-vercel-forwarded-for': '203.0.113.4' }, body: JSON.stringify({ pin: '1357' }) }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'operator auth is not configured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

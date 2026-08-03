import { beforeEach, describe, expect, it, vi } from 'vitest';
import { consumeLoginAttempt } from './login-rate-limit';

function attempt(userAgent: string) {
  return new Request('http://test/api/operator/session', {
    method: 'POST',
    headers: { 'x-vercel-forwarded-for': '203.0.113.7', 'user-agent': userAgent },
  });
}

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  process.env.OPERATOR_RATE_LIMIT_PEPPER = 'pepper-that-is-at-least-32-bytes-long!';
  vi.restoreAllMocks();
});

describe('login rate limiting', () => {
  it('keys one attacker to one bucket regardless of the User-Agent they send', async () => {
    const keys: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      keys.push(JSON.parse(String(init?.body)).p_key_hash);
      return new Response('true', { status: 200 });
    }));

    await consumeLoginAttempt(attempt('Mozilla/5.0'), false);
    await consumeLoginAttempt(attempt('curl/8.0'), false);

    expect(keys[0]).toBe(keys[1]);
  });

  it('falls back to x-real-ip when the edge runtime omits x-vercel-forwarded-for', async () => {
    const keys: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      keys.push(JSON.parse(String(init?.body)).p_key_hash);
      return new Response('true', { status: 200 });
    }));
    const req = (headers: Record<string, string>) =>
      new Request('http://test/api/operator/session', { method: 'POST', headers });

    expect(await consumeLoginAttempt(req({ 'x-real-ip': '203.0.113.7' }), false)).toBe(true);
    expect(await consumeLoginAttempt(
      req({ 'x-vercel-forwarded-for': '203.0.113.7, 10.0.0.1', 'x-real-ip': '203.0.113.7' }),
      false,
    )).toBe(true);
    expect(await consumeLoginAttempt(req({ 'x-forwarded-for': '203.0.113.7' }), false)).toBe(false);
    expect(new Set(keys).size).toBe(1);
  });

  it('fails closed without a usable client address or pepper', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    expect(await consumeLoginAttempt(new Request('http://test/api/operator/session', { method: 'POST' }), false)).toBe(false);
    process.env.OPERATOR_RATE_LIMIT_PEPPER = 'short';
    expect(await consumeLoginAttempt(attempt('curl/8.0'), false)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import handler from './blocked-jobs';

const DAY = 86_400_000;

const blockedJob = (over: Record<string, unknown> = {}) => ({
  job_id: '11111111-1111-1111-1111-111111111111',
  job_number: 'AF-2026-0001',
  contact_id: 'abc123',
  blocked_reason: 'weather',
  blocked_at: new Date(Date.now() - 5 * DAY).toISOString(),
  last_blocked_notification_at: null,
  ...over,
});

function stubFetch(jobs: unknown[], smsOk = true) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes('/jobs?') && (!init?.method || init.method === 'GET')) {
      return new Response(JSON.stringify(jobs), { status: 200 });
    }
    if (url.includes('/contacts/')) return new Response(JSON.stringify({ contact: { firstName: 'Sophie', lastName: 'Reyes' } }), { status: 200 });
    if (url.includes('/conversations/messages')) return new Response('{}', { status: smsOk ? 201 : 500 });
    return new Response('[]', { status: 200 });
  }));
  return calls;
}

function run(auth = 'Bearer cron-secret') {
  return handler(new Request('http://test/api/cron/blocked-jobs', { headers: { Authorization: auth } }));
}

describe('blocked job sweep', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    process.env.CRON_SECRET = 'cron-secret';
    process.env.GHL_API_KEY = 'key';
    process.env.GHL_TODD_CONTACT_ID = 'owner1';
    process.env.SUPABASE_URL = 'https://db.test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
  });

  it('refuses a caller without the cron secret', async () => {
    const calls = stubFetch([blockedJob()]);
    expect((await run('Bearer wrong')).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('refuses when no cron secret is configured, rather than running open', async () => {
    delete process.env.CRON_SECRET;
    stubFetch([blockedJob()]);
    expect((await run('Bearer ')).status).toBe(401);
  });

  it('texts the owner about an overdue job and records that it did', async () => {
    const calls = stubFetch([blockedJob()]);
    const response = await run();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ blocked: 1, sent: 1, failed: 0 });
    expect(calls.some((call) => call.url.includes('/conversations/messages'))).toBe(true);
    const patch = calls.find((call) => call.init?.method === 'PATCH');
    expect(patch?.url).toContain('job_id=eq.11111111-1111-1111-1111-111111111111');
    expect(JSON.parse(String(patch?.init?.body)).last_blocked_notification_at).toBeTruthy();
  });

  // The reminder must not depend on anyone opening the page, but it must still
  // respect the delay and repeat interval it always had.
  it('stays quiet inside the initial delay and the repeat interval', async () => {
    const calls = stubFetch([
      blockedJob({ job_id: 'fresh', blocked_at: new Date(Date.now() - 2 * DAY).toISOString() }),
      blockedJob({ job_id: 'recent', last_blocked_notification_at: new Date(Date.now() - 3600_000).toISOString() }),
    ]);
    await expect((await run()).json()).resolves.toEqual({ blocked: 2, sent: 0, failed: 0 });
    expect(calls.some((call) => call.url.includes('/conversations/messages'))).toBe(false);
  });

  it('leaves the throttle untouched when the text fails, so the next sweep retries', async () => {
    const calls = stubFetch([blockedJob()], false);
    await expect((await run()).json()).resolves.toEqual({ blocked: 1, sent: 0, failed: 1 });
    expect(calls.some((call) => call.init?.method === 'PATCH')).toBe(false);
  });
});

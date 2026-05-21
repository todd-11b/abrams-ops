import { describe, it, expect, vi, beforeEach } from 'vitest';
import handler from './ghl-invoice-paid';

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  process.env.GHL_API_KEY = 'test-ghl-key';
  process.env.GHL_LOCATION_ID = 'test-loc';
  process.env.GHL_STAGE_JOB_CREATED = 'stage-jc';
  process.env.GHL_WEBHOOK_SECRET = 'top-secret-32-char-string-AAAAAAA';
  process.env.GHL_TODD_CONTACT_ID = 'TestContactId12345678';
  process.env.GHL_OUTBOUND_IP_PREFIXES = '';
  vi.restoreAllMocks();
});

function makeReq(opts: { body: unknown; secret?: string; ip?: string }): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.secret !== undefined) headers['X-Abrams-Webhook-Secret'] = opts.secret;
  if (opts.ip !== undefined) headers['X-Forwarded-For'] = opts.ip;
  return new Request('http://test/api/webhooks/ghl-invoice-paid', {
    method: 'POST',
    headers,
    body: JSON.stringify(opts.body),
  });
}

interface FetchCall { url: string; init: RequestInit }

// jobLookupRows: returned for GET /rest/v1/jobs?proposal_id=eq...
// patchUpdated: returned for PATCH /rest/v1/jobs?...&deposit_status=eq.pending_invoice
function mockSupabaseAndGhl(opts: { jobLookupRows: unknown[]; patchUpdated?: unknown[] }) {
  const calls: FetchCall[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init: init || {} });
    const method = init?.method || 'GET';
    if (url.includes('/rest/v1/jobs') && method === 'GET') {
      return new Response(JSON.stringify(opts.jobLookupRows), { status: 200 });
    }
    if (url.includes('/rest/v1/jobs') && method === 'PATCH') {
      const updated = opts.patchUpdated ?? [{ job_id: 'job-1', job_number: 'AF-2026-0010', deposit_status: 'paid' }];
      return new Response(JSON.stringify(updated), { status: 200 });
    }
    if (url.includes('/rest/v1/job_activity_log')) return new Response('[]', { status: 201 });
    return new Response('{}', { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, calls };
}

const VALID_SECRET = 'top-secret-32-char-string-AAAAAAA';

describe('ghl-invoice-paid webhook', () => {
  it('flips a pending_invoice job to paid, logs activity, moves GHL stage, posts note', async () => {
    const { calls } = mockSupabaseAndGhl({ jobLookupRows: [{
      job_id: 'job-1', job_number: 'AF-2026-0010', proposal_id: 'opp-1', deposit_status: 'pending_invoice',
    }] });

    const res = await handler(makeReq({
      secret: VALID_SECRET,
      body: { contactId: 'c1', opportunityId: 'opp-1', invoiceId: 'inv-1', amountPaid: 5000, paidAt: '2026-05-22T00:00:00Z' },
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe('paid');
    expect(body.job_number).toBe('AF-2026-0010');

    const update = calls.find(c => c.url.includes('/rest/v1/jobs') && c.init.method === 'PATCH');
    expect(update).toBeDefined();
    expect(update!.url).toContain('proposal_id=eq.opp-1');
    expect(update!.url).toContain('deposit_status=eq.pending_invoice');
    const updateBody = JSON.parse(update!.init.body as string);
    expect(updateBody.deposit_status).toBe('paid');
    expect(updateBody.deposit_paid_at).toBeTruthy();

    const activity = calls.find(c => c.url.includes('/rest/v1/job_activity_log'));
    expect(activity).toBeDefined();
    const activityBody = JSON.parse(activity!.init.body as string);
    expect(activityBody.type).toBe('deposit_paid_via_invoice');
    expect(activityBody.payload).toMatchObject({ invoice_id: 'inv-1', amount_paid: 5000 });

    const stageMove = calls.find(c =>
      c.url.includes('/opportunities/opp-1') && c.init.method === 'PUT'
    );
    expect(stageMove).toBeDefined();
    const stageBody = JSON.parse(stageMove!.init.body as string);
    expect(stageBody.pipelineStageId).toBe('stage-jc');

    const note = calls.find(c => c.url.includes('/contacts/c1/notes'));
    expect(note).toBeDefined();
    const noteBody = JSON.parse(note!.init.body as string);
    expect(noteBody.body).toContain('Deposit received');
    expect(noteBody.body).toContain('AF-2026-0010');
  });

  it('returns 401 + sends SMS on bad secret', async () => {
    const { calls } = mockSupabaseAndGhl({ jobLookupRows: [] });

    const res = await handler(makeReq({
      secret: 'wrong-secret',
      ip: '1.2.3.4',
      body: { contactId: 'c1', opportunityId: 'opp-1', invoiceId: 'inv-1', amountPaid: 5000 },
    }));
    expect(res.status).toBe(401);

    const sms = calls.find(c =>
      c.url.endsWith('/conversations/messages') && c.init.method === 'POST'
    );
    expect(sms).toBeDefined();
    const smsBody = JSON.parse(sms!.init.body as string);
    expect(smsBody.contactId).toBe('TestContactId12345678');
    expect(smsBody.message).toContain('Unauthorized');
    expect(smsBody.message).toContain('1.2.3.4');

    expect(calls.some(c => c.url.includes('/rest/v1/jobs'))).toBe(false);
    expect(calls.some(c => c.url.includes('/rest/v1/job_activity_log'))).toBe(false);
  });

  it('returns 401 + SMS when secret header is missing entirely', async () => {
    const { calls } = mockSupabaseAndGhl({ jobLookupRows: [] });
    const res = await handler(makeReq({
      body: { contactId: 'c1', opportunityId: 'opp-1', invoiceId: 'inv-1', amountPaid: 5000 },
    }));
    expect(res.status).toBe(401);
    const sms = calls.find(c => c.url.endsWith('/conversations/messages'));
    expect(sms).toBeDefined();
  });

  it('returns 422 + SMS when no matching job exists', async () => {
    const { calls } = mockSupabaseAndGhl({ jobLookupRows: [] });

    const res = await handler(makeReq({
      secret: VALID_SECRET,
      body: { contactId: 'c1', opportunityId: 'opp-nonexistent', invoiceId: 'inv-xyz', amountPaid: 5000 },
    }));
    expect(res.status).toBe(422);

    const sms = calls.find(c => c.url.endsWith('/conversations/messages'));
    expect(sms).toBeDefined();
    const smsBody = JSON.parse(sms!.init.body as string);
    expect(smsBody.message).toContain('no matching job');
    expect(smsBody.message).toContain('c1');
    expect(smsBody.message).toContain('inv-xyz');

    const update = calls.find(c => c.url.includes('/rest/v1/jobs') && c.init.method === 'PATCH');
    expect(update).toBeUndefined();
  });

  it('returns 200 with already_processed=true when job is already paid (idempotent)', async () => {
    const { calls } = mockSupabaseAndGhl({ jobLookupRows: [{
      job_id: 'job-1', job_number: 'AF-2026-0010', proposal_id: 'opp-1', deposit_status: 'paid',
    }] });

    const res = await handler(makeReq({
      secret: VALID_SECRET,
      body: { contactId: 'c1', opportunityId: 'opp-1', invoiceId: 'inv-1', amountPaid: 5000 },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.already_processed).toBe(true);
    expect(body.job_id).toBe('job-1');

    expect(calls.some(c => c.url.includes('/rest/v1/jobs') && c.init.method === 'PATCH')).toBe(false);
    expect(calls.some(c => c.url.includes('/rest/v1/job_activity_log'))).toBe(false);
    expect(calls.some(c => c.url.includes('/opportunities/opp-1') && c.init.method === 'PUT')).toBe(false);
    expect(calls.some(c => c.url.includes('/contacts/c1/notes'))).toBe(false);
    expect(calls.some(c => c.url.endsWith('/conversations/messages'))).toBe(false);
  });

  it('returns 400 when opportunityId is missing from payload', async () => {
    mockSupabaseAndGhl({ jobLookupRows: [] });
    const res = await handler(makeReq({
      secret: VALID_SECRET,
      body: { contactId: 'c1', invoiceId: 'inv-1', amountPaid: 5000 },
    }));
    expect(res.status).toBe(400);
  });

  it('processes successfully even with IP outside GHL range (soft check)', async () => {
    mockSupabaseAndGhl({ jobLookupRows: [{
      job_id: 'job-1', job_number: 'AF-2026-0010', proposal_id: 'opp-1', deposit_status: 'pending_invoice',
    }] });
    process.env.GHL_OUTBOUND_IP_PREFIXES = '44.234.';

    const res = await handler(makeReq({
      secret: VALID_SECRET,
      ip: '203.0.113.99',
      body: { contactId: 'c1', opportunityId: 'opp-1', invoiceId: 'inv-1', amountPaid: 5000 },
    }));
    expect(res.status).toBe(201);
  });

  it('rejects non-POST', async () => {
    const res = await handler(new Request('http://test/api/webhooks/ghl-invoice-paid', { method: 'GET' }));
    expect(res.status).toBe(405);
  });
});

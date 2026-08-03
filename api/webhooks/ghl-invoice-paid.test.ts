import { describe, it, expect, vi, beforeEach } from 'vitest';
// Version: 1.1 | Updated: 2026-08-01
// Changelog: cover pending final invoices, guarded-update races, duplicates, and GHL HTTP failures.
import handler from './ghl-invoice-paid';

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  process.env.GHL_API_KEY = 'test-ghl-key';
  process.env.GHL_LOCATION_ID = 'test-loc';
  process.env.GHL_STAGE_JOB_CREATED = 'stage-jc';
  process.env.GHL_STAGE_JOB_COMPLETE = 'stage-jc-complete';
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

function mockSupabaseAndGhl(opts: {
  jobLookupRows: unknown[];
  patchUpdated?: unknown[];
  raceLookupRows?: unknown[];
  ghlStageStatus?: number;
  ghlNoteStatus?: number;
}) {
  const calls: FetchCall[] = [];
  let jobLookupCount = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init: init || {} });
    const method = init?.method || 'GET';
    if (url.includes('/rest/v1/jobs') && method === 'GET') {
      const rows = jobLookupCount++ === 0 ? opts.jobLookupRows : (opts.raceLookupRows ?? opts.jobLookupRows);
      return new Response(JSON.stringify(rows), { status: 200 });
    }
    if (url.includes('/rest/v1/jobs') && method === 'PATCH') {
      const updated = opts.patchUpdated ?? [{ job_id: 'job-1', job_number: 'AF-2026-0010', deposit_status: 'paid', final_payment_status: 'paid' }];
      return new Response(JSON.stringify(updated), { status: 200 });
    }
    if (url.includes('/rest/v1/job_activity_log')) return new Response('[]', { status: 201 });
    if (url.includes('/opportunities/')) return new Response('stage response', { status: opts.ghlStageStatus ?? 200 });
    if (url.includes('/contacts/') && url.endsWith('/notes')) return new Response('note response', { status: opts.ghlNoteStatus ?? 200 });
    return new Response('{}', { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, calls };
}

const VALID_SECRET = 'top-secret-32-char-string-AAAAAAA';

describe('ghl-invoice-paid webhook', () => {
  it('flips a pending_invoice job to paid, logs activity, moves GHL stage, posts note', async () => {
    const { calls } = mockSupabaseAndGhl({ jobLookupRows: [{
      job_id: 'job-1', job_number: 'AF-2026-0010', proposal_id: 'opp-1', deposit_status: 'pending_invoice', final_payment_status: 'unpaid',
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
    expect(activityBody.source).toBe('workflow');
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
      job_id: 'job-1', job_number: 'AF-2026-0010', proposal_id: 'opp-1', deposit_status: 'paid', final_payment_status: 'unpaid',
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
      job_id: 'job-1', job_number: 'AF-2026-0010', proposal_id: 'opp-1', deposit_status: 'pending_invoice', final_payment_status: 'unpaid',
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

  it('paymentType=final_balance flips final_payment_status, logs activity, moves opp to Job Complete', async () => {
    const { calls } = mockSupabaseAndGhl({ jobLookupRows: [{
      job_id: 'job-1', job_number: 'AF-2026-0010', proposal_id: 'opp-1',
      deposit_status: 'paid', final_payment_status: 'unpaid',
    }] });

    const res = await handler(makeReq({
      secret: VALID_SECRET,
      body: {
        contactId: 'c1', opportunityId: 'opp-1', invoiceId: 'inv-final-1',
        amountPaid: 8000, paidAt: '2026-06-01T00:00:00Z',
        paymentType: 'final_balance',
      },
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe('final_paid');
    expect(body.job_number).toBe('AF-2026-0010');

    const update = calls.find(c => c.url.includes('/rest/v1/jobs') && c.init.method === 'PATCH');
    expect(update).toBeDefined();
    expect(update!.url).toContain('proposal_id=eq.opp-1');
    expect(update!.url).toContain('final_payment_status=in.(unpaid,pending_invoice)');
    const updateBody = JSON.parse(update!.init.body as string);
    expect(updateBody.final_payment_status).toBe('paid');
    expect(updateBody.final_payment_paid_at).toBeTruthy();
    // Must NOT touch deposit_status on final-balance path
    expect(updateBody.deposit_status).toBeUndefined();
    expect(updateBody.deposit_paid_at).toBeUndefined();

    const activity = calls.find(c => c.url.includes('/rest/v1/job_activity_log'));
    expect(activity).toBeDefined();
    const activityBody = JSON.parse(activity!.init.body as string);
    expect(activityBody.type).toBe('final_payment_via_invoice');
    expect(activityBody.source).toBe('workflow');

    const stageMove = calls.find(c =>
      c.url.includes('/opportunities/opp-1') && c.init.method === 'PUT'
    );
    expect(stageMove).toBeDefined();
    const stageBody = JSON.parse(stageMove!.init.body as string);
    expect(stageBody.pipelineStageId).toBe('stage-jc-complete');

    const note = calls.find(c => c.url.includes('/contacts/c1/notes'));
    expect(note).toBeDefined();
    const noteBody = JSON.parse(note!.init.body as string);
    expect(noteBody.body).toContain('Final payment received');
    expect(noteBody.body).toContain('AF-2026-0010');
    expect(noteBody.body).toContain('complete');
  });

  it('paymentType=final_balance is idempotent when final_payment_status already paid', async () => {
    const { calls } = mockSupabaseAndGhl({ jobLookupRows: [{
      job_id: 'job-1', job_number: 'AF-2026-0010', proposal_id: 'opp-1',
      deposit_status: 'paid', final_payment_status: 'paid',
    }] });

    const res = await handler(makeReq({
      secret: VALID_SECRET,
      body: { contactId: 'c1', opportunityId: 'opp-1', invoiceId: 'inv-final-1', amountPaid: 8000, paymentType: 'final_balance' },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.already_processed).toBe(true);

    expect(calls.some(c => c.url.includes('/rest/v1/jobs') && c.init.method === 'PATCH')).toBe(false);
    expect(calls.some(c => c.url.includes('/rest/v1/job_activity_log'))).toBe(false);
    expect(calls.some(c => c.url.includes('/opportunities/opp-1') && c.init.method === 'PUT')).toBe(false);
    expect(calls.some(c => c.url.includes('/contacts/c1/notes'))).toBe(false);
  });

  it('paymentType=final_balance processes pending_invoice instead of claiming already processed', async () => {
    const { calls } = mockSupabaseAndGhl({ jobLookupRows: [{
      job_id: 'job-1', job_number: 'AF-2026-0010', proposal_id: 'opp-1',
      deposit_status: 'paid', final_payment_status: 'pending_invoice',
    }] });

    const res = await handler(makeReq({
      secret: VALID_SECRET,
      body: { contactId: 'c1', opportunityId: 'opp-1', invoiceId: 'inv-final-2', amountPaid: 8000, paymentType: 'final_balance' },
    }));

    expect(res.status).toBe(201);
    const update = calls.find(c => c.url.includes('/rest/v1/jobs') && c.init.method === 'PATCH');
    expect(update?.url).toContain('final_payment_status=in.(unpaid,pending_invoice)');
    expect(calls.some(c => c.url.includes('/rest/v1/job_activity_log'))).toBe(true);
  });

  it('zero-row final PATCH returns already_processed only after re-read confirms paid', async () => {
    const { calls } = mockSupabaseAndGhl({
      jobLookupRows: [{
        job_id: 'job-1', job_number: 'AF-2026-0010', proposal_id: 'opp-1',
        deposit_status: 'paid', final_payment_status: 'unpaid',
      }],
      patchUpdated: [],
      raceLookupRows: [{
        job_id: 'job-1', job_number: 'AF-2026-0010', proposal_id: 'opp-1',
        deposit_status: 'paid', final_payment_status: 'paid',
      }],
    });

    const res = await handler(makeReq({
      secret: VALID_SECRET,
      body: { contactId: 'c1', opportunityId: 'opp-1', invoiceId: 'inv-race', amountPaid: 8000, paymentType: 'final_balance' },
    }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ already_processed: true, job_id: 'job-1' });
    expect(calls.filter(c => c.url.includes('/rest/v1/jobs') && (c.init.method || 'GET') === 'GET')).toHaveLength(2);
    expect(calls.some(c => c.url.includes('/rest/v1/job_activity_log'))).toBe(false);
  });

  it('zero-row final PATCH returns conflict when re-read is still not paid', async () => {
    const { calls } = mockSupabaseAndGhl({
      jobLookupRows: [{
        job_id: 'job-1', job_number: 'AF-2026-0010', proposal_id: 'opp-1',
        deposit_status: 'paid', final_payment_status: 'pending_invoice',
      }],
      patchUpdated: [],
      raceLookupRows: [{
        job_id: 'job-1', job_number: 'AF-2026-0010', proposal_id: 'opp-1',
        deposit_status: 'paid', final_payment_status: 'pending_invoice',
      }],
    });

    const res = await handler(makeReq({
      secret: VALID_SECRET,
      body: { contactId: 'c1', opportunityId: 'opp-1', invoiceId: 'inv-conflict', amountPaid: 8000, paymentType: 'final_balance' },
    }));

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'final payment state conflict' });
    expect(calls.some(c => c.url.includes('/rest/v1/job_activity_log'))).toBe(false);
  });

  it('logs GHL stage and note HTTP failures while preserving the fail-soft response', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockSupabaseAndGhl({
      jobLookupRows: [{
        job_id: 'job-1', job_number: 'AF-2026-0010', proposal_id: 'opp-1',
        deposit_status: 'paid', final_payment_status: 'unpaid',
      }],
      ghlStageStatus: 503,
      ghlNoteStatus: 429,
    });

    const res = await handler(makeReq({
      secret: VALID_SECRET,
      body: { contactId: 'c1', opportunityId: 'opp-1', invoiceId: 'inv-ghl-fail', amountPaid: 8000, paymentType: 'final_balance' },
    }));

    expect(res.status).toBe(201);
    expect(errorSpy).toHaveBeenCalledWith(
      '[ghl-invoice-paid] GHL Job Complete stage move returned 503',
      'stage response',
    );
    expect(errorSpy).toHaveBeenCalledWith(
      '[ghl-invoice-paid] final paid note returned 429',
      'note response',
    );
  });

  it('missing paymentType defaults to deposit behavior (backwards-compatible)', async () => {
    const { calls } = mockSupabaseAndGhl({ jobLookupRows: [{
      job_id: 'job-1', job_number: 'AF-2026-0010', proposal_id: 'opp-1',
      deposit_status: 'pending_invoice', final_payment_status: 'unpaid',
    }] });

    const res = await handler(makeReq({
      secret: VALID_SECRET,
      body: { contactId: 'c1', opportunityId: 'opp-1', invoiceId: 'inv-1', amountPaid: 5000 },
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe('paid'); // deposit-path status

    const update = calls.find(c => c.url.includes('/rest/v1/jobs') && c.init.method === 'PATCH');
    expect(update!.url).toContain('deposit_status=eq.pending_invoice');
    const updateBody = JSON.parse(update!.init.body as string);
    expect(updateBody.deposit_status).toBe('paid');
    expect(updateBody.final_payment_status).toBeUndefined();
  });

  it('returns 400 on unknown paymentType', async () => {
    mockSupabaseAndGhl({ jobLookupRows: [] });
    const res = await handler(makeReq({
      secret: VALID_SECRET,
      body: { contactId: 'c1', opportunityId: 'opp-1', invoiceId: 'inv-1', amountPaid: 5000, paymentType: 'tip' },
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/paymentType/i);
  });

  it('final_balance with no matching job → 422 + SMS (same as deposit path)', async () => {
    const { calls } = mockSupabaseAndGhl({ jobLookupRows: [] });

    const res = await handler(makeReq({
      secret: VALID_SECRET,
      body: { contactId: 'c1', opportunityId: 'opp-nonexistent', invoiceId: 'inv-x', amountPaid: 1, paymentType: 'final_balance' },
    }));
    expect(res.status).toBe(422);

    const sms = calls.find(c => c.url.endsWith('/conversations/messages'));
    expect(sms).toBeDefined();
    const smsBody = JSON.parse(sms!.init.body as string);
    expect(smsBody.message).toContain('no matching job');
  });

  it('creates the job from the deposit draft when nobody signed a proposal', async () => {
    const calls: FetchCall[] = [];
    let jobLookups = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      calls.push({ url, init: init || {} });
      const method = init?.method || 'GET';
      if (url.includes('/rest/v1/rpc/create_job_from_deposit_draft')) {
        return new Response(JSON.stringify([{ job_id: 'job-9', job_number: 'AF-2026-0099', created: true }]), { status: 200 });
      }
      if (url.includes('/rest/v1/jobs') && method === 'GET') {
        jobLookups++;
        return new Response('[]', { status: 200 });
      }
      if (url.includes('/rest/v1/jobs') && method === 'PATCH') {
        return new Response(JSON.stringify([{ job_id: 'job-9', job_number: 'AF-2026-0099', deposit_status: 'paid', final_payment_status: 'unpaid' }]), { status: 200 });
      }
      if (url.includes('/rest/v1/job_activity_log')) return new Response('[]', { status: 201 });
      return new Response('{}', { status: 200 });
    }));

    const res = await handler(makeReq({
      secret: VALID_SECRET,
      body: { contactId: 'c1', opportunityId: 'opp-unsigned', invoiceId: 'inv-1', amountPaid: 1950 },
    }));
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toMatchObject({ job_id: 'job-9', job_number: 'AF-2026-0099', status: 'paid' });
    expect(jobLookups).toBe(1);
    const rpc = calls.find(c => c.url.includes('create_job_from_deposit_draft'));
    expect(JSON.parse(rpc!.init.body as string)).toEqual({ p_proposal_id: 'opp-unsigned' });
    const patch = calls.find(c => c.url.includes('/rest/v1/jobs') && c.init.method === 'PATCH');
    expect(patch?.url).toContain('deposit_status=eq.pending_invoice');
  });

  it('still alerts when a payment arrives for an opportunity with no live draft', async () => {
    const calls: FetchCall[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      calls.push({ url, init: init || {} });
      if (url.includes('/rest/v1/rpc/create_job_from_deposit_draft')) {
        return new Response('{"message":"no_live_draft"}', { status: 400 });
      }
      if (url.includes('/rest/v1/jobs')) return new Response('[]', { status: 200 });
      return new Response('{}', { status: 200 });
    }));

    const res = await handler(makeReq({
      secret: VALID_SECRET,
      body: { contactId: 'c1', opportunityId: 'opp-unknown', invoiceId: 'inv-2', amountPaid: 1950 },
    }));
    expect(res.status).toBe(422);
    expect(calls.some(c => c.url.endsWith('/conversations/messages'))).toBe(true);
    expect(calls.some(c => c.url.includes('/rest/v1/jobs') && c.init.method === 'PATCH')).toBe(false);
  });

  it('does not invent a job from a draft on a final balance payment', async () => {
    const calls: FetchCall[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      calls.push({ url, init: init || {} });
      if (url.includes('/rest/v1/jobs')) return new Response('[]', { status: 200 });
      return new Response('{}', { status: 200 });
    }));

    const res = await handler(makeReq({
      secret: VALID_SECRET,
      body: { contactId: 'c1', opportunityId: 'opp-unsigned', invoiceId: 'inv-3', amountPaid: 1950, paymentType: 'final_balance' },
    }));
    expect(res.status).toBe(422);
    expect(calls.some(c => c.url.includes('create_job_from_deposit_draft'))).toBe(false);
  });
});

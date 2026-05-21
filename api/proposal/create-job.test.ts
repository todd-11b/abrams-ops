import { describe, it, expect, vi, beforeEach } from 'vitest';
import handler from './create-job';

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  process.env.GHL_API_KEY = 'test-ghl-key';
  process.env.GHL_LOCATION_ID = 'test-loc';
  vi.restoreAllMocks();
});

function makeReq(body: unknown): Request {
  return new Request('http://test/api/proposal/create-job', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('create-job (signature-time)', () => {
  it('inserts job with deposit_status=pending_invoice and signed_at set', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push({ url, init: init || {} });
      if (url.includes('/rest/v1/jobs') && (init?.method || 'GET') === 'POST') {
        return new Response(JSON.stringify([{ job_id: 'job-uuid', job_number: 'AF-2026-0002' }]), { status: 201 });
      }
      return new Response('[]', { status: 201 });
    }));

    const res = await handler(makeReq({
      contact_id: 'contact-1',
      proposal_opportunity_id: 'opp-1',
      fence_spec: { fence_lines: [], gates: [], addons: [], total_sections: 0, total_lf: 0, proposal_total: 1000 },
    }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.job_id).toBe('job-uuid');

    const jobInsert = calls.find(c => c.url.includes('/rest/v1/jobs') && (c.init.method || 'GET') === 'POST');
    expect(jobInsert).toBeDefined();
    const body = JSON.parse(jobInsert!.init.body as string);
    expect(body.deposit_status).toBe('pending_invoice');
    expect(body.signed_at).toBeTruthy();
    expect(body.deposit_paid_at).toBeUndefined();
    expect(body.stage).toBe('job_created');
  });

  it('inserts activity log with type=proposal_signed', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push({ url, init: init || {} });
      if (url.includes('/rest/v1/jobs') && (init?.method || 'GET') === 'POST') {
        return new Response(JSON.stringify([{ job_id: 'j1', job_number: 'AF-2026-0003' }]), { status: 201 });
      }
      return new Response('[]', { status: 201 });
    }));

    await handler(makeReq({ contact_id: 'c1', proposal_opportunity_id: 'opp-1' }));

    const activityInsert = calls.find(c => c.url.includes('/rest/v1/job_activity_log'));
    expect(activityInsert).toBeDefined();
    const body = JSON.parse(activityInsert!.init.body as string);
    expect(body.type).toBe('proposal_signed');
  });

  it('PUTs GHL opportunity status=won (no pipelineStageId)', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push({ url, init: init || {} });
      if (url.includes('/rest/v1/jobs') && (init?.method || 'GET') === 'POST') {
        return new Response(JSON.stringify([{ job_id: 'j1', job_number: 'AF-2026-0004' }]), { status: 201 });
      }
      return new Response('{}', { status: 200 });
    }));

    await handler(makeReq({ contact_id: 'c1', proposal_opportunity_id: 'opp-xyz' }));

    const wonPut = calls.find(c => c.url.includes('/opportunities/opp-xyz') && c.init.method === 'PUT');
    expect(wonPut).toBeDefined();
    const body = JSON.parse(wonPut!.init.body as string);
    expect(body.status).toBe('won');
    expect(body.pipelineStageId).toBeUndefined();
  });

  it('POSTs the signature note to the GHL contact with proposal display id', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push({ url, init: init || {} });
      if (url.includes('/rest/v1/jobs') && (init?.method || 'GET') === 'POST') {
        return new Response(JSON.stringify([{ job_id: 'j1', job_number: 'AF-2026-0005' }]), { status: 201 });
      }
      return new Response('{}', { status: 200 });
    }));

    await handler(makeReq({
      contact_id: 'contact-abc',
      proposal_opportunity_id: 'opp-1',
      proposal_display_id: 'P-1234',
      deposit_due: 5000,
    }));

    const note = calls.find(c => c.url.includes('/contacts/contact-abc/notes'));
    expect(note).toBeDefined();
    const body = JSON.parse(note!.init.body as string);
    expect(body.body).toContain('Proposal signed');
    expect(body.body).toContain('invoice pending');
    expect(body.body).toContain('P-1234');
  });

  it('does NOT move the GHL pipeline stage', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push({ url, init: init || {} });
      if (url.includes('/rest/v1/jobs') && (init?.method || 'GET') === 'POST') {
        return new Response(JSON.stringify([{ job_id: 'j1', job_number: 'AF-2026-0006' }]), { status: 201 });
      }
      return new Response('{}', { status: 200 });
    }));

    await handler(makeReq({ contact_id: 'c1', proposal_opportunity_id: 'opp-1' }));

    const stageMove = calls.find(c => {
      if (!c.url.includes('/opportunities/')) return false;
      if (c.init.method !== 'PUT') return false;
      const body = c.init.body ? JSON.parse(c.init.body as string) : {};
      return 'pipelineStageId' in body;
    });
    expect(stageMove).toBeUndefined();
  });

  it('returns 502 when the job insert fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/rest/v1/jobs') && (init?.method || 'GET') === 'POST') {
        return new Response('insert failed', { status: 500 });
      }
      return new Response('{}', { status: 200 });
    }));

    const res = await handler(makeReq({ contact_id: 'c1', proposal_opportunity_id: 'opp-1' }));
    expect(res.status).toBe(502);
  });

  it('rejects non-POST', async () => {
    const res = await handler(new Request('http://test/api/proposal/create-job', { method: 'GET' }));
    expect(res.status).toBe(405);
  });

  it('rejects missing contact_id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    const res = await handler(makeReq({ proposal_opportunity_id: 'opp-1' }));
    expect(res.status).toBe(400);
  });
});

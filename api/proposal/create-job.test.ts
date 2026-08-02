import { beforeEach, describe, expect, it, vi } from 'vitest';
import handler from './create-job';

const token = 'a'.repeat(64);
function request(body: unknown) { return new Request('http://test/api/proposal/create-job', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://test.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'; process.env.GHL_API_KEY = 'ghl';
  vi.restoreAllMocks();
});

describe('atomic proposal signing', () => {
  it('rejects non-POST with 405 and no database or GHL calls', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await handler(new Request('http://test/api/proposal/create-job', { method: 'GET' }));

    expect(res.status).toBe(405);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires an opaque proposal token', async () => { expect((await handler(request({}))).status).toBe(401); });

  it('returns the atomic RPC result and mirrors only a newly created job', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input); calls.push(url);
      if (url.includes('/rpc/create_job_from_proposal_token')) return new Response(JSON.stringify([{ job_id: 'j1', job_number: 'AF-1', created: true }]), { status: 200 });
      if (url.includes('proposal_access_tokens')) return new Response(JSON.stringify([{ contact_id: 'c1', proposal_id: 'o1', fence_spec: { proposal_total: 1000 } }]), { status: 200 });
      return new Response('{}', { status: 200 });
    }));
    const res = await handler(request({ token, proposal_display_id: 'P-1' }));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ job_id: 'j1', created: true, mirror_status: 'complete' });
    expect(calls.some((url) => url.includes('/opportunities/o1'))).toBe(true);
  });

  it('sends exact won-status and signature-note GHL requests without a signing-time stage move', async () => {
    const ghlCalls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/rpc/create_job_from_proposal_token')) {
        return new Response(JSON.stringify([{ job_id: 'j1', job_number: 'AF-1', created: true }]), { status: 200 });
      }
      if (url.includes('proposal_access_tokens')) {
        return new Response(JSON.stringify([{ contact_id: 'c1', proposal_id: 'o1', fence_spec: { proposal_total: 1000 } }]), { status: 200 });
      }
      ghlCalls.push({ url, init });
      return new Response('{}', { status: 200 });
    }));

    const res = await handler(request({ token, proposal_display_id: 'P-42' }));

    expect(res.status).toBe(201);
    expect(ghlCalls).toHaveLength(2);
    expect(ghlCalls[0]).toMatchObject({
      url: 'https://services.leadconnectorhq.com/opportunities/o1',
      init: { method: 'PUT' },
    });
    expect(JSON.parse(String(ghlCalls[0].init?.body))).toEqual({ status: 'won' });
    expect(JSON.parse(String(ghlCalls[0].init?.body))).not.toHaveProperty('pipelineStageId');
    expect(ghlCalls[1]).toMatchObject({
      url: 'https://services.leadconnectorhq.com/contacts/c1/notes',
      init: { method: 'POST' },
    });
    expect(JSON.parse(String(ghlCalls[1].init?.body))).toEqual({
      body: '[AUTO] Proposal signed — invoice pending\nProposal P-42\nDeposit due: $500',
    });
    expect(ghlCalls.some(({ url, init }) =>
      /pipeline|stage/i.test(url) || /pipelineStageId/.test(String(init?.body)),
    )).toBe(false);
  });

  it('returns the existing job for a duplicate without repeating GHL effects', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => { const url=String(input); calls.push(url); if (url.includes('/rpc/')) return new Response(JSON.stringify([{ job_id: 'j1', job_number: 'AF-1', created: false }]), { status: 200 }); return new Response(JSON.stringify([{ contact_id: 'c1', proposal_id: 'o1', fence_spec: { proposal_total: 1000 } }]), { status: 200 }); }));
    const res = await handler(request({ token }));
    expect(res.status).toBe(200); expect(calls.some((url) => url.includes('leadconnector'))).toBe(false);
  });

  it('mirrors exactly once when two distinct valid tokens resolve a proposal race', async () => {
    let rpcCalls = 0; let ghlCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/rpc/')) { rpcCalls += 1; return new Response(JSON.stringify([{ job_id: 'j1', job_number: 'AF-1', created: rpcCalls === 1 }]), { status: 200 }); }
      if (url.includes('proposal_access_tokens')) return new Response(JSON.stringify([{ contact_id: 'c1', proposal_id: 'o1', fence_spec: { proposal_total: 1000 } }]), { status: 200 });
      ghlCalls += 1; return new Response('{}', { status: 200 });
    }));
    const first = await handler(request({ token: 'a'.repeat(64) }));
    const second = await handler(request({ token: 'b'.repeat(64) }));
    expect(first.status).toBe(201); expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ job_id: 'j1', created: false });
    expect(ghlCalls).toBe(2);
  });

  it('reports CRM non-2xx as observable partial failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => { const url=String(input); if (url.includes('/rpc/')) return new Response(JSON.stringify([{ job_id:'j1',job_number:'AF-1',created:true }]),{status:200}); if(url.includes('proposal_access_tokens')) return new Response(JSON.stringify([{contact_id:'c1',proposal_id:'o1',fence_spec:{proposal_total:1000}}]),{status:200}); return new Response('{}',{status:500}); }));
    const res = await handler(request({ token })); expect(res.status).toBe(202); expect((await res.json()).mirror_status).toBe('partial_failure');
  });

  it('ignores browser-supplied pricing and takes the deposit from the token snapshot', async () => {
    const bodies: Array<{ url: string; body: string }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); bodies.push({ url, body: String(init?.body ?? '') });
      if (url.includes('/rpc/')) return new Response(JSON.stringify([{ job_id: 'j1', job_number: 'AF-1', created: true }]), { status: 200 });
      if (url.includes('proposal_access_tokens')) return new Response(JSON.stringify([{ contact_id: 'c1', proposal_id: 'o1', fence_spec: { proposal_total: 12000 } }]), { status: 200 });
      return new Response('{}', { status: 200 });
    }));

    const res = await handler(request({ token, proposal_display_id: 'P-9', deposit_due: 6, fence_spec: { proposal_total: 12 } }));

    expect(res.status).toBe(201);
    expect(JSON.parse(bodies[0].body)).toEqual({ p_token_hash: expect.any(String), p_fence_spec: null });
    const note = bodies.find((call) => call.url.includes('/notes'));
    expect(JSON.parse(String(note?.body)).body).toContain('Deposit due: $6,000');
  });

  it('only reports "skipped" for a duplicate signing, and names what stopped a real mirror', async () => {
    const respond = (created: boolean, tokenRow: unknown) => vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/rpc/')) return new Response(JSON.stringify([{ job_id: 'j1', job_number: 'AF-1', created }]), { status: 200 });
      if (String(input).includes('proposal_access_tokens')) return new Response(JSON.stringify(tokenRow), { status: 200 });
      return new Response('{}', { status: 200 });
    }));

    respond(false, []);
    expect((await (await handler(request({ token }))).json()).mirror_status).toBe('skipped');

    respond(true, []);
    expect(await (await handler(request({ token }))).json()).toMatchObject({ mirror_status: 'partial_failure', mirror_failures: ['token:lookup_failed'] });

    respond(true, [{ contact_id: 'c1', proposal_id: 'o1', fence_spec: null }]);
    expect(await (await handler(request({ token }))).json()).toMatchObject({ mirror_failures: ['fence_spec:missing'] });

    process.env.GHL_API_KEY = '';
    respond(true, [{ contact_id: 'c1', proposal_id: 'o1', fence_spec: { proposal_total: 1000 } }]);
    expect(await (await handler(request({ token }))).json()).toMatchObject({ mirror_failures: ['crm:not_configured'] });
  });

  it('does not report success when the transaction fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('database error', { status: 500 })));
    expect((await handler(request({ token }))).status).toBe(502);
  });
});

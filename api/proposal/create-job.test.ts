import { beforeEach, describe, expect, it, vi } from 'vitest';
import handler from './create-job';

const ensureProductionOpportunityMock = vi.hoisted(() => vi.fn());
vi.mock('../_lib/production-opportunity', () => ({
  ensureProductionOpportunity: ensureProductionOpportunityMock,
  ProductionOpportunityError: class ProductionOpportunityError extends Error { constructor(message: string, readonly status = 502) { super(message); } },
}));

const token = 'a'.repeat(64);
function request(body: unknown) { return new Request('http://test/api/proposal/create-job', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://test.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'; process.env.GHL_API_KEY = 'ghl';
  vi.restoreAllMocks();
  ensureProductionOpportunityMock.mockReset();
  ensureProductionOpportunityMock.mockResolvedValue('production-o1');
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
    expect(calls.some((url) => url.includes('/opportunities/o1'))).toBe(false);
    expect(ensureProductionOpportunityMock).toHaveBeenCalledWith(expect.objectContaining({ salesOpportunityId: undefined }));
  });

  it('binds a distinct Production ID while preserving the Sales opportunity provenance', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); calls.push({ url, init });
      if (url.includes('/rpc/create_job_from_proposal_token')) return new Response(JSON.stringify([{ job_id: 'j1', job_number: 'AF-1', created: true }]), { status: 200 });
      if (url.includes('proposal_access_tokens') && init?.method !== 'PATCH') return new Response(JSON.stringify([{
        contact_id: 'contact-1', proposal_id: 'sales-opp', sales_opportunity_id: 'sales-opp',
        production_opportunity_id: null, opportunity_contract: 'separate_pending_v1', fence_spec: { proposal_total: 1000 },
      }]), { status: 200 });
      if (url.includes('proposal_access_tokens') && init?.method === 'PATCH') return new Response('[{}]', { status: 200 });
      return new Response('{}', { status: 200 });
    }));
    ensureProductionOpportunityMock.mockResolvedValue('production-opp');

    const response = await handler(request({ token }));

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ production_opportunity_id: 'production-opp' });
    expect(ensureProductionOpportunityMock).toHaveBeenCalledWith({ contactId: 'contact-1', salesOpportunityId: 'sales-opp', monetaryValue: 1000 });
    const bind = calls.find((call) => call.url.includes('proposal_access_tokens') && call.init?.method === 'PATCH');
    expect(JSON.parse(String(bind?.init?.body))).toEqual({ production_opportunity_id: 'production-opp', opportunity_contract: 'separate_v1' });
    expect(calls.some((call) => call.url.includes('/opportunities/sales-opp'))).toBe(false);
  });

  it('leaves Sales unchanged and sends only the signature note after binding Production', async () => {
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
    // The pre-signing contact read is a GET; only the mirror mutates the CRM.
    const mutations = ghlCalls.filter(({ init }) => (init?.method ?? 'GET') !== 'GET');
    expect(mutations).toHaveLength(1);
    expect(mutations[0]).toMatchObject({
      url: 'https://services.leadconnectorhq.com/contacts/c1/notes',
      init: { method: 'POST' },
    });
    expect(JSON.parse(String(mutations[0].init?.body))).toEqual({
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
    expect(res.status).toBe(200); expect(calls.some((url) => url.includes('/opportunities/') || url.includes('/notes'))).toBe(false);
  });

  it('mirrors exactly once when two distinct valid tokens resolve a proposal race', async () => {
    let rpcCalls = 0; let ghlCalls = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/rpc/')) { rpcCalls += 1; return new Response(JSON.stringify([{ job_id: 'j1', job_number: 'AF-1', created: rpcCalls === 1 }]), { status: 200 }); }
      if (url.includes('proposal_access_tokens')) return new Response(JSON.stringify([{ contact_id: 'c1', proposal_id: 'o1', fence_spec: { proposal_total: 1000 } }]), { status: 200 });
      if (url.includes('/contacts/c1') && !url.includes('/notes')) return new Response('{}', { status: 200 });
      ghlCalls += 1; return new Response('{}', { status: 200 });
    }));
    const first = await handler(request({ token: 'a'.repeat(64) }));
    const second = await handler(request({ token: 'b'.repeat(64) }));
    expect(first.status).toBe(201); expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ job_id: 'j1', created: false });
    expect(ghlCalls).toBe(1);
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
    const rpcBody = bodies.find((call) => call.url.includes('/rpc/'));
    expect(JSON.parse(String(rpcBody?.body))).toEqual({ p_token_hash: expect.any(String), p_fence_spec: null });
    const note = bodies.find((call) => call.url.includes('/notes'));
    expect(JSON.parse(String(note?.body)).body).toContain('Deposit due: $6,000');
  });

  it('only reports "skipped" for a duplicate signing, and names what stopped a real mirror', async () => {
    const respond = (created: boolean, tokenRow: unknown) => vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/rpc/')) return new Response(JSON.stringify([{ job_id: 'j1', job_number: 'AF-1', created }]), { status: 200 });
      if (String(input).includes('proposal_access_tokens')) return new Response(JSON.stringify(tokenRow), { status: 200 });
      return new Response('{}', { status: 200 });
    }));

    respond(false, [{ contact_id: 'c1', proposal_id: 'o1', fence_spec: { proposal_total: 1000 } }]);
    expect((await (await handler(request({ token }))).json()).mirror_status).toBe('skipped');

    process.env.GHL_API_KEY = '';
    respond(true, [{ contact_id: 'c1', proposal_id: 'o1', fence_spec: { proposal_total: 1000 } }]);
    expect((await handler(request({ token }))).status).toBe(202);
  });

  it('refuses to sign a link whose price no longer matches the saved quote', async () => {
    const stored = {
      fenceLines: [{ id: 'l1', style: 'wood_pine_6', linearFeet: 100, pricePerSection: 300 }],
      gates: { walk: { qty: 0, price: 0 }, double: { qty: 0, price: 0 } },
      gateInstances: [],
      addOns: { demo: { enabled: false }, stain: { enabled: false }, poolLatch: { enabled: false } },
    };
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input); calls.push(url);
      if (url.includes('proposal_access_tokens')) return new Response(JSON.stringify([{ contact_id: 'c1', proposal_id: 'o1', fence_spec: { proposal_total: 1, total_lf: 1, total_sections: 1, fence_lines: [], gates: [], addons: [] } }]), { status: 200 });
      return new Response(JSON.stringify({ contact: { customFields: [{ id: 'v74WeVuNKTrjnYGM6ICN', value: JSON.stringify(stored) }] } }), { status: 200 });
    }));

    const res = await handler(request({ token }));

    expect(res.status).toBe(409);
    expect(calls.some((url) => url.includes('/rpc/'))).toBe(false);
  });

  it('asks for a new link when the transaction refuses an unpriced token', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/rpc/')) return new Response(JSON.stringify({ message: 'unpriced_token' }), { status: 400 });
      return new Response(JSON.stringify([{ contact_id: 'c1', proposal_id: 'o1', fence_spec: null }]), { status: 200 });
    }));

    const res = await handler(request({ token }));

    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain('out of date');
  });

  it('does not report success when the transaction fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('database error', { status: 500 })));
    expect((await handler(request({ token }))).status).toBe(502);
  });
});

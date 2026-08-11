import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureProductionOpportunity } from './production-opportunity';

const SALES = 'sales-pipeline';
const PRODUCTION = 'production-pipeline';
const PRODUCTION_STAGE = 'production-stage';

beforeEach(() => {
  vi.restoreAllMocks();
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  process.env.GHL_API_KEY = 'ghl';
  process.env.GHL_LOCATION_ID = 'sandbox-location';
  process.env.GHL_SALES_PIPELINE_ID = SALES;
  delete process.env.GHL_SALES_PIPELINE_STAGE_ID;
  delete process.env.GHL_SALES_STAGE_PROPOSAL_SENT;
  process.env.GHL_PRODUCTION_PIPELINE_ID = PRODUCTION;
  process.env.GHL_STAGE_JOB_CREATED = PRODUCTION_STAGE;
  process.env.GHL_STAGE_SCHEDULED = 'production-scheduled';
  process.env.GHL_STAGE_IN_INSTALL = 'production-install';
  process.env.GHL_STAGE_JOB_COMPLETE = 'production-complete';
  process.env.VITE_GHL_FENCE_PRODUCTION_PIPELINE_ID = PRODUCTION;
  process.env.VITE_GHL_STAGE_JOB_CREATED = PRODUCTION_STAGE;
  process.env.VITE_GHL_STAGE_SCHEDULED = 'production-scheduled';
  process.env.VITE_GHL_STAGE_IN_INSTALL = 'production-install';
  process.env.VITE_GHL_STAGE_JOB_COMPLETE = 'production-complete';
});

function pipelines() {
  return new Response(JSON.stringify({ pipelines: [
    { id: SALES, stages: [{ id: 'sales-first-stage' }] },
    { id: PRODUCTION, stages: [{ id: PRODUCTION_STAGE }, { id: 'production-scheduled' }, { id: 'production-install' }, { id: 'production-complete' }] },
  ] }), { status: 200 });
}

describe('Production opportunity boundary', () => {
  it('creates and finalizes exactly one distinct Production opportunity', async () => {
    expect(process.env.GHL_SALES_PIPELINE_STAGE_ID).toBeUndefined();
    expect(process.env.GHL_SALES_STAGE_PROPOSAL_SENT).toBeUndefined();
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); calls.push({ url, init });
      if (url.includes('/opportunities/pipelines')) return pipelines();
      if (url.includes('/rpc/claim_production_opportunity')) return new Response(JSON.stringify([{ claim_status: 'claimed', production_opportunity_id: null, create_attempted: false }]), { status: 200 });
      if (url.includes('/opportunities/search')) return new Response(JSON.stringify({ opportunities: [] }), { status: 200 });
      if (url.includes('/rpc/mark_production_opportunity_attempted')) return new Response('true', { status: 200 });
      if (url.endsWith('/opportunities/')) return new Response(JSON.stringify({ opportunity: { id: 'production-opp' } }), { status: 201 });
      if (url.includes('/rpc/finalize_production_opportunity')) return new Response(JSON.stringify('production-opp'), { status: 200 });
      throw new Error(`unexpected ${url}`);
    }));

    await expect(ensureProductionOpportunity({ contactId: 'contact-1', salesOpportunityId: 'sales-opp', monetaryValue: 1000 })).resolves.toBe('production-opp');
    const create = calls.find((call) => call.url.endsWith('/opportunities/'));
    expect(JSON.parse(String(create?.init?.body))).toMatchObject({
      contactId: 'contact-1', pipelineId: PRODUCTION, pipelineStageId: PRODUCTION_STAGE,
      name: '[ABRAMS-PRODUCTION:sales-opp]', monetaryValue: 1000,
    });
    expect(calls.filter((call) => call.url.endsWith('/opportunities/'))).toHaveLength(1);
  });

  it('reconciles a prior ambiguous create without creating another opportunity', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input); calls.push(url);
      if (url.includes('/opportunities/pipelines')) return pipelines();
      if (url.includes('/rpc/claim_production_opportunity')) return new Response(JSON.stringify([{ claim_status: 'reconcile', production_opportunity_id: null, create_attempted: true }]), { status: 200 });
      if (url.includes('/opportunities/search')) return new Response(JSON.stringify({ opportunities: [{ id: 'production-opp', contactId: 'contact-1', pipelineId: PRODUCTION, name: '[ABRAMS-PRODUCTION:sales-opp]' }] }), { status: 200 });
      if (url.includes('/rpc/finalize_production_opportunity')) return new Response(JSON.stringify('production-opp'), { status: 200 });
      throw new Error(`unexpected ${url}`);
    }));

    await expect(ensureProductionOpportunity({ contactId: 'contact-1', salesOpportunityId: 'sales-opp' })).resolves.toBe('production-opp');
    expect(calls.some((url) => url.endsWith('/opportunities/'))).toBe(false);
  });

  it('keeps an ambiguous attempt reconciliation-only when no exact record is visible', async () => {
    let claimCount = 0;
    let createCount = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/opportunities/pipelines')) return pipelines();
      if (url.includes('/rpc/claim_production_opportunity')) {
        claimCount += 1;
        return new Response(JSON.stringify([{ claim_status: claimCount === 1 ? 'claimed' : 'reconcile', production_opportunity_id: null, create_attempted: claimCount > 1 }]), { status: 200 });
      }
      if (url.includes('/opportunities/search')) return new Response(JSON.stringify({ opportunities: [] }), { status: 200 });
      if (url.includes('/rpc/mark_production_opportunity_attempted')) return new Response('true', { status: 200 });
      if (url.endsWith('/opportunities/')) { createCount += 1; throw new Error('timeout'); }
      throw new Error(`unexpected ${url}`);
    }));

    await expect(ensureProductionOpportunity({ contactId: 'contact-1', salesOpportunityId: 'sales-opp' })).rejects.toMatchObject({ status: 409 });
    await expect(ensureProductionOpportunity({ contactId: 'contact-1', salesOpportunityId: 'sales-opp' })).rejects.toMatchObject({ status: 409 });
    expect(createCount).toBe(1);
  });

  it('fails closed for equal pipelines or wrong stage parentage', async () => {
    delete process.env.GHL_SALES_PIPELINE_ID;
    const missingSalesFetch = vi.fn(); vi.stubGlobal('fetch', missingSalesFetch);
    await expect(ensureProductionOpportunity({ contactId: 'contact-1', salesOpportunityId: 'sales-opp' })).rejects.toThrow('GHL_SALES_PIPELINE_ID');
    expect(missingSalesFetch).not.toHaveBeenCalled();

    process.env.GHL_SALES_PIPELINE_ID = SALES;
    process.env.GHL_PRODUCTION_PIPELINE_ID = SALES;
    process.env.VITE_GHL_FENCE_PRODUCTION_PIPELINE_ID = SALES;
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    await expect(ensureProductionOpportunity({ contactId: 'contact-1', salesOpportunityId: 'sales-opp' })).rejects.toThrow('must be distinct');
    expect(fetchMock).not.toHaveBeenCalled();

    process.env.GHL_PRODUCTION_PIPELINE_ID = PRODUCTION;
    process.env.VITE_GHL_FENCE_PRODUCTION_PIPELINE_ID = PRODUCTION;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ pipelines: [
      { id: SALES, stages: [{ id: 'sales-first-stage' }] }, { id: PRODUCTION, stages: [{ id: 'wrong-stage' }] },
    ] }), { status: 200 })));
    await expect(ensureProductionOpportunity({ contactId: 'contact-1', salesOpportunityId: 'sales-opp' })).rejects.toThrow('not in the Production pipeline');
  });

  it('fails closed when the configured Sales pipeline does not exist', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ pipelines: [
      { id: PRODUCTION, stages: [{ id: PRODUCTION_STAGE }, { id: 'production-scheduled' }, { id: 'production-install' }, { id: 'production-complete' }] },
    ] }), { status: 200 })));

    await expect(ensureProductionOpportunity({ contactId: 'contact-1', salesOpportunityId: 'sales-opp' })).rejects.toThrow('Sales pipeline does not exist');
  });
});

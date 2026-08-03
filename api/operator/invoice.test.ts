import { beforeEach, describe, expect, it, vi } from 'vitest';
import handler from './invoice';
import { issueOperatorToken } from '../_lib/operator-auth';

const pricedProposal = {
  fenceLines: [{ id: 'l1', label: 'Main Run', style: 'wood_pine_6', linearFeet: 100, pricePerSection: 300 }],
  gates: { walk: { qty: 0, price: 0 }, double: { qty: 0, price: 0 } },
  gateInstances: [],
  addOns: { demo: { enabled: false }, stain: { enabled: false }, poolLatch: { enabled: false } },
};

function draft(token: string, body: Record<string, unknown> = { contact_id: 'c1', proposal_id: 'p1' }) {
  return handler(new Request('http://test/api/operator/invoice', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  }));
}

interface Routes {
  contact?: Response;
  existing?: unknown[];
  invoice?: Response;
}

function stubFetch(routes: Routes) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.includes('/contacts/c1')) {
      return routes.contact ?? new Response(JSON.stringify({ contact: { firstName: 'Sophie', lastName: 'Reyes', email: 's@example.com', customFields: [{ id: 'v74WeVuNKTrjnYGM6ICN', value: JSON.stringify(pricedProposal) }] } }), { status: 200 });
    }
    if (url.includes('deposit_invoice_drafts') && (!init?.method || init.method === 'GET')) {
      return new Response(JSON.stringify(routes.existing ?? []), { status: 200 });
    }
    if (url.includes('deposit_invoice_drafts')) return new Response(JSON.stringify([{}]), { status: 201 });
    if (url.endsWith('/invoices/')) return routes.invoice ?? new Response(JSON.stringify({ _id: 'inv_1' }), { status: 201 });
    return new Response(JSON.stringify({}), { status: 200 });
  }));
  return calls;
}

describe('deposit invoice drafting', () => {
  beforeEach(() => {
    process.env.OPERATOR_SESSION_SECRET = 'test-secret-that-is-at-least-32-bytes-long';
    process.env.GHL_LOCATION_ID = 'location-1';
    process.env.SUPABASE_URL = 'https://test.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
    process.env.GHL_API_KEY = 'ghl';
    delete process.env.GHL_TODD_CONTACT_ID;
    vi.restoreAllMocks();
  });

  it('is owner-only', async () => {
    expect((await handler(new Request('http://test/api/operator/invoice', { method: 'POST' }))).status).toBe(401);
    stubFetch({});
    const { token: field } = await issueOperatorToken('ty', 'pin');
    expect((await draft(field)).status).toBe(403);
  });

  it('drafts for the deposit derived from the saved proposal and never sends it', async () => {
    const calls = stubFetch({});
    const { token } = await issueOperatorToken('todd', 'pin');
    const response = await draft(token);
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ invoice_id: 'inv_1', deposit_amount: 1950, reused: false });

    const created = calls.find((call) => call.url.endsWith('/invoices/'));
    expect(JSON.parse(String(created?.init?.body)).items[0].amount).toBe(1950);
    expect(calls.some((call) => /invoices\/.+\/send/.test(call.url))).toBe(false);

    const stored = JSON.parse(String(calls.find((call) => call.url.includes('deposit_invoice_drafts') && call.init?.method === 'POST')?.init?.body));
    expect(stored).toMatchObject({ ghl_invoice_id: 'inv_1', deposit_amount: 1950, created_by: 'todd' });
    expect(stored.fence_spec).toMatchObject({ proposal_total: 3900 });
  });

  it('reuses the live draft when the quote has not changed', async () => {
    const calls = stubFetch({
      existing: [{ draft_id: 'd1', ghl_invoice_id: 'inv_old', deposit_amount: 1950, fence_spec: { fence_lines: pricedProposal.fenceLines, gates: [], addons: [], total_sections: 13, total_lf: 100, proposal_total: 3900 } }],
    });
    const { token } = await issueOperatorToken('todd', 'pin');
    const response = await draft(token);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ invoice_id: 'inv_old', reused: true });
    expect(calls.some((call) => call.url.endsWith('/invoices/'))).toBe(false);
  });

  it('supersedes the previous draft when the quote has been re-priced', async () => {
    const calls = stubFetch({
      existing: [{ draft_id: 'd1', ghl_invoice_id: 'inv_old', deposit_amount: 900, fence_spec: { fence_lines: [], gates: [], addons: [], total_sections: 4, total_lf: 30, proposal_total: 1800 } }],
    });
    const { token } = await issueOperatorToken('todd', 'pin');
    const response = await draft(token);
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ invoice_id: 'inv_1', superseded_invoice_id: 'inv_old' });
    const patch = calls.find((call) => call.init?.method === 'PATCH');
    expect(patch?.url).toContain('draft_id=eq.d1');
    expect(JSON.parse(String(patch?.init?.body)).superseded_at).toBeTruthy();
  });

  it('refuses a proposal it cannot price', async () => {
    stubFetch({ contact: new Response(JSON.stringify({ contact: { customFields: [] } }), { status: 200 }) });
    const { token } = await issueOperatorToken('todd', 'pin');
    expect((await draft(token)).status).toBe(409);
  });

  it('reports the drafted invoice when the record cannot be stored', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/contacts/c1')) return new Response(JSON.stringify({ contact: { customFields: [{ id: 'v74WeVuNKTrjnYGM6ICN', value: JSON.stringify(pricedProposal) }] } }), { status: 200 });
      if (url.includes('deposit_invoice_drafts') && (!init?.method || init.method === 'GET')) return new Response('[]', { status: 200 });
      if (url.includes('deposit_invoice_drafts')) return new Response('conflict', { status: 409 });
      return new Response(JSON.stringify({ _id: 'inv_1' }), { status: 201 });
    }));
    const { token } = await issueOperatorToken('todd', 'pin');
    const response = await draft(token);
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ invoice_id: 'inv_1' });
  });
});

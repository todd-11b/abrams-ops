import { beforeEach, describe, expect, it, vi } from 'vitest';
import handler from './proposals';
import { issueOperatorToken } from '../_lib/operator-auth';

const pricedProposal = {
  fenceLines: [{ id: 'l1', label: 'Main Run', style: 'wood_pine_6', linearFeet: 100, pricePerSection: 300 }],
  gates: { walk: { qty: 0, price: 0 }, double: { qty: 0, price: 0 } },
  gateInstances: [],
  addOns: { demo: { enabled: false }, stain: { enabled: false }, poolLatch: { enabled: false } },
};

function issue(token: string) {
  return handler(new Request('http://test/api/operator/proposals', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ contact_id: 'c1', proposal_id: 'p1' }) }));
}

describe('proposal token issuance', () => {
  beforeEach(() => {
    process.env.OPERATOR_SESSION_SECRET = 'test-secret-that-is-at-least-32-bytes-long'; process.env.GHL_LOCATION_ID = 'location-1';
    process.env.SUPABASE_URL = 'https://test.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'; process.env.GHL_API_KEY = 'ghl'; vi.restoreAllMocks();
  });
  it('requires operator authorization and stores only a 64-character hash', async () => {
    expect((await handler(new Request('http://test/api/operator/proposals', { method: 'POST' }))).status).toBe(401);
    let stored = '';
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/contacts/c1')) return new Response(JSON.stringify({ contact: { customFields: [{ id: 'v74WeVuNKTrjnYGM6ICN', value: JSON.stringify(pricedProposal) }] } }), { status: 200 });
      stored = String(init?.body); return new Response(JSON.stringify([{}]), { status: 201 });
    }));
    const { token } = await issueOperatorToken('ty', 'pin');
    const response = await handler(new Request('http://test/api/operator/proposals', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ contact_id: 'c1', proposal_id: 'p1' }) }));
    const body = await response.json(); expect(response.status).toBe(201); expect(body.token).toMatch(/^[a-f0-9]{64}$/);
    expect(stored).not.toContain(body.token); expect(JSON.parse(stored).token_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('snapshots the fence specification from the saved CRM proposal onto the token', async () => {
    let stored = '';
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/contacts/c1')) return new Response(JSON.stringify({ contact: { customFields: [{ id: 'v74WeVuNKTrjnYGM6ICN', value: JSON.stringify(pricedProposal) }] } }), { status: 200 });
      stored = String(init?.body);
      return new Response(JSON.stringify([{}]), { status: 201 });
    }));
    const { token } = await issueOperatorToken('ty', 'pin');
    expect((await issue(token)).status).toBe(201);
    expect(JSON.parse(stored).fence_spec).toMatchObject({ total_lf: 100, total_sections: 13, proposal_total: 3900 });
  });

  it('refuses to hand out a link it cannot price', async () => {
    const { token } = await issueOperatorToken('ty', 'pin');
    const issued: string[] = [];
    const respond = (contactResponse: Response) => vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/contacts/c1')) return contactResponse;
      issued.push(String(input));
      return new Response(JSON.stringify([{}]), { status: 201 });
    }));

    respond(new Response(JSON.stringify({ contact: { customFields: [] } }), { status: 200 }));
    expect((await issue(token)).status).toBe(409);

    respond(new Response(JSON.stringify({ contact: { customFields: [{ id: 'v74WeVuNKTrjnYGM6ICN', value: 'not json' }] } }), { status: 200 }));
    expect((await issue(token)).status).toBe(409);

    respond(new Response('upstream down', { status: 503 }));
    expect((await issue(token)).status).toBe(502);

    process.env.GHL_API_KEY = '';
    expect((await issue(token)).status).toBe(500);

    expect(issued).toEqual([]);
  });
});

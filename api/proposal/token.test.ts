import { beforeEach, describe, expect, it, vi } from 'vitest';
import proposalHandler from './[token]';
import { deriveFenceSpec } from '../_lib/proposal-source';
import type { ConsultFormData } from '../../src/components/consult/consultTypes';

const storedProposal = {
  proposalId: 'P-1',
  contactId: 'c1',
  fenceLines: [{ id: 'l1', style: 'wood_pine_6', linearFeet: 100, pricePerSection: 300 }],
  gates: { walk: { qty: 0, price: 0 }, double: { qty: 0, price: 0 } },
  gateInstances: [],
  addOns: { demo: { enabled: false }, stain: { enabled: false }, poolLatch: { enabled: false } },
} as unknown as ConsultFormData;
const frozenSpec = deriveFenceSpec(storedProposal);
const contactResponse = () => new Response(JSON.stringify({ contact: { firstName: 'Test', lastName: 'Customer', customFields: [{ id: 'v74WeVuNKTrjnYGM6ICN', value: JSON.stringify(storedProposal) }] } }), { status: 200 });

const token = 'a'.repeat(64);
const request = (value = token) => new Request(`http://test/api/proposal/${value}`);

describe('public proposal token boundary', () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://test.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'service'; process.env.GHL_API_KEY = 'ghl';
    vi.restoreAllMocks();
  });

  it('denies legacy contact IDs and malformed or tampered token shapes without data lookup', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    expect((await proposalHandler(request('contact-123'))).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('denies expired and wrong-purpose records with a non-disclosing response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })));
    const missing = await proposalHandler(request());
    expect(missing.status).toBe(404); expect(await missing.json()).toEqual({ error: 'proposal unavailable' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ contact_id: 'c1', proposal_id: 'p1', expires_at: '2000-01-01T00:00:00Z' }]), { status: 200 })));
    expect((await proposalHandler(request())).status).toBe(404);
  });

  it('returns a valid proposal without disclosing contact or token identifiers and remains viewable after signing', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('proposal_access_tokens')) return new Response(JSON.stringify([{ contact_id: 'c1', proposal_id: 'p1', expires_at: '2999-01-01T00:00:00Z', consumed_at: new Date().toISOString(), fence_spec: frozenSpec }]), { status: 200 });
      return contactResponse();
    }));
    const response = await proposalHandler(request()); const body = await response.json();
    expect(response.status).toBe(200); expect(body.form.contactId).toBeUndefined(); expect(JSON.stringify(body)).not.toContain(token);
  });

  it('refuses to render a link issued against a superseded price', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('proposal_access_tokens')) {
        return new Response(JSON.stringify([{ contact_id: 'c1', proposal_id: 'p1', expires_at: '2999-01-01T00:00:00Z', fence_spec: { ...frozenSpec, proposal_total: 1680, total_lf: 50 } }]), { status: 200 });
      }
      return contactResponse();
    }));
    const response = await proposalHandler(request());
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/out of date/);
  });
});

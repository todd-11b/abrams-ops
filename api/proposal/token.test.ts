import { beforeEach, describe, expect, it, vi } from 'vitest';
import proposalHandler from './[token]';

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
      if (String(input).includes('proposal_access_tokens')) return new Response(JSON.stringify([{ contact_id: 'c1', proposal_id: 'p1', expires_at: '2999-01-01T00:00:00Z', consumed_at: new Date().toISOString() }]), { status: 200 });
      return new Response(JSON.stringify({ contact: { firstName: 'Test', lastName: 'Customer', customFields: [{ id: 'v74WeVuNKTrjnYGM6ICN', value: JSON.stringify({ proposalId: 'P-1', contactId: 'c1' }) }] } }), { status: 200 });
    }));
    const response = await proposalHandler(request()); const body = await response.json();
    expect(response.status).toBe(200); expect(body.form.contactId).toBeUndefined(); expect(JSON.stringify(body)).not.toContain(token);
  });
});

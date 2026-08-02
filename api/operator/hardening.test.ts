import { beforeEach, describe, expect, it, vi } from 'vitest';
import alertsHandler from './alerts';
import dataHandler from './data';
import photosHandler from './photos';
import { canOperator, issueOperatorToken } from '../_lib/operator-auth';

const jobId = '11111111-2222-3333-4444-555555555555';
const issueId = '99999999-8888-7777-6666-555555555555';

function post(handler: (req: Request) => Promise<Response>, path: string, token: string, body: unknown) {
  return handler(new Request(`http://test${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
}

beforeEach(() => {
  process.env.OPERATOR_SESSION_SECRET = 'test-secret-that-is-at-least-32-bytes-long';
  process.env.GHL_LOCATION_ID = 'location-1';
  process.env.GHL_API_KEY = 'ghl';
  process.env.GHL_TODD_CONTACT_ID = 'owner-contact';
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service';
  process.env.OPERATOR_SESSION_VERSION = '1';
  vi.restoreAllMocks();
});

describe('operator data allowlists', () => {
  it('rejects inherited Object.prototype keys as table names', async () => {
    const { token } = await issueOperatorToken('todd', 'pin');
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    for (const table of ['constructor', 'toString', 'valueOf', '__proto__']) {
      expect((await post(dataHandler, '/api/operator/data', token, { table })).status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects malformed filters instead of throwing on them', async () => {
    const { token } = await issueOperatorToken('todd', 'pin');
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    for (const filters of [[null], ['job_id'], [{ column: 'job_id', type: 'in', value: 'not-an-array' }]]) {
      expect((await post(dataHandler, '/api/operator/data', token, { table: 'jobs', filters })).status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('signed photo paths', () => {
  it('refuses to sign a traversal path', async () => {
    const { token } = await issueOperatorToken('ty', 'pin');
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const response = await post(photosHandler, '/api/operator/photos', token, { paths: [`${jobId}/onsite/../../../other.jpg`] });
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('owner alerts', () => {
  it('is available to the field role and composes the message from stored job data', async () => {
    const field = (await issueOperatorToken('ty', 'pin')).claims;
    expect(canOperator(field, 'ghl:broad-read')).toBe(true);
    expect(canOperator(field, 'ghl:send-message')).toBe(false);

    const { token } = await issueOperatorToken('ty', 'pin');
    const sent: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/rest/v1/jobs')) return new Response(JSON.stringify([{ job_id: jobId, job_number: 'AF-1', contact_id: 'c1', status: 'blocked', blocked_reason: 'gate on backorder' }]), { status: 200 });
      if (url.includes('/contacts/c1')) return new Response(JSON.stringify({ contact: { firstName: 'Jane', lastName: 'Doe', address1: '1 Main St' } }), { status: 200 });
      sent.push({ url, body: JSON.parse(String(init?.body)) });
      return new Response('{}', { status: 200 });
    }));

    const response = await post(alertsHandler, '/api/operator/alerts', token, { kind: 'job_blocked', job_id: jobId });

    expect(response.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toContain('/conversations/messages');
    expect(sent[0].body).toMatchObject({ type: 'SMS', contactId: 'owner-contact' });
    expect(String((sent[0].body as { message: string }).message)).toContain('gate on backorder');
  });

  it('will not text the owner about a job that is not blocked or an issue that is not high severity', async () => {
    const { token } = await issueOperatorToken('ty', 'pin');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/rest/v1/jobs')) return new Response(JSON.stringify([{ job_id: jobId, job_number: 'AF-1', contact_id: 'c1', status: 'active', blocked_reason: null }]), { status: 200 });
      if (url.includes('/rest/v1/job_issues')) return new Response(JSON.stringify([{ job_id: jobId, type: 'gate_issue', severity: 'low' }]), { status: 200 });
      return new Response('{}', { status: 200 });
    }));

    expect((await post(alertsHandler, '/api/operator/alerts', token, { kind: 'job_blocked', job_id: jobId })).status).toBe(409);
    expect((await post(alertsHandler, '/api/operator/alerts', token, { kind: 'issue_high', job_id: jobId, issue_id: issueId })).status).toBe(409);
  });

  it('rejects unauthenticated callers and malformed requests', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    const anonymous = await alertsHandler(new Request('http://test/api/operator/alerts', { method: 'POST', body: JSON.stringify({ kind: 'job_blocked', job_id: jobId }) }));
    expect(anonymous.status).toBe(401);
    const { token } = await issueOperatorToken('ty', 'pin');
    expect((await post(alertsHandler, '/api/operator/alerts', token, { kind: 'anything', job_id: jobId })).status).toBe(400);
    expect((await post(alertsHandler, '/api/operator/alerts', token, { kind: 'job_blocked', job_id: 'jobs?select=*' })).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

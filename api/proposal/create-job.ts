import { secureJson } from '../_lib/operator-auth';
import { serverEnv, sha256 } from '../_lib/server-data';

export const config = { runtime: 'edge' };
const GHL_BASE = 'https://services.leadconnectorhq.com';

interface RequestBody {
  token?: string;
  proposal_display_id?: string;
  deposit_due?: number;
  fence_spec?: Record<string, unknown>;
}

async function ghl(path: string, apiKey: string, init: RequestInit) {
  try {
    const response = await fetch(`${GHL_BASE}${path}`, { ...init, headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Version: '2021-07-28' } });
    return response.ok ? null : `HTTP ${response.status}`;
  } catch { return 'network_error'; }
}

export default async function handler(req: Request) {
  if (req.method !== 'POST') return secureJson({ error: 'method not allowed' }, { status: 405 });
  let body: RequestBody;
  try { body = await req.json(); } catch { return secureJson({ error: 'invalid JSON' }, { status: 400 }); }
  if (!body.token || !/^[a-f0-9]{64}$/.test(body.token)) return secureJson({ error: 'valid proposal token required' }, { status: 401 });
  let env: ReturnType<typeof serverEnv>;
  try { env = serverEnv(); } catch { return secureJson({ error: 'server misconfigured' }, { status: 500 }); }
  const rpc = await fetch(`${env.url}/rest/v1/rpc/create_job_from_proposal_token`, {
    method: 'POST',
    headers: { apikey: env.key, Authorization: `Bearer ${env.key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_token_hash: await sha256(body.token), p_fence_spec: body.fence_spec ?? null }),
  });
  if (!rpc.ok) {
    const detail = await rpc.text().catch(() => '');
    const invalid = detail.includes('invalid_or_expired_token');
    return secureJson({ error: invalid ? 'proposal token invalid or expired' : 'job transaction failed' }, { status: invalid ? 401 : 502 });
  }
  const [job] = await rpc.json() as Array<{ job_id: string; job_number: string; created: boolean }>;
  if (!job) return secureJson({ error: 'job transaction returned no result' }, { status: 502 });

  const lookup = await fetch(`${env.url}/rest/v1/proposal_access_tokens?token_hash=eq.${await sha256(body.token)}&select=contact_id,proposal_id`, { headers: { apikey: env.key, Authorization: `Bearer ${env.key}` } });
  const [proposal] = lookup.ok ? await lookup.json() as Array<{ contact_id: string; proposal_id: string }> : [];
  const failures: string[] = [];
  const apiKey = process.env.GHL_API_KEY ?? '';
  if (job.created && proposal && apiKey) {
    const statusFailure = await ghl(`/opportunities/${encodeURIComponent(proposal.proposal_id)}`, apiKey, { method: 'PUT', body: JSON.stringify({ status: 'won' }) });
    if (statusFailure) failures.push(`opportunity:${statusFailure}`);
    const note = ['[AUTO] Proposal signed — invoice pending', body.proposal_display_id ? `Proposal ${body.proposal_display_id}` : null, typeof body.deposit_due === 'number' ? `Deposit due: $${body.deposit_due.toLocaleString('en-US')}` : null].filter(Boolean).join('\n');
    const noteFailure = await ghl(`/contacts/${encodeURIComponent(proposal.contact_id)}/notes`, apiKey, { method: 'POST', body: JSON.stringify({ body: note }) });
    if (noteFailure) failures.push(`note:${noteFailure}`);
  }
  return secureJson({ ...job, mirror_status: failures.length ? 'partial_failure' : 'complete', mirror_failures: failures }, { status: failures.length ? 202 : (job.created ? 201 : 200) });
}

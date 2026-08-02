import { canOperator, requireOperator, secureJson } from '../_lib/operator-auth';
import { deriveFenceSpec, fetchGhlContact, readStoredProposal } from '../_lib/proposal-source';
import { sha256, supabaseRequest } from '../_lib/server-data';

export const config = { runtime: 'edge' };

export default async function handler(req: Request) {
  const operator = await requireOperator(req);
  if (!operator) return secureJson({ error: 'unauthorized' }, { status: 401 });
  if (!canOperator(operator, 'operator:proposals')) return secureJson({ error: 'forbidden' }, { status: 403 });
  if (req.method !== 'POST') return secureJson({ error: 'method not allowed' }, { status: 405 });
  let body: { contact_id?: string; proposal_id?: string; ttl_hours?: number };
  try { body = await req.json(); } catch { return secureJson({ error: 'invalid JSON' }, { status: 400 }); }
  if (!body.contact_id || !body.proposal_id) return secureJson({ error: 'contact_id and proposal_id required' }, { status: 400 });
  const ttl = Math.min(Math.max(body.ttl_hours ?? 168, 1), 720);
  const raw = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
  const apiKey = process.env.GHL_API_KEY ?? '';
  const { contact } = apiKey ? await fetchGhlContact(body.contact_id, apiKey) : { contact: null };
  const fenceSpec = deriveFenceSpec(readStoredProposal(contact));
  const db = await supabaseRequest('proposal_access_tokens', {
    method: 'POST',
    body: JSON.stringify({ token_hash: await sha256(raw), contact_id: body.contact_id, proposal_id: body.proposal_id, purpose: 'proposal_view_sign', fence_spec: fenceSpec, expires_at: new Date(Date.now() + ttl * 3600000).toISOString(), created_by: operator.sub }),
  });
  if (!db.ok) return secureJson({ error: 'proposal token issuance failed' }, { status: 502 });
  return secureJson({ token: raw, expires_at: new Date(Date.now() + ttl * 3600000).toISOString() }, { status: 201 });
}

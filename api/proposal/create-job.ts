import { secureJson } from '../_lib/operator-auth';
import { ensureProductionOpportunity, ProductionOpportunityError } from '../_lib/production-opportunity';
import { deriveFenceSpec, fetchGhlContact, readStoredProposal, specMatches, type FenceSpec } from '../_lib/proposal-source';
import { serverEnv, sha256, supabaseRequest } from '../_lib/server-data';

export const config = { runtime: 'edge' };
const GHL_BASE = 'https://services.leadconnectorhq.com';

interface RequestBody {
  token?: string;
  proposal_display_id?: string;
}

const DISPLAY_ID = /^[A-Za-z0-9_-]{1,40}$/;

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
  const tokenHash = await sha256(body.token);
  const apiKey = process.env.GHL_API_KEY ?? '';
  const lookup = await fetch(`${env.url}/rest/v1/proposal_access_tokens?token_hash=eq.${tokenHash}&select=contact_id,proposal_id,sales_opportunity_id,production_opportunity_id,opportunity_contract,fence_spec`, { headers: { apikey: env.key, Authorization: `Bearer ${env.key}` } });
  if (!lookup.ok) return secureJson({ error: 'proposal token lookup failed' }, { status: 502 });
  const [proposal] = lookup.ok ? await lookup.json() as Array<{
    contact_id: string;
    proposal_id: string;
    sales_opportunity_id: string;
    production_opportunity_id: string | null;
    opportunity_contract: 'legacy_single_v1' | 'separate_pending_v1' | 'separate_v1';
    fence_spec: FenceSpec | null;
  }> : [];
  // The job records the token's frozen price. If the operator has re-priced
  // the quote since, this link is superseded and must not be signed.
  if (proposal && apiKey) {
    const { contact } = await fetchGhlContact(proposal.contact_id, apiKey);
    if (contact && !specMatches(deriveFenceSpec(readStoredProposal(contact)), proposal.fence_spec)) {
      return secureJson({ error: 'this proposal link is out of date — ask for a new one' }, { status: 409 });
    }
  }
  if (!proposal) return secureJson({ error: 'proposal token invalid or expired' }, { status: 401 });
  if (proposal.opportunity_contract === 'legacy_single_v1') {
    return secureJson({ error: 'this legacy proposal link cannot create a separated Production job — ask for a new link' }, { status: 409 });
  }
  let productionOpportunityId: string;
  try {
    productionOpportunityId = proposal.production_opportunity_id ?? await ensureProductionOpportunity({
      contactId: proposal.contact_id,
      salesOpportunityId: proposal.sales_opportunity_id,
      monetaryValue: proposal.fence_spec?.proposal_total,
    });
  } catch (error) {
    const status = error instanceof ProductionOpportunityError ? error.status : 502;
    return secureJson({ error: error instanceof Error ? error.message : 'Production opportunity creation failed' }, { status });
  }
  const bind = await supabaseRequest(`proposal_access_tokens?token_hash=eq.${tokenHash}&opportunity_contract=in.(separate_pending_v1,separate_v1)`, {
    method: 'PATCH',
    body: JSON.stringify({ production_opportunity_id: productionOpportunityId, opportunity_contract: 'separate_v1' }),
  });
  if (!bind.ok) return secureJson({ error: 'could not persist the Production opportunity boundary' }, { status: 502 });
  const rpc = await fetch(`${env.url}/rest/v1/rpc/create_job_from_proposal_token`, {
    method: 'POST',
    headers: { apikey: env.key, Authorization: `Bearer ${env.key}`, 'Content-Type': 'application/json' },
    // The fence specification and customer total come from the token's
    // server-derived snapshot; this request body cannot influence either.
    body: JSON.stringify({ p_token_hash: tokenHash, p_fence_spec: null }),
  });
  if (!rpc.ok) {
    const detail = await rpc.text().catch(() => '');
    if (detail.includes('invalid_or_expired_token')) return secureJson({ error: 'proposal token invalid or expired' }, { status: 401 });
    if (detail.includes('unpriced_token')) return secureJson({ error: 'this proposal link is out of date — ask for a new one' }, { status: 409 });
    return secureJson({ error: 'job transaction failed' }, { status: 502 });
  }
  const [job] = await rpc.json() as Array<{ job_id: string; job_number: string; created: boolean }>;
  if (!job) return secureJson({ error: 'job transaction returned no result' }, { status: 502 });

  const failures: string[] = [];
  // Only a duplicate signing has nothing to mirror; anything else that stops
  // the mirror on a genuinely new job is an observable failure, not a skip.
  if (job.created && !apiKey) failures.push('crm:not_configured');
  if (job.created && proposal && apiKey) {
    // The Sales opportunity is immutable here. The newly bound Production
    // opportunity already opens at Job Created; signing never moves Sales.
    // Deposit comes from the token's stored total, never from the signing request.
    const total = proposal.fence_spec?.proposal_total;
    const deposit = typeof total === 'number' && Number.isFinite(total) ? Math.round(total * 0.5) : null;
    const displayId = typeof body.proposal_display_id === 'string' && DISPLAY_ID.test(body.proposal_display_id) ? body.proposal_display_id : null;
    const note = ['[AUTO] Proposal signed — invoice pending', displayId ? `Proposal ${displayId}` : null, deposit === null ? null : `Deposit due: $${deposit.toLocaleString('en-US')}`].filter(Boolean).join('\n');
    const noteFailure = await ghl(`/contacts/${encodeURIComponent(proposal.contact_id)}/notes`, apiKey, { method: 'POST', body: JSON.stringify({ body: note }) });
    if (noteFailure) failures.push(`note:${noteFailure}`);
  }
  const mirrorStatus = !job.created ? 'skipped' : failures.length ? 'partial_failure' : 'complete';
  return secureJson({ ...job, production_opportunity_id: productionOpportunityId, mirror_status: mirrorStatus, mirror_failures: failures }, { status: failures.length ? 202 : (job.created ? 201 : 200) });
}

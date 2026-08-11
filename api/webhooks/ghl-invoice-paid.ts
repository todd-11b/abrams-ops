// api/webhooks/ghl-invoice-paid.ts
// Version: 1.1 | Updated: 2026-08-01
// Changelog: accept pending final invoices, verify zero-row races, and log GHL non-2xx responses.
// Vercel edge function — receives GHL invoice.paid events and routes them
// to one of two job-payment columns based on the body's paymentType field.
//
//   paymentType missing or 'deposit'  → flips deposit_status to 'paid',
//                                       moves opp to Job Created stage.
//   paymentType 'final_balance'       → flips final_payment_status to 'paid',
//                                       moves opp to Job Complete stage.
//
// Job lookup keys off the GHL opportunityId in the payload, matched against
// jobs.proposal_id. Idempotent on the relevant *_status='paid' state.
//
// Auth: required X-Abrams-Webhook-Secret header, constant-time compared
// against GHL_WEBHOOK_SECRET. Mismatch -> 401 + SMS to Todd, no DB writes.

import { ensureProductionOpportunity, productionStageRouting, ProductionOpportunityError } from '../_lib/production-opportunity';

export const config = { runtime: 'edge' };

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(init.headers || {}) },
  });
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function ipMatchesAnyPrefix(ip: string, prefixes: string[]): boolean {
  if (!prefixes.length) return true;
  return prefixes.some(p => ip.startsWith(p));
}

interface SbCtx { url: string; key: string }
async function sb(ctx: SbCtx, path: string, init: RequestInit = {}) {
  return fetch(`${ctx.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: ctx.key,
      Authorization: `Bearer ${ctx.key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(init.headers || {}),
    },
  });
}

function ghlHeaders(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Version: GHL_VERSION,
  };
}

async function logGhlNonOk(label: string, response: Response): Promise<void> {
  if (response.ok) return;
  const detail = await response.text().catch(() => '');
  console.error(`[ghl-invoice-paid] ${label} returned ${response.status}`, detail);
}

async function sendToddSms(ghlApiKey: string, toddContactId: string, message: string): Promise<void> {
  if (!ghlApiKey || !toddContactId) {
    console.error('[ghl-invoice-paid] SMS env not configured; would have sent:', message);
    return;
  }
  try {
    await fetch(`${GHL_BASE}/conversations/messages`, {
      method: 'POST',
      headers: ghlHeaders(ghlApiKey),
      body: JSON.stringify({ type: 'SMS', contactId: toddContactId, message }),
    });
  } catch (err) {
    console.error('[ghl-invoice-paid] Todd SMS send failed:', err);
  }
}

type PaymentType = 'deposit' | 'final_balance';

interface InvoicePaidPayload {
  contactId?: string;
  opportunityId?: string;
  invoiceId?: string;
  amountPaid?: number;
  paidAt?: string;
  paymentType?: string;
}

interface JobRow {
  job_id: string;
  job_number: string;
  proposal_id: string | null;
  sales_opportunity_id: string | null;
  production_opportunity_id: string | null;
  opportunity_contract: 'legacy_single_v1' | 'separate_v1';
  deposit_status: string;
  final_payment_status: string;
}

/**
 * Creates the job an unsigned deposit payment implies. Returns null when the
 * opportunity has no live draft, which leaves the existing "no matching job"
 * alert to fire rather than inventing a job with no priced snapshot.
 */
async function createJobFromDepositDraft(ctx: SbCtx, opportunityId: string): Promise<JobRow | null> {
  const lookup = await sb(ctx,
    `deposit_invoice_drafts?sales_opportunity_id=eq.${encodeURIComponent(opportunityId)}&superseded_at=is.null&select=draft_id,contact_id,proposal_id,sales_opportunity_id,production_opportunity_id,opportunity_contract,fence_spec`,
    { method: 'GET' });
  if (!lookup.ok) return null;
  const draftPayload = await lookup.json().catch(() => []) as unknown;
  const [draft] = (Array.isArray(draftPayload) ? draftPayload : []) as Array<{
    draft_id: string;
    contact_id: string;
    proposal_id: string;
    sales_opportunity_id: string;
    production_opportunity_id: string | null;
    opportunity_contract: 'legacy_single_v1' | 'separate_pending_v1' | 'separate_v1';
    fence_spec: { proposal_total?: number } | null;
  }>;
  if (!draft || draft.opportunity_contract === 'legacy_single_v1') return null;
  let productionOpportunityId: string;
  try {
    productionOpportunityId = draft.production_opportunity_id ?? await ensureProductionOpportunity({
      contactId: draft.contact_id,
      salesOpportunityId: draft.sales_opportunity_id,
      monetaryValue: draft.fence_spec?.proposal_total,
    });
  } catch (error) {
    const reason = error instanceof ProductionOpportunityError ? error.message : 'unknown error';
    console.error('[ghl-invoice-paid] Production opportunity boundary failed', reason);
    return null;
  }
  const bound = await sb(ctx, `deposit_invoice_drafts?draft_id=eq.${encodeURIComponent(draft.draft_id)}&opportunity_contract=in.(separate_pending_v1,separate_v1)`, {
    method: 'PATCH',
    body: JSON.stringify({ production_opportunity_id: productionOpportunityId, opportunity_contract: 'separate_v1' }),
  });
  if (!bound.ok) return null;
  let response: Response;
  try {
    response = await sb(ctx, 'rpc/create_job_from_deposit_draft', {
      method: 'POST',
      body: JSON.stringify({ p_proposal_id: opportunityId }),
    });
  } catch (err) {
    console.error('[ghl-invoice-paid] deposit draft job creation failed', err);
    return null;
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    if (!detail.includes('no_live_draft')) console.error('[ghl-invoice-paid] deposit draft job creation failed', detail);
    return null;
  }
  const payload = await response.json().catch(() => null) as Array<{ job_id?: string; job_number?: string }> | null;
  const created = Array.isArray(payload) ? payload[0] : null;
  if (!created?.job_id || !created.job_number) return null;
  return {
    job_id: created.job_id,
    job_number: created.job_number,
    proposal_id: draft.proposal_id,
    sales_opportunity_id: draft.sales_opportunity_id,
    production_opportunity_id: productionOpportunityId,
    opportunity_contract: 'separate_v1',
    deposit_status: 'pending_invoice',
    final_payment_status: 'unpaid',
  };
}

function stageOpportunityId(job: JobRow): string | null {
  if (job.opportunity_contract === 'separate_v1') return job.production_opportunity_id;
  if (job.opportunity_contract === 'legacy_single_v1') return job.proposal_id;
  return null;
}

export default async function handler(req: Request) {
  if (req.method !== 'POST') return json({ error: 'POST only' }, { status: 405 });

  const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const GHL_API_KEY = process.env.GHL_API_KEY ?? '';
  const GHL_WEBHOOK_SECRET = process.env.GHL_WEBHOOK_SECRET ?? '';
  const GHL_TODD_CONTACT_ID = process.env.GHL_TODD_CONTACT_ID ?? '';
  const GHL_OUTBOUND_IP_PREFIXES = (process.env.GHL_OUTBOUND_IP_PREFIXES ?? '').split(',').map(s => s.trim()).filter(Boolean);

  const sbCtx: SbCtx = { url: SUPABASE_URL, key: SUPABASE_SERVICE_ROLE_KEY };

  // --- Auth ---
  const providedSecret = req.headers.get('X-Abrams-Webhook-Secret') || '';
  if (!GHL_WEBHOOK_SECRET || !constantTimeEqual(providedSecret, GHL_WEBHOOK_SECRET)) {
    const ip = req.headers.get('X-Forwarded-For') || req.headers.get('CF-Connecting-IP') || 'unknown';
    const masked = providedSecret ? `${providedSecret.slice(0, 3)}…(${providedSecret.length} chars)` : 'missing';
    console.warn('[ghl-invoice-paid] AUTH FAIL', { ip, masked });
    await sendToddSms(
      GHL_API_KEY,
      GHL_TODD_CONTACT_ID,
      '🚨 ABRAMS ALERT\nUnauthorized invoice webhook attempt.\n' +
      `Source IP: ${ip}\n` +
      `Header value: ${masked}`
    );
    return json({ error: 'unauthorized' }, { status: 401 });
  }

  // --- Soft IP check ---
  const ip = req.headers.get('X-Forwarded-For') || req.headers.get('CF-Connecting-IP') || 'unknown';
  if (ip !== 'unknown' && !ipMatchesAnyPrefix(ip, GHL_OUTBOUND_IP_PREFIXES)) {
    console.warn('[ghl-invoice-paid] source IP outside GHL range', { ip });
  }

  // --- Parse ---
  let body: InvoicePaidPayload;
  try { body = await req.json(); }
  catch { return json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { contactId, opportunityId, invoiceId } = body;
  if (!opportunityId) return json({ error: 'opportunityId required' }, { status: 400 });

  // Determine paymentType (default 'deposit' for backwards-compat).
  const rawType = body.paymentType ?? 'deposit';
  if (rawType !== 'deposit' && rawType !== 'final_balance') {
    return json({ error: `unknown paymentType: ${rawType}` }, { status: 400 });
  }
  const paymentType = rawType as PaymentType;
  let GHL_STAGE_JOB_CREATED: string;
  let GHL_STAGE_JOB_COMPLETE: string;
  try {
    GHL_STAGE_JOB_CREATED = productionStageRouting('job_created');
    GHL_STAGE_JOB_COMPLETE = productionStageRouting('job_complete');
  } catch {
    return json({ error: 'Production routing is not safely configured' }, { status: 500 });
  }

  // New jobs match either inbound Sales provenance or their Production ID, but
  // every stage mutation below targets only the persisted Production ID.
  // Explicit legacy rows retain their historical one-ID behavior.
  const encodedOpportunityId = encodeURIComponent(opportunityId);
  const lookupRes = await sb(
    sbCtx,
    `jobs?or=(production_opportunity_id.eq.${encodedOpportunityId},sales_opportunity_id.eq.${encodedOpportunityId},and(opportunity_contract.eq.legacy_single_v1,proposal_id.eq.${encodedOpportunityId}))&select=job_id,job_number,proposal_id,sales_opportunity_id,production_opportunity_id,opportunity_contract,deposit_status,final_payment_status`,
    { method: 'GET' }
  );
  if (!lookupRes.ok) {
    const t = await lookupRes.text().catch(() => '');
    console.error('[ghl-invoice-paid] job lookup failed', t);
    return json({ error: 'job lookup failed' }, { status: 502 });
  }
  let rows = (await lookupRes.json()) as JobRow[];

  // A customer can pay a deposit without ever signing a proposal, in which case
  // the payment itself is what creates the job, priced from the snapshot frozen
  // when the invoice was drafted.
  if (rows.length === 0 && paymentType === 'deposit') {
    const fromDraft = await createJobFromDepositDraft(sbCtx, opportunityId);
    if (fromDraft) rows = [fromDraft];
  }

  if (rows.length === 0) {
    console.warn('[ghl-invoice-paid] no matching job', { opportunityId, contactId, invoiceId, paymentType });
    await sendToddSms(
      GHL_API_KEY,
      GHL_TODD_CONTACT_ID,
      '🚨 ABRAMS ALERT\nInvoice paid but no matching job found.\n' +
      `Contact ID: ${contactId ?? '(missing)'}\n` +
      `Invoice ID: ${invoiceId ?? '(missing)'}\n` +
      `Opportunity ID: ${opportunityId}\n` +
      `Payment type: ${paymentType}\n` +
      'Check Supabase — manual intervention required.'
    );
    return json({ error: 'no matching job', opportunityId }, { status: 422 });
  }

  const job = rows[0];
  const stageOpportunity = stageOpportunityId(job);
  if (!stageOpportunity) return json({ error: 'job has no valid Production opportunity boundary' }, { status: 409 });
  const nowIso = new Date().toISOString();

  if (paymentType === 'deposit') {
    return handleDeposit(req, sbCtx, job, body, nowIso, stageOpportunity, contactId,
      { GHL_API_KEY, GHL_STAGE_JOB_CREATED });
  }
  return handleFinalBalance(req, sbCtx, job, body, nowIso, stageOpportunity, contactId,
    { GHL_API_KEY, GHL_STAGE_JOB_COMPLETE });
}

async function handleDeposit(
  _req: Request,
  sbCtx: SbCtx,
  job: JobRow,
  body: InvoicePaidPayload,
  nowIso: string,
  productionOpportunityId: string,
  contactId: string | undefined,
  env: { GHL_API_KEY: string; GHL_STAGE_JOB_CREATED: string },
): Promise<Response> {
  // Idempotency
  if (job.deposit_status === 'paid') {
    return json({ already_processed: true, job_id: job.job_id, job_number: job.job_number }, { status: 200 });
  }

  // UPDATE
  const updateRes = await sb(
    sbCtx,
    `jobs?job_id=eq.${encodeURIComponent(job.job_id)}&deposit_status=eq.pending_invoice`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        deposit_status: 'paid',
        deposit_paid_at: body.paidAt || nowIso,
      }),
    }
  );
  if (!updateRes.ok) {
    const t = await updateRes.text().catch(() => '');
    console.error('[ghl-invoice-paid] deposit UPDATE failed', t);
    return json({ error: 'update failed', detail: t }, { status: 502 });
  }
  const updated = (await updateRes.json()) as JobRow[];
  if (updated.length === 0) {
    return json({ already_processed: true, job_id: job.job_id, job_number: job.job_number }, { status: 200 });
  }

  // Activity log
  const activityRes = await sb(sbCtx, 'job_activity_log', {
    method: 'POST',
    body: JSON.stringify({
      job_id: job.job_id,
      contact_id: contactId ?? null,
      type: 'deposit_paid_via_invoice',
      actor: 'system',
      source: 'workflow',
      payload: { invoice_id: body.invoiceId ?? null, amount_paid: body.amountPaid ?? null, production_opportunity_id: productionOpportunityId },
    }),
  });
  if (!activityRes.ok) {
    const t = await activityRes.text().catch(() => '');
    console.error('[ghl-invoice-paid] deposit activity log insert failed', t);
  }

  // GHL stage move (fail-soft)
  if (env.GHL_API_KEY && env.GHL_STAGE_JOB_CREATED) {
    try {
      const response = await fetch(`${GHL_BASE}/opportunities/${productionOpportunityId}`, {
        method: 'PUT',
        headers: ghlHeaders(env.GHL_API_KEY),
        body: JSON.stringify({ pipelineStageId: env.GHL_STAGE_JOB_CREATED }),
      });
      await logGhlNonOk('GHL Job Created stage move', response);
    } catch (err) {
      console.error('[ghl-invoice-paid] GHL Job Created stage move failed:', err);
    }
  }

  // Paid note (fail-soft)
  if (env.GHL_API_KEY && contactId) {
    try {
      const note = `[AUTO] Deposit received — job ${job.job_number} moving to production`;
      const response = await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, {
        method: 'POST',
        headers: ghlHeaders(env.GHL_API_KEY),
        body: JSON.stringify({ body: note }),
      });
      await logGhlNonOk('deposit paid note', response);
    } catch (err) {
      console.error('[ghl-invoice-paid] deposit paid note failed:', err);
    }
  }

  return json({ job_id: job.job_id, job_number: job.job_number, status: 'paid' }, { status: 201 });
}

async function handleFinalBalance(
  _req: Request,
  sbCtx: SbCtx,
  job: JobRow,
  body: InvoicePaidPayload,
  nowIso: string,
  productionOpportunityId: string,
  contactId: string | undefined,
  env: { GHL_API_KEY: string; GHL_STAGE_JOB_COMPLETE: string },
): Promise<Response> {
  // Idempotency
  if (job.final_payment_status === 'paid') {
    return json({ already_processed: true, job_id: job.job_id, job_number: job.job_number }, { status: 200 });
  }

  // UPDATE: accept both schema-valid non-paid states. The status guard makes
  // concurrent deliveries race safely without overwriting a paid timestamp.
  const updateRes = await sb(
    sbCtx,
    `jobs?job_id=eq.${encodeURIComponent(job.job_id)}&final_payment_status=in.(unpaid,pending_invoice)`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        final_payment_status: 'paid',
        final_payment_paid_at: body.paidAt || nowIso,
      }),
    }
  );
  if (!updateRes.ok) {
    const t = await updateRes.text().catch(() => '');
    console.error('[ghl-invoice-paid] final UPDATE failed', t);
    return json({ error: 'update failed', detail: t }, { status: 502 });
  }
  const updated = (await updateRes.json()) as JobRow[];
  if (updated.length === 0) {
    // A zero-row guarded PATCH is only idempotent if a concurrent request
    // actually moved the row to paid. Re-read before making that claim.
    const raceLookup = await sb(
      sbCtx,
      `jobs?job_id=eq.${encodeURIComponent(job.job_id)}&select=job_id,job_number,proposal_id,sales_opportunity_id,production_opportunity_id,opportunity_contract,deposit_status,final_payment_status`,
      { method: 'GET' },
    );
    if (!raceLookup.ok) {
      const detail = await raceLookup.text().catch(() => '');
      console.error('[ghl-invoice-paid] final race lookup failed', detail);
      return json({ error: 'final payment state could not be confirmed' }, { status: 502 });
    }
    const [current] = (await raceLookup.json()) as JobRow[];
    if (current?.final_payment_status === 'paid') {
      return json({ already_processed: true, job_id: current.job_id, job_number: current.job_number }, { status: 200 });
    }
    console.error('[ghl-invoice-paid] final UPDATE changed no rows and payment is not paid', {
      productionOpportunityId,
      finalPaymentStatus: current?.final_payment_status ?? 'missing',
    });
    return json({ error: 'final payment state conflict' }, { status: 409 });
  }

  // Activity log
  const activityRes = await sb(sbCtx, 'job_activity_log', {
    method: 'POST',
    body: JSON.stringify({
      job_id: job.job_id,
      contact_id: contactId ?? null,
      type: 'final_payment_via_invoice',
      actor: 'system',
      source: 'workflow',
      payload: { invoice_id: body.invoiceId ?? null, amount_paid: body.amountPaid ?? null, production_opportunity_id: productionOpportunityId },
    }),
  });
  if (!activityRes.ok) {
    const t = await activityRes.text().catch(() => '');
    console.error('[ghl-invoice-paid] final activity log insert failed', t);
  }

  // GHL stage move to Job Complete (fail-soft)
  if (env.GHL_API_KEY && env.GHL_STAGE_JOB_COMPLETE) {
    try {
      const response = await fetch(`${GHL_BASE}/opportunities/${productionOpportunityId}`, {
        method: 'PUT',
        headers: ghlHeaders(env.GHL_API_KEY),
        body: JSON.stringify({ pipelineStageId: env.GHL_STAGE_JOB_COMPLETE }),
      });
      await logGhlNonOk('GHL Job Complete stage move', response);
    } catch (err) {
      console.error('[ghl-invoice-paid] GHL Job Complete stage move failed:', err);
    }
  }

  // Paid note (fail-soft)
  if (env.GHL_API_KEY && contactId) {
    try {
      const note = `[AUTO] Final payment received — job ${job.job_number} complete`;
      const response = await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, {
        method: 'POST',
        headers: ghlHeaders(env.GHL_API_KEY),
        body: JSON.stringify({ body: note }),
      });
      await logGhlNonOk('final paid note', response);
    } catch (err) {
      console.error('[ghl-invoice-paid] final paid note failed:', err);
    }
  }

  return json({ job_id: job.job_id, job_number: job.job_number, status: 'final_paid' }, { status: 201 });
}

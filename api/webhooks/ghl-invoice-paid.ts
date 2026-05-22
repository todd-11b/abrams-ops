// api/webhooks/ghl-invoice-paid.ts
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
  deposit_status: string;
  final_payment_status: string;
}

export default async function handler(req: Request) {
  if (req.method !== 'POST') return json({ error: 'POST only' }, { status: 405 });

  const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const GHL_API_KEY = process.env.GHL_API_KEY ?? '';
  const GHL_STAGE_JOB_CREATED = process.env.GHL_STAGE_JOB_CREATED ?? '';
  const GHL_STAGE_JOB_COMPLETE = process.env.GHL_STAGE_JOB_COMPLETE ?? '';
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

  const { contactId, opportunityId, invoiceId, amountPaid, paidAt } = body;
  if (!opportunityId) return json({ error: 'opportunityId required' }, { status: 400 });

  // Determine paymentType (default 'deposit' for backwards-compat).
  const rawType = body.paymentType ?? 'deposit';
  if (rawType !== 'deposit' && rawType !== 'final_balance') {
    return json({ error: `unknown paymentType: ${rawType}` }, { status: 400 });
  }
  const paymentType = rawType as PaymentType;

  // --- Lookup job by proposal_id (both paths need both *_status fields) ---
  const lookupRes = await sb(
    sbCtx,
    `jobs?proposal_id=eq.${encodeURIComponent(opportunityId)}&select=job_id,job_number,deposit_status,final_payment_status`,
    { method: 'GET' }
  );
  if (!lookupRes.ok) {
    const t = await lookupRes.text().catch(() => '');
    console.error('[ghl-invoice-paid] job lookup failed', t);
    return json({ error: 'job lookup failed' }, { status: 502 });
  }
  const rows = (await lookupRes.json()) as JobRow[];

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
  const nowIso = new Date().toISOString();

  if (paymentType === 'deposit') {
    return handleDeposit(req, sbCtx, job, body, nowIso, opportunityId, contactId,
      { GHL_API_KEY, GHL_STAGE_JOB_CREATED });
  }
  return handleFinalBalance(req, sbCtx, job, body, nowIso, opportunityId, contactId,
    { GHL_API_KEY, GHL_STAGE_JOB_COMPLETE });
}

async function handleDeposit(
  _req: Request,
  sbCtx: SbCtx,
  job: JobRow,
  body: InvoicePaidPayload,
  nowIso: string,
  opportunityId: string,
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
    `jobs?proposal_id=eq.${encodeURIComponent(opportunityId)}&deposit_status=eq.pending_invoice`,
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
      payload: { invoice_id: body.invoiceId ?? null, amount_paid: body.amountPaid ?? null, opportunity_id: opportunityId },
    }),
  });
  if (!activityRes.ok) {
    const t = await activityRes.text().catch(() => '');
    console.error('[ghl-invoice-paid] deposit activity log insert failed', t);
  }

  // GHL stage move (fail-soft)
  if (env.GHL_API_KEY && env.GHL_STAGE_JOB_CREATED) {
    try {
      await fetch(`${GHL_BASE}/opportunities/${opportunityId}`, {
        method: 'PUT',
        headers: ghlHeaders(env.GHL_API_KEY),
        body: JSON.stringify({ pipelineStageId: env.GHL_STAGE_JOB_CREATED }),
      });
    } catch (err) {
      console.error('[ghl-invoice-paid] GHL Job Created stage move failed:', err);
    }
  }

  // Paid note (fail-soft)
  if (env.GHL_API_KEY && contactId) {
    try {
      const note = `[AUTO] Deposit received — job ${job.job_number} moving to production`;
      await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, {
        method: 'POST',
        headers: ghlHeaders(env.GHL_API_KEY),
        body: JSON.stringify({ body: note }),
      });
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
  opportunityId: string,
  contactId: string | undefined,
  env: { GHL_API_KEY: string; GHL_STAGE_JOB_COMPLETE: string },
): Promise<Response> {
  // Idempotency
  if (job.final_payment_status === 'paid') {
    return json({ already_processed: true, job_id: job.job_id, job_number: job.job_number }, { status: 200 });
  }

  // UPDATE: only flip when current status is NOT already paid. We accept any
  // non-paid state ('unpaid' or 'pending_invoice') as the WHERE-clause guard.
  const updateRes = await sb(
    sbCtx,
    `jobs?proposal_id=eq.${encodeURIComponent(opportunityId)}&final_payment_status=eq.unpaid`,
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
    return json({ already_processed: true, job_id: job.job_id, job_number: job.job_number }, { status: 200 });
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
      payload: { invoice_id: body.invoiceId ?? null, amount_paid: body.amountPaid ?? null, opportunity_id: opportunityId },
    }),
  });
  if (!activityRes.ok) {
    const t = await activityRes.text().catch(() => '');
    console.error('[ghl-invoice-paid] final activity log insert failed', t);
  }

  // GHL stage move to Job Complete (fail-soft)
  if (env.GHL_API_KEY && env.GHL_STAGE_JOB_COMPLETE) {
    try {
      await fetch(`${GHL_BASE}/opportunities/${opportunityId}`, {
        method: 'PUT',
        headers: ghlHeaders(env.GHL_API_KEY),
        body: JSON.stringify({ pipelineStageId: env.GHL_STAGE_JOB_COMPLETE }),
      });
    } catch (err) {
      console.error('[ghl-invoice-paid] GHL Job Complete stage move failed:', err);
    }
  }

  // Paid note (fail-soft)
  if (env.GHL_API_KEY && contactId) {
    try {
      const note = `[AUTO] Final payment received — job ${job.job_number} complete`;
      await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, {
        method: 'POST',
        headers: ghlHeaders(env.GHL_API_KEY),
        body: JSON.stringify({ body: note }),
      });
    } catch (err) {
      console.error('[ghl-invoice-paid] final paid note failed:', err);
    }
  }

  return json({ job_id: job.job_id, job_number: job.job_number, status: 'final_paid' }, { status: 201 });
}

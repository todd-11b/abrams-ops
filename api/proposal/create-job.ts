// api/proposal/create-job.ts
// Vercel edge function — called by SignPayView when the customer signs the
// proposal. Creates the job row in Supabase with deposit_status='pending_invoice'
// and signed_at=NOW(), appends the activity log, marks the GHL opportunity as
// 'won', and posts a signature note. The deposit itself clears via a separate
// GHL invoice; the invoice-paid webhook flips the job to 'paid' and moves the
// GHL pipeline stage.
//
// Required env (server-only):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   GHL_API_KEY
//   GHL_LOCATION_ID

export const config = { runtime: 'edge' };

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(init.headers || {}) },
  });
}

interface RequestBody {
  contact_id: string;
  proposal_opportunity_id: string | null;
  proposal_display_id?: string;
  deposit_due?: number;
  fence_spec?: {
    fence_lines: unknown[];
    gates: unknown[];
    addons: unknown[];
    total_sections: number;
    total_lf: number;
    proposal_total: number;
  };
}

async function sb(supabaseUrl: string, serviceRoleKey: string, path: string, init: RequestInit = {}) {
  return fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(init.headers || {}),
    },
  });
}

function ghlHeaders(ghlApiKey: string) {
  return {
    Authorization: `Bearer ${ghlApiKey}`,
    'Content-Type': 'application/json',
    Version: GHL_VERSION,
  };
}

function fmtCurrency(n: number | undefined): string {
  if (typeof n !== 'number') return '—';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export default async function handler(req: Request) {
  if (req.method !== 'POST') return json({ error: 'POST only' }, { status: 405 });

  const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
  const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const GHL_API_KEY = process.env.GHL_API_KEY ?? '';

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'Server misconfigured: Supabase env missing' }, { status: 500 });
  }

  let body: RequestBody;
  try { body = await req.json(); }
  catch { return json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (!body.contact_id) return json({ error: 'contact_id required' }, { status: 400 });

  const nowIso = new Date().toISOString();

  // 1) Insert job (mutation ordering step 1).
  const jobRes = await sb(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, 'jobs', {
    method: 'POST',
    body: JSON.stringify({
      contact_id: body.contact_id,
      proposal_id: body.proposal_opportunity_id,
      stage: 'job_created',
      status: 'active',
      deposit_status: 'pending_invoice',
      signed_at: nowIso,
    }),
  });
  if (!jobRes.ok) {
    const t = await jobRes.text().catch(() => '');
    return json({ error: 'jobs insert failed', detail: t }, { status: 502 });
  }
  const [job] = (await jobRes.json()) as { job_id: string; job_number: string }[];

  // 1b) Insert fence spec if provided (best-effort).
  if (body.fence_spec) {
    await sb(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, 'job_fence_specs', {
      method: 'POST',
      body: JSON.stringify({ job_id: job.job_id, ...body.fence_spec }),
    });
  }

  // 2) Append activity log (step 2). If this fails, the job still exists.
  await sb(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, 'job_activity_log', {
    method: 'POST',
    body: JSON.stringify({
      job_id: job.job_id,
      contact_id: body.contact_id,
      type: 'proposal_signed',
      actor: 'system',
      source: 'system',
      payload: { proposal_opportunity_id: body.proposal_opportunity_id ?? null },
    }),
  });

  // 3a) Mark GHL opportunity as won (fail-soft).
  if (body.proposal_opportunity_id && GHL_API_KEY) {
    try {
      await fetch(`${GHL_BASE}/opportunities/${body.proposal_opportunity_id}`, {
        method: 'PUT',
        headers: ghlHeaders(GHL_API_KEY),
        body: JSON.stringify({ status: 'won' }),
      });
    } catch (err) {
      console.error('[create-job] GHL status=won failed:', err);
    }
  }

  // 3b) Post the signature note (fail-soft).
  if (GHL_API_KEY) {
    try {
      const noteBody = [
        '[AUTO] Proposal signed — invoice pending',
        body.proposal_display_id ? `Proposal ${body.proposal_display_id}` : null,
        typeof body.deposit_due === 'number' ? `Deposit due: ${fmtCurrency(body.deposit_due)}` : null,
      ].filter(Boolean).join('\n');
      await fetch(`${GHL_BASE}/contacts/${body.contact_id}/notes`, {
        method: 'POST',
        headers: ghlHeaders(GHL_API_KEY),
        body: JSON.stringify({ body: noteBody }),
      });
    } catch (err) {
      console.error('[create-job] GHL signature note failed:', err);
    }
  }

  return json({ job_id: job.job_id, job_number: job.job_number }, { status: 201 });
}

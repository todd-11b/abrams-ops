// api/proposal/create-job.ts
// Vercel edge function — called by the proposal sign+pay flow after the
// deposit clears. Creates the job row in Supabase, appends the activity log,
// then moves the GHL opportunity to the Job Created stage.
//
// Required env (server-only):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   GHL_API_KEY
//   GHL_LOCATION_ID
//   GHL_FENCE_PRODUCTION_PIPELINE_ID
//   GHL_STAGE_JOB_CREATED

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const GHL_API_KEY = process.env.GHL_API_KEY ?? '';
const GHL_STAGE_JOB_CREATED = process.env.GHL_STAGE_JOB_CREATED ?? '';
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
  fence_spec?: {
    fence_lines: unknown[];
    gates: unknown[];
    addons: unknown[];
    total_sections: number;
    total_lf: number;
    proposal_total: number;
  };
}

async function sb(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(init.headers || {}),
    },
  });
}

export default async function handler(req: Request) {
  if (req.method !== 'POST') return json({ error: 'POST only' }, { status: 405 });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Server misconfigured: Supabase env missing' }, { status: 500 });

  let body: RequestBody;
  try { body = await req.json(); }
  catch { return json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (!body.contact_id) return json({ error: 'contact_id required' }, { status: 400 });

  // 1) Insert job (mutation ordering step 1).
  const jobRes = await sb('jobs', {
    method: 'POST',
    body: JSON.stringify({
      contact_id: body.contact_id,
      proposal_id: body.proposal_opportunity_id,
      stage: 'job_created',
      status: 'active',
      deposit_status: 'paid',
      deposit_paid_at: new Date().toISOString(),
    }),
  });
  if (!jobRes.ok) {
    const t = await jobRes.text().catch(() => '');
    return json({ error: 'jobs insert failed', detail: t }, { status: 502 });
  }
  const [job] = (await jobRes.json()) as { job_id: string; job_number: string }[];

  // 1b) Insert fence spec if provided (best-effort).
  if (body.fence_spec) {
    await sb('job_fence_specs', {
      method: 'POST',
      body: JSON.stringify({ job_id: job.job_id, ...body.fence_spec }),
    });
  }

  // 2) Append activity log (step 2). If this fails, the job still exists.
  await sb('job_activity_log', {
    method: 'POST',
    body: JSON.stringify({
      job_id: job.job_id,
      contact_id: body.contact_id,
      type: 'job_created',
      actor: 'system',
      source: 'system',
      payload: { proposal_opportunity_id: body.proposal_opportunity_id ?? null },
    }),
  });

  // 3) Mirror to GHL (step 3, fail-soft).
  if (body.proposal_opportunity_id && GHL_API_KEY && GHL_STAGE_JOB_CREATED) {
    try {
      await fetch(`${GHL_BASE}/opportunities/${body.proposal_opportunity_id}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${GHL_API_KEY}`,
          'Content-Type': 'application/json',
          Version: GHL_VERSION,
        },
        body: JSON.stringify({ pipelineStageId: GHL_STAGE_JOB_CREATED }),
      });
    } catch (err) {
      // swallowed — Supabase row is authoritative
      console.error('[create-job] GHL stage move failed:', err);
    }
  }

  return json({ job_id: job.job_id, job_number: job.job_number }, { status: 201 });
}

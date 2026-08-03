import { sendOwnerAlertSms } from '../_lib/owner-alert';
import { shouldFireBlockNotification } from '../_lib/notification-throttle';
import { supabaseRequest } from '../_lib/server-data';

export const config = { runtime: 'edge' };

const encoder = new TextEncoder();

/** Compares the bearer token without leaking its prefix through timing. */
function secretMatches(presented: string, expected: string): boolean {
  const a = encoder.encode(presented);
  const b = encoder.encode(expected);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

interface BlockedJob {
  job_id: string;
  job_number: string;
  contact_id: string;
  blocked_reason: string | null;
  blocked_at: string | null;
  last_blocked_notification_at: string | null;
}

/**
 * Sweeps blocked jobs on a schedule so the reminder depends on how long a job
 * has been blocked rather than on somebody happening to open its page. Runs
 * hourly; the throttle decides which of those hours actually send.
 */
export default async function handler(req: Request) {
  const secret = process.env.CRON_SECRET ?? '';
  if (!secret || !secretMatches(req.headers.get('Authorization') ?? '', `Bearer ${secret}`)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const apiKey = process.env.GHL_API_KEY ?? '';
  const ownerContactId = process.env.GHL_TODD_CONTACT_ID ?? '';
  if (!apiKey || !ownerContactId) {
    return new Response(JSON.stringify({ error: 'CRM not configured' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  const response = await supabaseRequest(
    'jobs?status=eq.blocked&archived_at=is.null&select=job_id,job_number,contact_id,blocked_reason,blocked_at,last_blocked_notification_at',
  );
  if (!response.ok) {
    return new Response(JSON.stringify({ error: 'job lookup failed' }), { status: 502, headers: { 'Content-Type': 'application/json' } });
  }
  const jobs = await response.json() as BlockedJob[];

  let sent = 0;
  let failed = 0;
  for (const job of jobs) {
    if (!shouldFireBlockNotification(job.blocked_at, job.last_blocked_notification_at)) continue;
    const delivered = await sendOwnerAlertSms(job, job.blocked_reason ?? 'unspecified', apiKey, ownerContactId);
    if (!delivered) { failed += 1; continue; }
    // Only a delivered text moves the throttle, so a CRM outage retries next hour.
    await supabaseRequest(`jobs?job_id=eq.${encodeURIComponent(job.job_id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ last_blocked_notification_at: new Date().toISOString() }),
    });
    sent += 1;
  }

  return new Response(JSON.stringify({ blocked: jobs.length, sent, failed }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

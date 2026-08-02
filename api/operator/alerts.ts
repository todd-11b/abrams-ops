import { canOperator, requireOperator, secureJson } from '../_lib/operator-auth';
import { GHL_BASE, fetchGhlContact } from '../_lib/proposal-source';
import { supabaseRequest } from '../_lib/server-data';

export const config = { runtime: 'edge' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface JobRow { job_id: string; job_number: string; contact_id: string; status: string; blocked_reason: string | null }
interface IssueRow { job_id: string; type: string; severity: string }

async function selectOne<T>(path: string): Promise<T | null> {
  const response = await supabaseRequest(path);
  if (!response.ok) return null;
  const [row] = await response.json() as T[];
  return row ?? null;
}

/**
 * Owner alerts are dispatched here rather than from the browser so they do not
 * depend on the operator's CRM messaging scope, and so a delivery failure is
 * reported back to the caller instead of disappearing into the console.
 */
export default async function handler(req: Request) {
  const operator = await requireOperator(req);
  if (!operator) return secureJson({ error: 'unauthorized' }, { status: 401 });
  if (!canOperator(operator, 'operator:data')) return secureJson({ error: 'forbidden' }, { status: 403 });
  if (req.method !== 'POST') return secureJson({ error: 'method not allowed' }, { status: 405 });

  let body: { kind?: string; job_id?: string; issue_id?: string };
  try { body = await req.json(); } catch { return secureJson({ error: 'invalid JSON' }, { status: 400 }); }
  if ((body.kind !== 'job_blocked' && body.kind !== 'issue_high') || !UUID.test(String(body.job_id))) {
    return secureJson({ error: 'invalid alert request' }, { status: 400 });
  }

  const apiKey = process.env.GHL_API_KEY ?? '';
  const ownerContactId = process.env.GHL_TODD_CONTACT_ID ?? '';
  if (!apiKey || !ownerContactId) return secureJson({ error: 'CRM not configured' }, { status: 500 });

  const job = await selectOne<JobRow>(`jobs?job_id=eq.${body.job_id}&select=job_id,job_number,contact_id,status,blocked_reason`);
  if (!job) return secureJson({ error: 'job not found' }, { status: 404 });

  let reason: string;
  if (body.kind === 'job_blocked') {
    if (job.status !== 'blocked') return secureJson({ error: 'job is not blocked' }, { status: 409 });
    reason = job.blocked_reason ?? 'unspecified';
  } else {
    if (!UUID.test(String(body.issue_id))) return secureJson({ error: 'invalid alert request' }, { status: 400 });
    const issue = await selectOne<IssueRow>(`job_issues?issue_id=eq.${body.issue_id}&select=job_id,type,severity`);
    if (!issue || issue.job_id !== job.job_id) return secureJson({ error: 'issue not found' }, { status: 404 });
    if (issue.severity !== 'high') return secureJson({ error: 'issue is not high severity' }, { status: 409 });
    reason = issue.type;
  }

  const { contact } = await fetchGhlContact(job.contact_id, apiKey);
  const name = `${contact?.firstName ?? ''} ${contact?.lastName ?? ''}`.trim() || '(no name)';
  const address = contact?.address1 || '(no address)';
  const message =
    `🚨 ABRAMS ALERT\n` +
    `Job: ${job.job_number} — ${name}\n` +
    `Reason: ${reason}\n` +
    `Address: ${address}\n` +
    `Open: abramsfence.com/production/job/${job.job_id}`;

  let sms: Response;
  try {
    sms = await fetch(`${GHL_BASE}/conversations/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Version: '2021-07-28' },
      body: JSON.stringify({ type: 'SMS', contactId: ownerContactId, message }),
    });
  } catch { return secureJson({ error: 'owner alert delivery failed' }, { status: 502 }); }
  if (!sms.ok) return secureJson({ error: 'owner alert delivery failed' }, { status: 502 });
  return secureJson({ sent: true });
}

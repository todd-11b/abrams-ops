import { GHL_BASE, fetchGhlContact } from './proposal-source';

const CRM_ID = /^[A-Za-z0-9]{1,40}$/;

export interface AlertJob {
  job_id: string;
  job_number: string;
  contact_id: string;
}

/**
 * The one owner-alert text format, shared by the operator route and the
 * scheduled blocked-job sweep so both read identically on the phone.
 */
export async function sendOwnerAlertSms(
  job: AlertJob,
  reason: string,
  apiKey: string,
  ownerContactId: string,
): Promise<boolean> {
  const { contact } = CRM_ID.test(job.contact_id) ? await fetchGhlContact(job.contact_id, apiKey) : { contact: null };
  const name = `${contact?.firstName ?? ''} ${contact?.lastName ?? ''}`.trim() || '(no name)';
  const address = contact?.address1 || '(no address)';
  const message =
    `🚨 ABRAMS ALERT\n` +
    `Job: ${job.job_number} — ${name}\n` +
    `Reason: ${reason}\n` +
    `Address: ${address}\n` +
    `Open: abramsfence.com/production/job/${job.job_id}`;

  try {
    const sms = await fetch(`${GHL_BASE}/conversations/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Version: '2021-07-28' },
      body: JSON.stringify({ type: 'SMS', contactId: ownerContactId, message }),
    });
    return sms.ok;
  } catch {
    return false;
  }
}

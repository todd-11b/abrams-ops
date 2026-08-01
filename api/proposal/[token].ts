import { secureJson } from '../_lib/operator-auth';
import { sha256, supabaseRequest } from '../_lib/server-data';

export const config = { runtime: 'edge' };
const GHL_BASE = 'https://services.leadconnectorhq.com';
const JSON_FIELD_ID = 'v74WeVuNKTrjnYGM6ICN';

export default async function handler(req: Request) {
  if (req.method !== 'GET') return secureJson({ error: 'method not allowed' }, { status: 405 });
  const token = decodeURIComponent(new URL(req.url).pathname.split('/').filter(Boolean).at(-1) ?? '');
  if (!/^[a-f0-9]{64}$/.test(token)) return secureJson({ error: 'proposal unavailable' }, { status: 404 });
  const tokenRes = await supabaseRequest(`proposal_access_tokens?token_hash=eq.${await sha256(token)}&purpose=eq.proposal_view_sign&select=contact_id,proposal_id,expires_at`);
  if (!tokenRes.ok) return secureJson({ error: 'proposal unavailable' }, { status: 502 });
  const [record] = await tokenRes.json() as Array<{ contact_id: string; proposal_id: string; expires_at: string }>;
  if (!record || Date.parse(record.expires_at) <= Date.now()) return secureJson({ error: 'proposal unavailable' }, { status: 404 });
  const apiKey = process.env.GHL_API_KEY ?? '';
  if (!apiKey) return secureJson({ error: 'server misconfigured' }, { status: 500 });
  const ghl = await fetch(`${GHL_BASE}/contacts/${encodeURIComponent(record.contact_id)}`, { headers: { Authorization: `Bearer ${apiKey}`, Version: '2021-07-28' } });
  if (!ghl.ok) return secureJson({ error: 'proposal unavailable' }, { status: ghl.status === 404 ? 404 : 502 });
  const contact = (await ghl.json()).contact;
  const field = contact?.customFields?.find((f: { id?: string; key?: string }) => f.id === JSON_FIELD_ID || f.key === 'contact.job_line_items_json' || f.key === 'job_line_items_json');
  if (!field?.value) return secureJson({ error: 'proposal unavailable' }, { status: 404 });
  try {
    const form = JSON.parse(field.value);
    form.contactId = undefined;
    form.opportunityId = record.proposal_id;
    form.contactName = `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim() || form.contactName || 'Customer';
    form.contactPhone = contact.phone || form.contactPhone || '';
    form.contactEmail = contact.email || form.contactEmail || '';
    if (contact.address1) form.propertyAddress = contact.address1;
    form.photos = [];
    return secureJson({ form });
  } catch { return secureJson({ error: 'proposal unavailable' }, { status: 500 }); }
}

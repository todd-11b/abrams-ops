import { secureJson } from '../_lib/operator-auth';
import { fetchGhlContact, readStoredProposal } from '../_lib/proposal-source';
import { sha256, supabaseRequest } from '../_lib/server-data';

export const config = { runtime: 'edge' };

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
  const { status, contact } = await fetchGhlContact(record.contact_id, apiKey);
  if (!contact) return secureJson({ error: 'proposal unavailable' }, { status: status === 404 ? 404 : 502 });
  const stored = readStoredProposal(contact);
  if (!stored) return secureJson({ error: 'proposal unavailable' }, { status: 404 });
  const form = {
    ...stored,
    contactId: undefined,
    opportunityId: record.proposal_id,
    contactName: `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim() || stored.contactName || 'Customer',
    contactPhone: contact.phone || stored.contactPhone || '',
    contactEmail: contact.email || stored.contactEmail || '',
    propertyAddress: contact.address1 || stored.propertyAddress,
    photos: [],
  };
  return secureJson({ form });
}

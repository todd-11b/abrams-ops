import { authorizeQuoteBrain, json, unauthorized } from './_lib/auth';
import { contactIdValid, resolveStyle } from './_lib/form';
import { quotePayload } from './_lib/form';
import { loadContact, storedQuote } from './_lib/ghl-quote';

export const config = { runtime: 'edge' };

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (!authorizeQuoteBrain(req)) return unauthorized();
  if (req.method !== 'GET' && req.method !== 'POST') return json({ error: 'method not allowed' }, { status: 405 });
  const apiKey = process.env.GHL_API_KEY ?? '';
  if (!apiKey) return json({ error: 'CRM not configured' }, { status: 500 });
  const url = new URL(req.url);
  let contactId = url.searchParams.get('contactId') ?? '';
  if (req.method === 'POST') {
    try {
      const body = await req.json() as { contactId?: string };
      if (body?.contactId) contactId = body.contactId;
    } catch {
      return json({ error: 'invalid JSON' }, { status: 400 });
    }
  }
  if (!contactIdValid(contactId)) return json({ error: 'contactId required' }, { status: 400 });
  const { status, contact } = await loadContact(contactId, apiKey);
  if (!contact) return json({ error: status === 404 ? 'contact not found' : 'CRM unreachable' }, { status: status === 404 ? 404 : 502 });
  const form = storedQuote(contact);
  if (!form) return json({ saved: false, contactId }, { status: 404 });
  const resolved = resolveStyle(form.fenceLines?.[0]?.style) ?? resolveStyle('wood_cedar_6');
  if (!resolved) return json({ saved: true, contactId, form }, { status: 200 });
  return json({ saved: true, contactId, contactName: form.contactName, ...quotePayload(form, resolved) });
}

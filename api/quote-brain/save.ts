import { authorizeQuoteBrain, json, unauthorized } from './_lib/auth';
import { buildQuoteForm, contactIdValid, listStyles, parseQuoteInput, quotePayload } from './_lib/form';
import { loadContact, storedQuote, writeStoredQuote } from './_lib/ghl-quote';

export const config = { runtime: 'edge' };

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (!authorizeQuoteBrain(req)) return unauthorized();
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, { status: 405 });
  const apiKey = process.env.GHL_API_KEY ?? '';
  if (!apiKey) return json({ error: 'CRM not configured' }, { status: 500 });
  let body: unknown;
  try { body = await req.json(); } catch { return json({ error: 'invalid JSON' }, { status: 400 }); }
  const { input, error } = parseQuoteInput(body);
  if (error) return json({ error }, { status: 400 });
  if (!contactIdValid(input.contactId)) return json({ error: 'contactId required' }, { status: 400 });
  const { status, contact } = await loadContact(input.contactId, apiKey);
  if (!contact) return json({ error: status === 404 ? 'contact not found' : 'CRM unreachable' }, { status: status === 404 ? 404 : 502 });
  if (!input.contactName) {
    input.contactName = [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim() || undefined;
  }
  if (!input.contactPhone) input.contactPhone = contact.phone;
  if (!input.contactEmail) input.contactEmail = contact.email;
  if (!input.propertyAddress) input.propertyAddress = contact.address1;
  const built = buildQuoteForm(input, storedQuote(contact));
  if ('error' in built) return json({ error: built.error, styles: listStyles() }, { status: 400 });
  built.form.contactId = input.contactId;
  const written = await writeStoredQuote(input.contactId, built.form, apiKey);
  if (!written.ok) return json({ error: 'failed to save quote', status: written.status }, { status: 502 });
  return json({ saved: true, contactId: input.contactId, ...quotePayload(built.form, built.resolved) });
}

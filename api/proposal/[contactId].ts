// Vercel edge function — public, no auth.
// Fetches a contact's saved consult form from GHL using SERVER-SIDE env vars,
// so the GHL API key never reaches the customer's browser.
//
// Env vars required (set in Vercel project settings, no VITE_ prefix):
//   GHL_API_KEY      — GHL private integration token
//   GHL_LOCATION_ID  — GHL location ID (optional, included for parity with client code)

export const config = { runtime: 'edge' };

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';
const JSON_FIELD_ID = 'v74WeVuNKTrjnYGM6ICN';

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...(init.headers || {}),
    },
  });
}

export default async function handler(req: Request) {
  const apiKey = process.env.GHL_API_KEY;
  if (!apiKey) {
    return json({ error: 'Server misconfigured: GHL_API_KEY missing' }, { status: 500 });
  }

  const url = new URL(req.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const contactId = decodeURIComponent(parts[parts.length - 1] || '');
  if (!contactId) {
    return json({ error: 'Missing contactId' }, { status: 400 });
  }

  const ghlRes = await fetch(`${GHL_BASE}/contacts/${contactId}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Version: GHL_VERSION,
    },
  });

  if (!ghlRes.ok) {
    const text = await ghlRes.text().catch(() => '');
    return json(
      { error: 'Failed to fetch contact from CRM', status: ghlRes.status, detail: text },
      { status: ghlRes.status === 404 ? 404 : 502 }
    );
  }

  const body = await ghlRes.json();
  const contact = body.contact;
  if (!contact) return json({ error: 'Contact not found' }, { status: 404 });

  const jsonField = (contact.customFields || []).find(
    (f: { id?: string; key?: string }) =>
      f.id === JSON_FIELD_ID ||
      f.key === 'contact.job_line_items_json' ||
      f.key === 'job_line_items_json'
  );

  if (!jsonField?.value) {
    return json({ error: 'No proposal data on this contact yet' }, { status: 404 });
  }

  let form: Record<string, unknown>;
  try {
    form = JSON.parse(jsonField.value);
  } catch {
    return json({ error: 'Stored proposal JSON is malformed' }, { status: 500 });
  }

  // Hydrate contact fields from the live record in case the saved snapshot is stale.
  form.contactId = contactId;
  form.contactName = `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || (form.contactName as string) || 'Customer';
  form.contactPhone = contact.phone || form.contactPhone || '';
  form.contactEmail = contact.email || form.contactEmail || '';
  if (contact.address1) form.propertyAddress = contact.address1;

  // Photos are File objects in the form — they can't survive JSON round-trips.
  form.photos = [];

  return json({ form });
}

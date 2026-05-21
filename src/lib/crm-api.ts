// GHL CRM wrapper used by the internal consult app.
// Calls go directly to GHL from the browser using VITE_GHL_API_KEY.
// Customer-facing routes (e.g. /proposal/:contactId) MUST go through the
// edge function at api/proposal/[contactId].ts instead — never expose
// VITE_GHL_API_KEY to public pages.

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

const apiKey = import.meta.env.VITE_GHL_API_KEY;
const locationId = import.meta.env.VITE_GHL_LOCATION_ID;

function jsonHeaders() {
  if (!apiKey) throw new Error('Missing VITE_GHL_API_KEY — set it in Vercel and re-run `vercel env pull`.');
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Version: GHL_VERSION,
  };
}

function authHeaders() {
  if (!apiKey) throw new Error('Missing VITE_GHL_API_KEY');
  return {
    Authorization: `Bearer ${apiKey}`,
    Version: GHL_VERSION,
  };
}

async function jsonOrThrow(res: Response, label: string) {
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GHL ${label} failed: ${res.status} ${text}`);
  }
  return res.json();
}

interface CreateContactInput {
  firstName: string;
  lastName: string;
  phone?: string;
  email?: string;
}

interface UpdateContactPayload {
  address1?: string;
  customFields?: Array<{ id?: string; key?: string; value: unknown }>;
  [key: string]: unknown;
}

export const crmApi = {
  async fetchContacts() {
    const url = new URL(`${GHL_BASE}/contacts/`);
    if (locationId) url.searchParams.set('locationId', locationId);
    const res = await fetch(url, { headers: jsonHeaders() });
    return jsonOrThrow(res, 'fetchContacts');
  },

  async searchContacts(query: string) {
    const url = new URL(`${GHL_BASE}/contacts/search`);
    if (locationId) url.searchParams.set('locationId', locationId);
    url.searchParams.set('query', query);
    const res = await fetch(url, { headers: jsonHeaders() });
    return jsonOrThrow(res, 'searchContacts');
  },

  async getContact(contactId: string) {
    const res = await fetch(`${GHL_BASE}/contacts/${contactId}`, {
      headers: jsonHeaders(),
    });
    return jsonOrThrow(res, 'getContact');
  },

  async createContact(input: CreateContactInput) {
    const res = await fetch(`${GHL_BASE}/contacts/`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ ...input, locationId }),
    });
    return jsonOrThrow(res, 'createContact');
  },

  async updateContact(contactId: string, payload: UpdateContactPayload) {
    const res = await fetch(`${GHL_BASE}/contacts/${contactId}`, {
      method: 'PUT',
      headers: jsonHeaders(),
      body: JSON.stringify(payload),
    });
    return jsonOrThrow(res, 'updateContact');
  },

  async addNote(contactId: string, body: string) {
    const res = await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ body }),
    });
    return jsonOrThrow(res, 'addNote');
  },

  async addTags(contactId: string, tags: string[]) {
    const res = await fetch(`${GHL_BASE}/contacts/${contactId}/tags`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ tags }),
    });
    return jsonOrThrow(res, 'addTags');
  },

  async uploadPhoto(contactId: string, file: File) {
    const fd = new FormData();
    fd.append('file', file);
    if (locationId) fd.append('locationId', locationId);
    fd.append('hosted', 'false');
    fd.append('name', `contact-${contactId}-${Date.now()}-${file.name}`);
    const res = await fetch(`${GHL_BASE}/medias/upload-file`, {
      method: 'POST',
      headers: authHeaders(),
      body: fd,
    });
    return jsonOrThrow(res, 'uploadPhoto');
  },

  async updateOpportunityStatus(
    opportunityId: string,
    status: string,
    pipelineStageId?: string
  ) {
    const payload: Record<string, unknown> = { status };
    if (pipelineStageId) payload.pipelineStageId = pipelineStageId;
    const res = await fetch(`${GHL_BASE}/opportunities/${opportunityId}`, {
      method: 'PUT',
      headers: jsonHeaders(),
      body: JSON.stringify(payload),
    });
    return jsonOrThrow(res, 'updateOpportunityStatus');
  },

  async getPipelines() {
    const url = new URL(`${GHL_BASE}/opportunities/pipelines`);
    if (locationId) url.searchParams.set('locationId', locationId);
    const res = await fetch(url, { headers: jsonHeaders() });
    return jsonOrThrow(res, 'getPipelines');
  },
};

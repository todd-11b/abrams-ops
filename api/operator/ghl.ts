/* eslint-disable @typescript-eslint/no-explicit-any */
import { canOperator, requireOperator, secureJson } from '../_lib/operator-auth';

export const config = { runtime: 'edge' };
const BASE = 'https://services.leadconnectorhq.com';

function id(value: unknown): string | null { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value) ? value : null; }
function record(value: unknown): Record<string, unknown> | null { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function onlyKeys(value: unknown, keys: string[]): Record<string, unknown> | null {
  const candidate = record(value);
  return candidate && Object.keys(candidate).every((key) => keys.includes(key)) ? candidate : null;
}

/**
 * The stage a new consult opportunity opens in. `GHL_SALES_PIPELINE_STAGE_ID`
 * pins it; otherwise it is resolved to the pipeline's first stage so the
 * placement is explicit in the request rather than left to a CRM default.
 */
async function openingStageId(pipelineId: string, apiKey: string, locationId: string): Promise<string | null> {
  const configured = id(process.env.GHL_SALES_PIPELINE_STAGE_ID);
  if (configured) return configured;
  try {
    const response = await fetch(`${BASE}/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`, { headers: { Authorization: `Bearer ${apiKey}`, Version: '2021-07-28' } });
    if (!response.ok) return null;
    const payload = await response.json() as { pipelines?: Array<{ id?: string; stages?: Array<{ id?: string }> }> };
    return id(payload.pipelines?.find((pipeline) => pipeline.id === pipelineId)?.stages?.[0]?.id);
  } catch { return null; }
}

export default async function handler(req: Request) {
  const operator = await requireOperator(req);
  if (!operator) return secureJson({ error: 'unauthorized' }, { status: 401 });
  if (req.method !== 'POST') return secureJson({ error: 'method not allowed' }, { status: 405 });
  const apiKey = process.env.GHL_API_KEY ?? ''; const locationId = process.env.GHL_LOCATION_ID ?? '';
  if (!apiKey || !locationId) return secureJson({ error: 'CRM not configured' }, { status: 500 });
  const contentType = req.headers.get('content-type') ?? '';
  let body: Record<string, any>; let upload: File | null = null;
  if (contentType.includes('multipart/form-data')) {
    const fd = await req.formData(); body = { action: fd.get('action'), contactId: fd.get('contactId') }; upload = fd.get('file') as File | null;
  } else { try { body = await req.json(); } catch { return secureJson({ error: 'invalid JSON' }, { status: 400 }); } }
  const permission = body.action === 'sendSms' ? 'ghl:send-message' : ['fetchContacts', 'searchContacts', 'getPipelines'].includes(String(body.action)) ? 'ghl:broad-read' : 'ghl:standard';
  if (!canOperator(operator, permission)) return secureJson({ error: 'forbidden' }, { status: 403 });
  let path = ''; let method = 'GET'; let payload: unknown; let multipart: FormData | undefined;
  const contactId = id(body.contactId); const opportunityId = id(body.opportunityId);
  switch (body.action) {
    case 'fetchContacts': path = `/contacts/?locationId=${encodeURIComponent(locationId)}`; break;
    // /contacts/search is a POST endpoint with a filter body; the list
    // endpoint fetchContacts already uses takes the same free-text query.
    case 'searchContacts': if (typeof body.query !== 'string' || body.query.length > 100) break; path = `/contacts/?locationId=${encodeURIComponent(locationId)}&query=${encodeURIComponent(body.query)}&limit=20`; break;
    case 'getContact': if (!contactId) break; path = `/contacts/${contactId}`; break;
    case 'createContact': { const input = onlyKeys(body.input, ['firstName','lastName','phone','email']); if (!input || typeof input.firstName !== 'string' || typeof input.lastName !== 'string') break; path = '/contacts/'; method = 'POST'; payload = { ...input, locationId }; break; }
    case 'updateContact': { const update = onlyKeys(body.payload, ['address1','customFields']); if (!contactId || !update || (update.customFields !== undefined && !Array.isArray(update.customFields))) break; path = `/contacts/${contactId}`; method = 'PUT'; payload = update; break; }
    case 'addNote': if (!contactId || typeof body.body !== 'string' || body.body.length > 5000) break; path = `/contacts/${contactId}/notes`; method = 'POST'; payload = { body: body.body }; break;
    case 'addTags': if (!contactId || !Array.isArray(body.tags) || body.tags.length > 20 || body.tags.some((tag: unknown) => typeof tag !== 'string' || tag.length > 100)) break; path = `/contacts/${contactId}/tags`; method = 'POST'; payload = { tags: body.tags }; break;
    case 'createOpportunity': {
      // The server's configured pipeline wins over the browser's, so a stale
      // client cannot open opportunities in the wrong pipeline.
      const pipelineId = id(process.env.GHL_SALES_PIPELINE_ID) ?? id(body.pipelineId); const name = typeof body.name === 'string' ? body.name.trim() : '';
      const monetaryValue = body.monetaryValue;
      if (!contactId || !pipelineId || !name || name.length > 200) break;
      if (monetaryValue !== undefined && (typeof monetaryValue !== 'number' || !Number.isFinite(monetaryValue) || monetaryValue < 0)) break;
      const stageId = await openingStageId(pipelineId, apiKey, locationId);
      path = '/opportunities/'; method = 'POST';
      payload = { pipelineId, locationId, contactId, name, status: 'open', ...(stageId ? { pipelineStageId: stageId } : {}), ...(monetaryValue === undefined ? {} : { monetaryValue }) };
      break;
    }
    case 'updateOpportunityValue': { const value = Number(body.monetaryValue); if (!opportunityId || !Number.isFinite(value) || value < 0 || value > 10_000_000) break; path = `/opportunities/${opportunityId}`; method = 'PUT'; payload = { monetaryValue: value }; break; }
    case 'getPipelines': path = `/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`; break;
    case 'updateOpportunityStatus': if (!opportunityId || typeof body.status !== 'string' || (body.pipelineStageId && !id(body.pipelineStageId))) break; path = `/opportunities/${opportunityId}`; method = 'PUT'; payload = { status: body.status, ...(body.pipelineStageId ? { pipelineStageId: body.pipelineStageId } : {}) }; break;
    case 'moveOpportunityToStage': if (!opportunityId || !id(body.pipelineStageId)) break; path = `/opportunities/${opportunityId}`; method = 'PUT'; payload = { pipelineStageId: body.pipelineStageId }; break;
    case 'sendSms': if (!contactId || typeof body.body !== 'string' || body.body.length > 1600) break; path = '/conversations/messages'; method = 'POST'; payload = { type: 'SMS', contactId, message: body.body }; break;
    case 'uploadPhoto': if (!contactId || !upload) break; path = '/medias/upload-file'; method = 'POST'; multipart = new FormData(); multipart.append('file', upload); multipart.append('locationId', locationId); multipart.append('hosted', 'false'); multipart.append('name', `contact-${contactId}-${Date.now()}-${upload.name}`); break;
  }
  if (!path) return secureJson({ error: 'invalid action or identifier' }, { status: 400 });
  const headers: Record<string,string> = { Authorization: `Bearer ${apiKey}`, Version: '2021-07-28' };
  if (!multipart) headers['Content-Type'] = 'application/json';
  let upstream: Response;
  try {
    upstream = await fetch(`${BASE}${path}`, { method, headers, body: multipart ?? (payload === undefined ? undefined : JSON.stringify(payload)) });
  } catch {
    return secureJson({ error: 'CRM unreachable' }, { status: 502 });
  }
  const text = await upstream.text();
  if (!upstream.ok) return secureJson({ error: 'CRM request failed', status: upstream.status }, { status: 502 });
  return new Response(text || '{}', { status: 200, headers: { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json', 'Cache-Control': 'no-store' } });
}

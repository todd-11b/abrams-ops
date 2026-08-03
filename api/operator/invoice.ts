import { canOperator, requireOperator, secureJson } from '../_lib/operator-auth';
import { depositAmount, draftInvoicePayload, readInvoiceId } from '../_lib/deposit-invoice';
import { GHL_BASE, deriveFenceSpec, fetchGhlContact, readStoredProposal, specMatches, type FenceSpec } from '../_lib/proposal-source';
import { supabaseRequest } from '../_lib/server-data';

export const config = { runtime: 'edge' };

const DISPLAY_ID = /^[A-Za-z0-9_-]{1,40}$/;

interface DraftRow {
  draft_id: string;
  ghl_invoice_id: string;
  deposit_amount: number;
  fence_spec: FenceSpec;
}

async function notifyOwner(apiKey: string, contactId: string, message: string): Promise<void> {
  if (!apiKey || !contactId) return;
  try {
    const response = await fetch(`${GHL_BASE}/conversations/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Version: '2021-07-28' },
      body: JSON.stringify({ type: 'SMS', contactId, message }),
    });
    if (!response.ok) console.error('[operator/invoice] owner SMS returned', response.status);
  } catch (err) {
    console.error('[operator/invoice] owner SMS failed', err);
  }
}

export default async function handler(req: Request) {
  const operator = await requireOperator(req);
  if (!operator) return secureJson({ error: 'unauthorized' }, { status: 401 });
  if (!canOperator(operator, 'operator:invoices')) return secureJson({ error: 'forbidden' }, { status: 403 });
  if (req.method !== 'POST') return secureJson({ error: 'method not allowed' }, { status: 405 });

  let body: { contact_id?: string; proposal_id?: string; proposal_display_id?: string };
  try { body = await req.json(); } catch { return secureJson({ error: 'invalid JSON' }, { status: 400 }); }
  if (!body.contact_id || !body.proposal_id) return secureJson({ error: 'contact_id and proposal_id required' }, { status: 400 });

  const apiKey = process.env.GHL_API_KEY ?? '';
  const locationId = process.env.GHL_LOCATION_ID ?? '';
  if (!apiKey || !locationId) return secureJson({ error: 'CRM not configured' }, { status: 500 });

  // The quote saved in the CRM is the only trusted price; the browser sends none.
  const { status, contact } = await fetchGhlContact(body.contact_id, apiKey);
  if (!contact) return secureJson({ error: 'could not read the saved proposal from the CRM' }, { status: status === 404 ? 404 : 502 });
  const fenceSpec = deriveFenceSpec(readStoredProposal(contact));
  if (!fenceSpec) return secureJson({ error: 'save the proposal before drafting an invoice' }, { status: 409 });
  const deposit = depositAmount(fenceSpec);
  if (deposit === null) return secureJson({ error: 'the proposal has no priced work to invoice' }, { status: 409 });

  const proposalId = encodeURIComponent(body.proposal_id);
  const existingRes = await supabaseRequest(`deposit_invoice_drafts?proposal_id=eq.${proposalId}&superseded_at=is.null&select=draft_id,ghl_invoice_id,deposit_amount,fence_spec`);
  if (!existingRes.ok) return secureJson({ error: 'draft lookup failed' }, { status: 502 });
  const [existing] = await existingRes.json() as DraftRow[];
  // Re-drafting an unchanged quote must not leave a second invoice a customer
  // could also pay.
  if (existing && specMatches(existing.fence_spec, fenceSpec)) {
    return secureJson({ invoice_id: existing.ghl_invoice_id, deposit_amount: existing.deposit_amount, reused: true }, { status: 200 });
  }

  const displayId = typeof body.proposal_display_id === 'string' && DISPLAY_ID.test(body.proposal_display_id) ? body.proposal_display_id : null;
  let created: Response;
  try {
    created = await fetch(`${GHL_BASE}/invoices/`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Version: '2021-07-28' },
      body: JSON.stringify(draftInvoicePayload({
        locationId,
        businessName: process.env.GHL_BUSINESS_NAME ?? 'Abrams Fence',
        contact: {
          id: body.contact_id,
          name: `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim() || 'Customer',
          email: contact.email,
          phoneNo: contact.phone,
        },
        deposit,
        proposalDisplayId: displayId,
        issueDate: new Date().toISOString().slice(0, 10),
      })),
    });
  } catch {
    return secureJson({ error: 'could not reach the CRM to draft the invoice' }, { status: 502 });
  }
  if (!created.ok) {
    console.error('[operator/invoice] draft creation returned', created.status, await created.text().catch(() => ''));
    return secureJson({ error: 'the CRM rejected the invoice draft' }, { status: 502 });
  }
  const invoiceId = readInvoiceId(await created.json().catch(() => null));
  if (!invoiceId) return secureJson({ error: 'the CRM returned no invoice id' }, { status: 502 });

  // Supersede first: the unique index allows one live draft per opportunity, and
  // a payment must never match a price the operator has moved on from.
  if (existing) {
    const supersede = await supabaseRequest(`deposit_invoice_drafts?draft_id=eq.${encodeURIComponent(existing.draft_id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ superseded_at: new Date().toISOString() }),
    });
    if (!supersede.ok) return secureJson({ error: 'could not supersede the previous draft', invoice_id: invoiceId }, { status: 502 });
  }

  const insert = await supabaseRequest('deposit_invoice_drafts', {
    method: 'POST',
    body: JSON.stringify({
      contact_id: body.contact_id,
      proposal_id: body.proposal_id,
      ghl_invoice_id: invoiceId,
      deposit_amount: deposit,
      fence_spec: fenceSpec,
      created_by: operator.sub,
    }),
  });
  if (!insert.ok) {
    console.error('[operator/invoice] draft record insert failed', await insert.text().catch(() => ''));
    return secureJson({ error: 'the invoice was drafted but not recorded — void it in the CRM', invoice_id: invoiceId }, { status: 502 });
  }

  await notifyOwner(
    apiKey,
    process.env.GHL_TODD_CONTACT_ID ?? '',
    `Abrams Ops\nDraft deposit invoice ready to review and send.\n` +
    `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim() + '\n' +
    `Deposit: $${deposit.toLocaleString('en-US')}` +
    (displayId ? `\nProposal ${displayId}` : ''),
  );

  return secureJson({
    invoice_id: invoiceId,
    deposit_amount: deposit,
    reused: false,
    superseded_invoice_id: existing?.ghl_invoice_id ?? null,
  }, { status: 201 });
}

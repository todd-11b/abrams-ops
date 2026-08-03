import type { FenceSpec } from './proposal-source';

export const DEPOSIT_FRACTION = 0.5;

/** Whole dollars, so the drafted invoice matches the deposit the proposal quotes. */
export function depositAmount(spec: FenceSpec): number | null {
  const total = spec.proposal_total;
  if (typeof total !== 'number' || !Number.isFinite(total) || total <= 0) return null;
  return Math.round(total * DEPOSIT_FRACTION);
}

export interface InvoiceContact {
  id: string;
  name: string;
  email?: string;
  phoneNo?: string;
}

/**
 * A draft, never a sent invoice: HighLevel sends only in response to a separate
 * `POST /invoices/{id}/send`, which this application does not call. The amount
 * comes from the server-derived snapshot, so no request body can move it.
 */
export function draftInvoicePayload(params: {
  locationId: string;
  businessName: string;
  contact: InvoiceContact;
  deposit: number;
  proposalDisplayId: string | null;
  issueDate: string;
}) {
  const label = params.proposalDisplayId ? `Deposit — proposal ${params.proposalDisplayId}` : 'Deposit';
  return {
    altId: params.locationId,
    altType: 'location',
    name: label,
    currency: 'USD',
    businessDetails: { name: params.businessName },
    contactDetails: {
      id: params.contact.id,
      name: params.contact.name,
      ...(params.contact.email ? { email: params.contact.email } : {}),
      ...(params.contact.phoneNo ? { phoneNo: params.contact.phoneNo } : {}),
    },
    items: [{
      name: label,
      description: '50% deposit due to schedule installation',
      currency: 'USD',
      amount: params.deposit,
      qty: 1,
    }],
    discount: { type: 'percentage', value: 0 },
    issueDate: params.issueDate,
    liveMode: true,
  };
}

/** HighLevel returns the new invoice under a couple of shapes depending on version. */
export function readInvoiceId(payload: unknown): string | null {
  const body = payload as { _id?: unknown; id?: unknown; invoice?: { _id?: unknown; id?: unknown } } | null;
  const candidate = body?._id ?? body?.id ?? body?.invoice?._id ?? body?.invoice?.id;
  return typeof candidate === 'string' && candidate.length > 0 && candidate.length <= 100 ? candidate : null;
}

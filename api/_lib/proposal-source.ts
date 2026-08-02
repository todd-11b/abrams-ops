import { calcTotals, type ConsultFormData } from '../../src/components/consult/consultTypes';

export const GHL_BASE = 'https://services.leadconnectorhq.com';
const JSON_FIELD_ID = 'v74WeVuNKTrjnYGM6ICN';

interface GhlCustomField { id?: string; key?: string; value?: string }

export interface GhlContact {
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  address1?: string;
  customFields?: GhlCustomField[];
}

export interface FenceSpec {
  fence_lines: unknown[];
  gates: unknown[];
  addons: unknown[];
  total_sections: number;
  total_lf: number;
  proposal_total: number;
}

export async function fetchGhlContact(contactId: string, apiKey: string): Promise<{ status: number; contact: GhlContact | null }> {
  let response: Response;
  try {
    response = await fetch(`${GHL_BASE}/contacts/${encodeURIComponent(contactId)}`, {
      headers: { Authorization: `Bearer ${apiKey}`, Version: '2021-07-28' },
    });
  } catch { return { status: 0, contact: null }; }
  if (!response.ok) return { status: response.status, contact: null };
  const payload = await response.json().catch(() => null) as { contact?: GhlContact } | null;
  return { status: response.status, contact: payload?.contact ?? null };
}

/** The proposal the operator saved to the CRM is the only trusted copy of the quote. */
export function readStoredProposal(contact: GhlContact | null): ConsultFormData | null {
  const field = contact?.customFields?.find((f) => f.id === JSON_FIELD_ID || f.key === 'contact.job_line_items_json' || f.key === 'job_line_items_json');
  if (!field?.value) return null;
  try {
    const parsed = JSON.parse(field.value) as ConsultFormData;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch { return null; }
}

/**
 * Recomputes the fence specification and customer total from the stored
 * proposal. Nothing here is derived from a request body, so the signing
 * endpoint cannot be used to change a dollar amount.
 */
export function deriveFenceSpec(form: ConsultFormData | null): FenceSpec | null {
  if (!form || !Array.isArray(form.fenceLines)) return null;
  const addOns = form.addOns;
  try {
    const totals = calcTotals(form);
    return {
      fence_lines: form.fenceLines,
      gates: Array.isArray(form.gateInstances) ? form.gateInstances : [],
      addons: [
        ...(addOns?.demo?.enabled ? [{ type: 'demo', ...addOns.demo }] : []),
        ...(addOns?.stain?.enabled ? [{ type: 'stain', ...addOns.stain }] : []),
        ...(addOns?.poolLatch?.enabled ? [{ type: 'poolLatch', ...addOns.poolLatch }] : []),
      ],
      total_sections: totals.totalSections,
      total_lf: form.fenceLines.reduce((sum, line) => sum + (Number(line?.linearFeet) || 0), 0),
      proposal_total: totals.grandTotal,
    };
  } catch { return null; }
}

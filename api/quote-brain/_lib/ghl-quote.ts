import { GHL_BASE, fetchGhlContact, readStoredProposal, type GhlContact } from '../../_lib/proposal-source';
import type { ConsultFormData } from '../../../src/components/consult/consultTypes';
import { JSON_FIELD_ID } from './form';

const GHL_TIMEOUT_MS = 5000;

export async function loadContact(contactId: string, apiKey: string) {
  return fetchGhlContact(contactId, apiKey);
}

export function storedQuote(contact: GhlContact | null): ConsultFormData | null {
  return readStoredProposal(contact);
}

export async function writeStoredQuote(contactId: string, form: ConsultFormData, apiKey: string): Promise<{ ok: boolean; status: number }> {
  const value = JSON.stringify(form);
  // Same customFields shape ConsultApp.tsx already writes in production
  // (id v74WeVuNKTrjnYGM6ICN, key `value`, two key-name variants). Do not
  // switch to fieldValue unless the consult app changes in a separate PR.
  try {
    const response = await fetch(`${GHL_BASE}/contacts/${encodeURIComponent(contactId)}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Version: '2021-07-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        customFields: [
          { id: JSON_FIELD_ID, key: 'contact.job_line_items_json', value },
          { id: JSON_FIELD_ID, key: 'job_line_items_json', value },
        ],
      }),
      signal: AbortSignal.timeout(GHL_TIMEOUT_MS),
    });
    return { ok: response.ok, status: response.status };
  } catch (error) {
    const aborted = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    return { ok: false, status: aborted ? 504 : 0 };
  }
}

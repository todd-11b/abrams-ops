import { GHL_BASE, fetchGhlContact, readStoredProposal, type GhlContact } from '../../_lib/proposal-source';
import type { ConsultFormData } from '../../../src/components/consult/consultTypes';
import { JSON_FIELD_ID } from './form';

export async function loadContact(contactId: string, apiKey: string) {
  return fetchGhlContact(contactId, apiKey);
}

export function storedQuote(contact: GhlContact | null): ConsultFormData | null {
  return readStoredProposal(contact);
}

export async function writeStoredQuote(contactId: string, form: ConsultFormData, apiKey: string): Promise<{ ok: boolean; status: number }> {
  const value = JSON.stringify(form);
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
    });
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

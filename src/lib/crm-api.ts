import { operatorFetch } from '../utils/actor';

interface CreateContactInput { firstName: string; lastName: string; phone?: string; email?: string }
interface UpdateContactPayload { address1?: string; customFields?: Array<{ id?: string; key?: string; value: unknown }>; [key: string]: unknown }
interface CreateOpportunityInput { contactId: string; name: string; monetaryValue?: number }
type ProductionStage = 'job_created' | 'scheduled' | 'in_install' | 'job_complete';

async function action(name: string, payload: Record<string, unknown> = {}) {
  const res = await operatorFetch('/api/operator/ghl', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: name, ...payload }) });
  if (!res.ok) throw new Error(`CRM ${name} failed (${res.status})`);
  return res.json();
}

export const crmApi = {
  fetchContacts: () => action('fetchContacts'),
  searchContacts: (query: string) => action('searchContacts', { query }),
  getContact: (contactId: string) => action('getContact', { contactId }),
  createContact: (input: CreateContactInput) => action('createContact', { input }),
  updateContact: (contactId: string, payload: UpdateContactPayload) => action('updateContact', { contactId, payload }),
  addNote: (contactId: string, body: string) => action('addNote', { contactId, body }),
  addTags: (contactId: string, tags: string[]) => action('addTags', { contactId, tags }),
  updateOpportunityStatus: (opportunityId: string, status: string) => action('updateOpportunityStatus', { opportunityId, status }),
  createOpportunity: (input: CreateOpportunityInput) => action('createOpportunity', { ...input }),
  updateOpportunityValue: (opportunityId: string, monetaryValue: number) => action('updateOpportunityValue', { opportunityId, monetaryValue }),
  moveOpportunityToStage: (opportunityId: string, stage: ProductionStage) => action('moveOpportunityToStage', { opportunityId, stage }),
  async uploadPhoto(contactId: string, file: File) {
    const data = new FormData(); data.append('action', 'uploadPhoto'); data.append('contactId', contactId); data.append('file', file);
    const res = await operatorFetch('/api/operator/ghl', { method: 'POST', body: data });
    if (!res.ok) throw new Error(`CRM uploadPhoto failed (${res.status})`);
    return res.json();
  },
};

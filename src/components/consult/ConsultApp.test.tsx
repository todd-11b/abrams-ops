import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsultApp } from './ConsultApp';

const crmApi = vi.hoisted(() => ({
  fetchContacts: vi.fn<() => Promise<unknown>>(async () => ({ contacts: [] })),
  searchContacts: vi.fn<(query: string) => Promise<unknown>>(async () => ({ contacts: [] })),
  getContact: vi.fn(async () => ({ contact: { id: 'contact-1', customFields: [] } })),
  createContact: vi.fn(async () => ({ contact: { id: 'contact-1' } })),
  createOpportunity: vi.fn(async () => ({ opportunity: { id: 'opp-1' } })),
  updateContact: vi.fn(async () => ({})),
  updateOpportunityValue: vi.fn(async () => ({})),
  updateOpportunityStatus: vi.fn(async () => ({})),
  addTags: vi.fn(async () => ({})),
  addNote: vi.fn(async () => ({})),
  uploadPhoto: vi.fn(async () => ({})),
}));

vi.mock('../../lib/crm-api', () => ({ crmApi }));
vi.mock('./PropertySection', () => ({ PropertySection: () => null }));
vi.mock('./MeasurementsSection', () => ({ MeasurementsSection: () => null }));
vi.mock('./VisualLayoutSection', () => ({ VisualLayoutSection: () => null }));
vi.mock('./GatesSection', () => ({ GatesSection: () => null }));
vi.mock('./AddOnsSection', () => ({ AddOnsSection: () => null }));
vi.mock('./PurposeSection', () => ({ PurposeSection: () => null }));
vi.mock('./PhotosSection', () => ({ PhotosSection: () => null }));

describe('ConsultApp draft timestamps', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('creates timestamps only when the user saves a draft', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(300);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    render(<ConsultApp />);
    expect(localStorage.getItem('abrams_drafts')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /new \/ walk-in customer/i }));
    fireEvent.change(screen.getByPlaceholderText('First Last'), { target: { value: 'Test Customer' } });
    fireEvent.click(screen.getByRole('button', { name: /start consult/i }));
    fireEvent.click(screen.getByRole('button', { name: /save draft/i }));

    await waitFor(() => expect(crmApi.createContact).toHaveBeenCalledTimes(1));
    const persistedDraftTransitions = setItem.mock.calls
      .filter(([key]) => key === 'abrams_drafts')
      .map(([, value]) => JSON.parse(value));
    expect(persistedDraftTransitions).toEqual([
      expect.objectContaining({
        local_300: expect.objectContaining({ timestamp: 300 }),
      }),
      expect.objectContaining({
        'contact-1': expect.objectContaining({ timestamp: 300 }),
      }),
      expect.objectContaining({
        'contact-1': expect.objectContaining({
          timestamp: 300,
          form: expect.objectContaining({ opportunityId: 'opp-1' }),
        }),
      }),
    ]);
    const drafts = JSON.parse(localStorage.getItem('abrams_drafts') || '{}');
    expect(drafts['contact-1'].timestamp).toBe(300);

    fireEvent.click(screen.getByRole('button', { name: /save draft/i }));
    await waitFor(() => expect(crmApi.updateOpportunityValue).toHaveBeenCalledTimes(1));
    expect(crmApi.createOpportunity).toHaveBeenCalledTimes(1);
  });

  it('shows persisted drafts newest first', async () => {
    localStorage.setItem('abrams_drafts', JSON.stringify({
      older: { timestamp: 100, form: { contactId: 'older', contactName: 'Older Draft' } },
      newer: { timestamp: 200, form: { contactId: 'newer', contactName: 'Newer Draft' } },
    }));

    render(<ConsultApp />);

    const newer = await screen.findByText('Newer Draft');
    const older = screen.getByText('Older Draft');
    expect(newer.compareDocumentPosition(older) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps valid persisted drafts when a neighboring entry is malformed', async () => {
    localStorage.setItem('abrams_drafts', JSON.stringify({
      broken: 'not-a-draft',
      valid: { timestamp: 200, form: { contactId: 'valid', contactName: 'Valid Draft' } },
    }));

    render(<ConsultApp />);

    expect(await screen.findByText('Valid Draft')).toBeTruthy();
  });

  it('skips malformed contacts while preserving numeric CRM identifiers as text', async () => {
    crmApi.fetchContacts.mockResolvedValueOnce({
      contacts: [null, { id: 123, firstName: 'Ada', lastName: 'Lovelace', phone: 555 }],
    });

    render(<ConsultApp />);

    expect(await screen.findByText('Ada Lovelace')).toBeTruthy();
    expect(screen.getByText('555')).toBeTruthy();
  });

  it('creates the default form once rather than on every render', async () => {
    const randomUUID = vi.spyOn(crypto, 'randomUUID');
    const { rerender } = render(<ConsultApp />);
    const initialCalls = randomUUID.mock.calls.length;

    rerender(<ConsultApp />);

    expect(initialCalls).toBeGreaterThan(0);
    expect(randomUUID).toHaveBeenCalledTimes(initialCalls);
  });
});

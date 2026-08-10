import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConsultApp } from './ConsultApp';

const crmApi = vi.hoisted(() => ({
  fetchContacts: vi.fn(async () => ({ contacts: [] })),
  createContact: vi.fn(async () => ({ contact: { id: 'contact-1' } })),
  createOpportunity: vi.fn(async () => ({ opportunity: { id: 'opp-1' } })),
  updateContact: vi.fn(async () => ({})),
  updateOpportunityValue: vi.fn(async () => ({})),
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
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('creates timestamps only when the user saves a draft', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValueOnce(100).mockReturnValueOnce(200).mockReturnValue(300);
    render(<ConsultApp />);
    expect(now).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /new \/ walk-in customer/i }));
    fireEvent.change(screen.getByPlaceholderText('First Last'), { target: { value: 'Test Customer' } });
    fireEvent.click(screen.getByRole('button', { name: /start consult/i }));
    fireEvent.click(screen.getByRole('button', { name: /save draft/i }));

    await waitFor(() => expect(crmApi.createContact).toHaveBeenCalledTimes(1));
    const drafts = JSON.parse(localStorage.getItem('abrams_drafts') || '{}');
    expect(drafts['contact-1'].timestamp).toBe(300);
    expect(now).toHaveBeenCalledTimes(3);
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
});

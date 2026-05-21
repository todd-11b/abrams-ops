import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SignPayView } from './SignPayView';
import type { ConsultFormData } from './consultTypes';

// Mock react-signature-canvas so we can control isEmpty() per test.
// We use forwardRef so the component's useRef is properly wired to our mock instance.
// Module-level flag lets individual tests flip the isEmpty result.
let mockIsEmpty = true;

vi.mock('react-signature-canvas', () => {
  const MockSigCanvas = React.forwardRef((_props: unknown, ref: React.Ref<unknown>) => {
    // Attach mock methods to the forwarded ref on mount
    React.useImperativeHandle(ref, () => ({
      isEmpty: () => mockIsEmpty,
      clear: vi.fn(),
    }));
    return <canvas data-testid="sig-canvas" />;
  });
  MockSigCanvas.displayName = 'SignatureCanvas';
  return { default: MockSigCanvas };
});

const baseForm = {
  contactId: 'contact-1',
  contactName: 'Test Customer',
  contactPhone: '5551234567',
  contactEmail: 'test@example.com',
  pipelineStage: '',
  opportunityId: 'opp-1',
  propertyAddress: '',
  hoaApproval: '',
  sprinklers: '',
  lotNotes: '',
  yardSensitivity: '',
  cleanSiteRisks: '',
  petConsiderations: '',
  fenceType: '',
  fenceLines: [],
  gates: { walk: { qty: 0, price: 0 }, double: { qty: 0, price: 0 } },
  gateInstances: [],
  obstructions: [],
  addOns: {
    demo: { enabled: false, lf: 0, pricePerLf: 0 },
    stain: { enabled: false, sf: 0, pricePerSf: 0 },
    poolLatch: { enabled: false, qty: 0, priceEach: 0 },
  },
  purposes: [],
  timeline: '',
  photos: [],
} as unknown as ConsultFormData;

describe('SignPayView (signature-only)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockIsEmpty = true; // default: no signature drawn
  });

  it('renders without any Stripe CardElement (no iframe)', () => {
    render(<SignPayView form={baseForm} onBack={() => {}} proposalId="P-1" />);
    expect(document.querySelectorAll('iframe').length).toBe(0);
    expect(screen.queryByText(/card number/i)).toBeNull();
  });

  it('shows the "Sign Proposal" CTA, not "Sign & Pay Deposit"', () => {
    render(<SignPayView form={baseForm} onBack={() => {}} proposalId="P-1" />);
    expect(screen.getByRole('button', { name: /sign proposal/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /sign & pay/i })).toBeNull();
  });

  it('POSTs to /api/proposal/create-job on sign and shows the new success copy', async () => {
    // Simulate a drawn signature
    mockIsEmpty = false;

    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.endsWith('/api/proposal/create-job')) {
        return new Response(JSON.stringify({ job_id: 'j1', job_number: 'AF-2026-0007' }), { status: 201 });
      }
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<SignPayView form={baseForm} onBack={() => {}} proposalId="P-1" />);

    fireEvent.click(screen.getByRole('button', { name: /sign proposal/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/proposal/create-job',
        expect.objectContaining({ method: 'POST' })
      );
    });

    await waitFor(() => {
      expect(screen.getByText(/proposal signed/i)).toBeTruthy();
    });
    expect(screen.getByText(/invoice/i)).toBeTruthy();
  });

  it('blocks submission when signature pad is empty', () => {
    // mockIsEmpty is true (default)
    render(<SignPayView form={baseForm} onBack={() => {}} proposalId="P-1" />);
    fireEvent.click(screen.getByRole('button', { name: /sign proposal/i }));
    expect(screen.getByText(/provide a signature/i)).toBeTruthy();
  });
});

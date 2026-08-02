import { describe, expect, it } from 'vitest';
import { deriveFenceSpec, readStoredProposal, specMatches, type FenceSpec } from './proposal-source';
import type { ConsultFormData } from '../../src/components/consult/consultTypes';

const storedProposal = {
  fenceLines: [{ id: 'l1', label: 'Main Run', style: 'wood_pine_6', linearFeet: 100, pricePerSection: 300 }],
  gates: { walk: { qty: 1, price: 450 }, double: { qty: 0, price: 0 } },
  gateInstances: [{ id: 'g1', type: 'walk' }],
  addOns: {
    demo: { enabled: true, lf: 100, pricePerLf: 5 },
    stain: { enabled: false, sf: 0, pricePerSf: 0 },
    poolLatch: { enabled: false, qty: 0, priceEach: 0 },
  },
} as unknown as ConsultFormData;

const contact = {
  customFields: [{ id: 'v74WeVuNKTrjnYGM6ICN', value: JSON.stringify({ ...storedProposal, proposalTotalFromBrowser: 12 }) }],
};

describe('trusted proposal snapshot', () => {
  it('recomputes the customer total from the saved proposal rather than reading one', () => {
    const spec = deriveFenceSpec(readStoredProposal(contact));
    expect(spec).not.toBeNull();
    expect(spec?.total_lf).toBe(100);
    // 13 sections at 300, plus a 450 walk gate and 500 of demo.
    expect(spec?.proposal_total).toBe(4850);
    expect(spec?.total_sections).toBe(13);
  });

  it('treats a re-priced quote as no longer matching a frozen token snapshot', () => {
    const frozen = deriveFenceSpec(readStoredProposal(contact));
    const reprice = { ...storedProposal, fenceLines: [{ ...storedProposal.fenceLines[0], linearFeet: 300 }] } as ConsultFormData;
    expect(specMatches(frozen, deriveFenceSpec(storedProposal))).toBe(true);
    expect(specMatches(frozen, deriveFenceSpec(reprice))).toBe(false);
    expect(specMatches(frozen, null)).toBe(false);
  });

  it('still matches a snapshot whose keys came back reordered from jsonb', () => {
    const reorder = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(reorder);
      if (value && typeof value === 'object') {
        return Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .reverse()
            .map(([k, v]) => [k, reorder(v)]),
        );
      }
      return value;
    };
    const frozen = deriveFenceSpec(storedProposal);
    const roundTripped = reorder(frozen) as FenceSpec;
    expect(JSON.stringify(roundTripped)).not.toBe(JSON.stringify(frozen));
    expect(specMatches(frozen, roundTripped)).toBe(true);
  });

  it('returns null when the contact has no saved proposal to trust', () => {
    expect(readStoredProposal({ customFields: [] })).toBeNull();
    expect(readStoredProposal(null)).toBeNull();
    expect(deriveFenceSpec(null)).toBeNull();
    expect(readStoredProposal({ customFields: [{ id: 'v74WeVuNKTrjnYGM6ICN', value: 'not json' }] })).toBeNull();
  });
});

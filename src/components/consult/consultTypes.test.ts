import { describe, expect, it } from 'vitest';
import type { ConsultFormData, GateItem } from './consultTypes';
import { calcMaterialsCost, calcTotals, normalizeGateQuantity } from './consultTypes';

const addOns = {
  demo: { enabled: false, lf: 0, pricePerLf: 0 },
  stain: { enabled: false, sf: 0, pricePerSf: 0 },
  poolLatch: { enabled: false, qty: 0, priceEach: 0 },
};

describe('gate quantity contract', () => {
  it.each([
    [-2, 0],
    [1.9, 1],
    [Number.NaN, 0],
    [Number.POSITIVE_INFINITY, 0],
    [3, 3],
  ])('normalizes %s to %s', (input, expected) => {
    expect(normalizeGateQuantity(input)).toBe(expected);
  });

  it.each([
    ['negative', -2, 0],
    ['fractional', 1.9, 425],
    ['NaN', Number.NaN, 0],
    ['infinite', Number.POSITIVE_INFINITY, 0],
    ['valid integer', 2, 850],
  ])('keeps %s restored quantity out of totals until normalized', (_label, qty, expected) => {
    const gates: GateItem = {
      walk: { qty, price: 425 },
      double: { qty: 0, price: 850 },
    };
    const form = { fenceLines: [], gates, addOns } as unknown as ConsultFormData;

    expect(calcTotals(form).gateTotal).toBe(expected);
    expect(calcMaterialsCost([], gates, addOns)).toBe(expected);
  });
});

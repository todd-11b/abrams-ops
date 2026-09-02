import { describe, expect, it } from 'vitest';
import { buildQuoteForm, normalizeStyleQuery, quotePayload, resolveStyle } from './_lib/form';

describe('quote-brain form', () => {
  it('resolves cedar aliases to wood_cedar_6', () => {
    expect(resolveStyle('cedar')?.key).toBe('wood_cedar_6');
    expect(resolveStyle("6' cedar")?.key).toBe('wood_cedar_6');
    expect(resolveStyle('wood_cedar_6')?.key).toBe('wood_cedar_6');
    expect(normalizeStyleQuery('6 foot cedar')).toBe('6 ft cedar');
    expect(resolveStyle('6 foot cedar')?.key).toBe('wood_cedar_6');
    expect(resolveStyle('6ft cedar')?.key).toBe('wood_cedar_6');
  });

  it('prices 180 feet of 6-foot cedar with two walk gates', () => {
    const built = buildQuoteForm({ style: 'cedar', linearFeet: 180, walkGates: 2 });
    if ('error' in built) throw new Error(built.error);
    const payload = quotePayload(built.form, built.resolved);
    expect(payload.totals.sections).toBe(23);
    expect(payload.totals.fenceTotal).toBe(23 * 296);
    expect(payload.totals.gateTotal).toBe(850);
    expect(payload.totals.grandTotal).toBe(7658);
    expect(payload.totals.deposit).toBe(3829);
    expect(payload.spoken).toContain('$7,658 total');
    expect(payload.spoken).toContain('$3,829 deposit');
  });

  it('rejects unknown styles and missing footage', () => {
    expect(buildQuoteForm({ style: 'wrought iron', linearFeet: 40 })).toEqual({ error: 'unknown fence style' });
    expect(buildQuoteForm({ style: 'cedar' })).toEqual({ error: 'linearFeet must be greater than 0' });
  });
});

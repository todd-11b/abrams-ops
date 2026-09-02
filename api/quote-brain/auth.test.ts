import { describe, expect, it } from 'vitest';
import { authorizeQuoteBrain } from './_lib/auth';

describe('quote-brain auth', () => {
  it('rejects missing or short secrets', () => {
    const previous = process.env.QUOTE_BRAIN_SECRET;
    delete process.env.QUOTE_BRAIN_SECRET;
    expect(authorizeQuoteBrain(new Request('https://example.test', { headers: { Authorization: 'Bearer abcdefghijklmnop' } }))).toBe(false);
    process.env.QUOTE_BRAIN_SECRET = 'short';
    expect(authorizeQuoteBrain(new Request('https://example.test', { headers: { Authorization: 'Bearer short' } }))).toBe(false);
    process.env.QUOTE_BRAIN_SECRET = 'sixteen-char-key';
    expect(authorizeQuoteBrain(new Request('https://example.test'))).toBe(false);
    expect(authorizeQuoteBrain(new Request('https://example.test', { headers: { Authorization: 'Bearer sixteen-char-key' } }))).toBe(true);
    process.env.QUOTE_BRAIN_SECRET = previous;
  });
});

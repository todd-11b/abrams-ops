import { describe, expect, it } from 'vitest';
import { decryptGhlUserContext, parseGhlSsoConfig, resolveOperatorFromGhlUser } from './ghl-sso';

const SECRET = 'shared-secret-value';
const LOCATION = '5W6GR1I8ongw4p16jiRf';

// Produced by `openssl enc -aes-256-cbc -md md5 -pass pass:shared-secret-value -base64 -A`,
// which is the format CryptoJS.AES.encrypt (and therefore HighLevel) emits.
const TY_PAYLOAD = 'U2FsdGVkX19xJGNnzis+rFMSSHOgW940CJLtvvh6RPmZEuVEAtcNmdoSM8uNUmQhzEfiUuoOw2OJ30UaNKkaNXZlmj/Qw1iS2zeZkdZ7uS4trWdsvGlbf8kNBhXCyoDkaKbKcPJ0mcYDEJNh0WWi/rj2gvCdyuVsIzzFUWNqUCXqjIjjE4/n0LWzKESMmBaDqfTVFtHvEgi+Gt54RHQjdlzoMGNHZCuusb9kuzvcmmkEEhiAZ2Dx6lSSG2PBnKeWcHuBEG8i7y7LpFD58/wM5A==';
const FOREIGN_LOCATION_PAYLOAD = 'U2FsdGVkX1+AHWd80hIfKdeLomDuqIOH7B81cxplbZ63qoKGG1UTxC+eUSHHnsn/0hJb1hcL3Qg6vFkFGVFom4hqPI4R6aCRlraaoKWQAyc=';

const config = { sharedSecret: SECRET, location: LOCATION, todd: 'toddUser', ty: 'MKQJ7wOVVmNOMvrnKKKK' };

describe('decryptGhlUserContext', () => {
  it('reads the user context HighLevel encrypted with the shared secret', async () => {
    const context = await decryptGhlUserContext(TY_PAYLOAD, SECRET);
    expect(context).toMatchObject({
      userId: 'MKQJ7wOVVmNOMvrnKKKK',
      activeLocation: LOCATION,
      type: 'location',
      email: 'ty@example.com',
    });
  });

  it('returns null when the shared secret does not match', async () => {
    expect(await decryptGhlUserContext(TY_PAYLOAD, 'wrong-secret')).toBeNull();
  });

  it.each([
    ['a non-string payload', 42],
    ['an empty payload', ''],
    ['payload that is not base64', '!!!not base64!!!'],
    ['base64 without the OpenSSL salt header', btoa('no salt header here at all')],
  ])('returns null for %s', async (_label, payload) => {
    expect(await decryptGhlUserContext(payload, SECRET)).toBeNull();
  });
});

describe('resolveOperatorFromGhlUser', () => {
  it('maps a configured HighLevel user to their operator', async () => {
    const context = await decryptGhlUserContext(TY_PAYLOAD, SECRET);
    expect(resolveOperatorFromGhlUser(context, config)).toBe('ty');
  });

  it('refuses a user from another location in the same agency', async () => {
    const context = await decryptGhlUserContext(FOREIGN_LOCATION_PAYLOAD, SECRET);
    expect(context?.userId).toBe('other');
    expect(resolveOperatorFromGhlUser(context, config)).toBeNull();
  });

  it('refuses an unmapped user inside the right location', () => {
    const context = { userId: 'stranger', companyId: 'c', role: 'admin', type: 'location' as const, activeLocation: LOCATION };
    expect(resolveOperatorFromGhlUser(context, config)).toBeNull();
  });

  it('refuses an agency-context session that carries no active location', () => {
    const context = { userId: 'toddUser', companyId: 'c', role: 'admin', type: 'agency' as const };
    expect(resolveOperatorFromGhlUser(context, config)).toBeNull();
  });

  it('refuses a failed decryption', () => {
    expect(resolveOperatorFromGhlUser(null, config)).toBeNull();
  });
});

describe('parseGhlSsoConfig', () => {
  const valid = {
    GHL_APP_SHARED_SECRET: SECRET,
    GHL_LOCATION_ID: LOCATION,
    GHL_SSO_TODD_USER_ID: 'toddUser',
    GHL_SSO_TY_USER_ID: 'tyUser',
  } as unknown as NodeJS.ProcessEnv;

  it('accepts a complete configuration', () => {
    expect(parseGhlSsoConfig(valid)).toEqual({ sharedSecret: SECRET, location: LOCATION, todd: 'toddUser', ty: 'tyUser' });
  });

  it('accepts one mapped user so SSO can be rolled out to one person first', () => {
    expect(parseGhlSsoConfig({ ...valid, GHL_SSO_TY_USER_ID: '' }).ty).toBe('');
  });

  it.each([
    ['the shared secret is missing', { GHL_APP_SHARED_SECRET: '' }],
    ['the location is missing', { GHL_LOCATION_ID: '' }],
    ['no user is mapped', { GHL_SSO_TODD_USER_ID: '', GHL_SSO_TY_USER_ID: '' }],
    ['both operators map to one HighLevel user', { GHL_SSO_TY_USER_ID: 'toddUser' }],
  ])('throws when %s', (_label, override) => {
    expect(() => parseGhlSsoConfig({ ...valid, ...override } as NodeJS.ProcessEnv)).toThrow();
  });
});

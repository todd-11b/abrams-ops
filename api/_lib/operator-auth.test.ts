import { beforeEach, describe, expect, it } from 'vitest';
import { canOperator, issueOperatorToken, verifyOperatorToken } from './operator-auth';

describe('operator bearer tokens', () => {
  beforeEach(() => {
    process.env.OPERATOR_SESSION_SECRET = 'test-secret-that-is-at-least-32-bytes-long';
    process.env.GHL_LOCATION_ID = 'location-1';
    process.env.OPERATOR_SESSION_VERSION = '1';
  });

  it('accepts a valid direct/mobile or iframe bearer flow', async () => {
    const { token } = await issueOperatorToken('ty', 'pin', 1000);
    expect(await verifyOperatorToken(token, 1001)).toMatchObject({ sub: 'ty', provider: 'pin', location: 'location-1' });
  });

  it('rejects expired, tampered, wrong-location, and revoked-version tokens', async () => {
    const { token } = await issueOperatorToken('todd', 'pin', 1000);
    expect(await verifyOperatorToken(token, 1000 + 8 * 60 * 60)).toBeNull();
    expect(await verifyOperatorToken(`${token.slice(0, -1)}x`, 1001)).toBeNull();
    process.env.GHL_LOCATION_ID = 'location-2';
    expect(await verifyOperatorToken(token, 1001)).toBeNull();
    process.env.GHL_LOCATION_ID = 'location-1'; process.env.OPERATOR_SESSION_VERSION = '2';
    expect(await verifyOperatorToken(token, 1001)).toBeNull();
  });
  it('enforces owner-only broad CRM reads and outbound messaging', async () => {
    const owner = (await issueOperatorToken('todd', 'pin', 1000)).claims;
    const field = (await issueOperatorToken('ty', 'pin', 1000)).claims;
    expect(canOperator(owner, 'ghl:send-message')).toBe(true);
    expect(canOperator(field, 'ghl:send-message')).toBe(false);
    expect(canOperator(field, 'operator:data')).toBe(true);
  });
  it('treats an unset or malformed session version as version 1', async () => {
    delete process.env.OPERATOR_SESSION_VERSION;
    const { token } = await issueOperatorToken('todd', 'pin', 1000);
    process.env.OPERATOR_SESSION_VERSION = '';
    expect(await verifyOperatorToken(token, 1001)).toMatchObject({ sub: 'todd' });
    process.env.OPERATOR_SESSION_VERSION = '   ';
    expect(await verifyOperatorToken(token, 1001)).toMatchObject({ sub: 'todd' });
    process.env.OPERATOR_SESSION_VERSION = 'not-a-number';
    expect(await verifyOperatorToken(token, 1001)).toMatchObject({ sub: 'todd' });
  });

  it('requires session-version or signing-secret rotation to revoke sessions after a PIN-only rotation', async () => {
    const { token } = await issueOperatorToken('todd', 'pin', 1000);
    process.env.OPERATOR_TODD_PIN = '9753'; process.env.OPERATOR_TY_PIN = '8642';
    expect(await verifyOperatorToken(token, 1001)).toMatchObject({ sub: 'todd' });
    process.env.OPERATOR_SESSION_VERSION = '2';
    expect(await verifyOperatorToken(token, 1001)).toBeNull();
    process.env.OPERATOR_SESSION_VERSION = '1';
    process.env.OPERATOR_SESSION_SECRET = 'different-test-secret-at-least-32-bytes';
    expect(await verifyOperatorToken(token, 1001)).toBeNull();
  });
});

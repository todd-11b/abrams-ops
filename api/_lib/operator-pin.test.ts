import { describe, expect, it } from 'vitest';
import { parseOperatorPinConfig, resolveOperatorFromPin } from './operator-pin';

const valid = { OPERATOR_TODD_PIN: '1357', OPERATOR_TY_PIN: '2468' };

describe('operator PIN configuration', () => {
  it.each([
    [{ OPERATOR_TODD_PIN: '', OPERATOR_TY_PIN: '2468' }, 'missing owner'],
    [{ OPERATOR_TODD_PIN: '1357', OPERATOR_TY_PIN: '' }, 'missing field'],
    [{ OPERATOR_TODD_PIN: '13a7', OPERATOR_TY_PIN: '2468' }, 'non-digit'],
    [{ OPERATOR_TODD_PIN: '135', OPERATOR_TY_PIN: '2468' }, 'short'],
    [{ OPERATOR_TODD_PIN: '13570', OPERATOR_TY_PIN: '2468' }, 'long'],
    [{ OPERATOR_TODD_PIN: '1357', OPERATOR_TY_PIN: '1357' }, 'identical'],
  ])('rejects invalid configuration: %s (%s)', (env) => {
    expect(() => parseOperatorPinConfig(env)).toThrow('operator PIN configuration is invalid');
  });

  it('maps each distinct configured PIN to exactly one identity', () => {
    const config = parseOperatorPinConfig(valid);
    expect(resolveOperatorFromPin(valid.OPERATOR_TODD_PIN, config)).toBe('todd');
    expect(resolveOperatorFromPin(valid.OPERATOR_TY_PIN, config)).toBe('ty');
    expect(new Set([resolveOperatorFromPin(valid.OPERATOR_TODD_PIN, config), resolveOperatorFromPin(valid.OPERATOR_TY_PIN, config)]).size).toBe(2);
  });

  it('rejects an invalid submitted PIN without resolving an identity', () => {
    const config = parseOperatorPinConfig(valid);
    expect(resolveOperatorFromPin('0000', config)).toBeNull();
    expect(resolveOperatorFromPin('13570', config)).toBeNull();
  });
});

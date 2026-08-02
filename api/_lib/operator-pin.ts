import type { OperatorClaims } from './operator-auth';

export interface OperatorPinConfig {
  todd: string;
  ty: string;
}

const PIN_PATTERN = /^[0-9]{4}$/;

export function parseOperatorPinConfig(env: NodeJS.ProcessEnv = process.env): OperatorPinConfig {
  const todd = env.OPERATOR_TODD_PIN ?? '';
  const ty = env.OPERATOR_TY_PIN ?? '';
  if (!PIN_PATTERN.test(todd) || !PIN_PATTERN.test(ty) || todd === ty) {
    throw new Error('operator PIN configuration is invalid');
  }
  return { todd, ty };
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

export function resolveOperatorFromPin(
  presented: unknown,
  config: OperatorPinConfig,
): OperatorClaims['sub'] | null {
  if (typeof presented !== 'string' || !PIN_PATTERN.test(presented)) return null;
  if (constantTimeEqual(presented, config.todd)) return 'todd';
  if (constantTimeEqual(presented, config.ty)) return 'ty';
  return null;
}

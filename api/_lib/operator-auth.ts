const encoder = new TextEncoder();
const AUDIENCE = 'abrams-ops-operator';

export interface OperatorClaims {
  sub: 'todd' | 'ty';
  role: 'owner' | 'field';
  provider: 'pin' | 'ghl';
  location: string;
  aud: typeof AUDIENCE;
  iat: number;
  exp: number;
  jti: string;
  version: number;
}

export type OperatorPermission =
  | 'operator:data'
  | 'operator:photos'
  | 'operator:proposals'
  | 'operator:invoices'
  | 'ghl:standard'
  | 'ghl:broad-read'
  | 'ghl:send-message';

const ROLE_PERMISSIONS: Record<OperatorClaims['role'], ReadonlySet<OperatorPermission>> = {
  owner: new Set(['operator:data', 'operator:photos', 'operator:proposals', 'operator:invoices', 'ghl:standard', 'ghl:broad-read', 'ghl:send-message']),
  field: new Set(['operator:data', 'operator:photos', 'operator:proposals', 'ghl:standard', 'ghl:broad-read']),
};

export function canOperator(claims: OperatorClaims, permission: OperatorPermission): boolean {
  return ROLE_PERMISSIONS[claims.role].has(permission);
}

/** Defaults to 1 for an unset, empty or non-numeric value, per the documented contract. */
export function operatorSessionVersion(): number {
  const configured = Number(process.env.OPERATOR_SESSION_VERSION?.trim() || '1');
  return Number.isFinite(configured) ? configured : 1;
}

function b64url(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? encoder.encode(input) : input;
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decode(part: string): string {
  const padded = part.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - part.length % 4) % 4);
  return atob(padded);
}

async function signature(secret: string, input: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(input))));
}

export async function issueOperatorToken(
  actor: OperatorClaims['sub'],
  provider: OperatorClaims['provider'] = 'pin',
  now = Math.floor(Date.now() / 1000),
): Promise<{ token: string; claims: OperatorClaims }> {
  const secret = process.env.OPERATOR_SESSION_SECRET ?? '';
  const location = process.env.GHL_LOCATION_ID ?? '';
  if (secret.length < 32 || !location) throw new Error('operator auth is not configured');
  const claims: OperatorClaims = {
    sub: actor,
    role: actor === 'todd' ? 'owner' : 'field',
    provider,
    location,
    aud: AUDIENCE,
    iat: now,
    exp: now + 8 * 60 * 60,
    jti: crypto.randomUUID(),
    version: operatorSessionVersion(),
  };
  const encoded = `${b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claims))}`;
  return { token: `${encoded}.${await signature(secret, encoded)}`, claims };
}

export async function verifyOperatorToken(token: string, now = Math.floor(Date.now() / 1000)): Promise<OperatorClaims | null> {
  const secret = process.env.OPERATOR_SESSION_SECRET ?? '';
  const location = process.env.GHL_LOCATION_ID ?? '';
  if (secret.length < 32 || !location) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const encoded = `${parts[0]}.${parts[1]}`;
  const expected = await signature(secret, encoded);
  if (expected.length !== parts[2].length) return null;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i += 1) mismatch |= expected.charCodeAt(i) ^ parts[2].charCodeAt(i);
  if (mismatch !== 0) return null;
  try {
    const claims = JSON.parse(decode(parts[1])) as OperatorClaims;
    if (claims.aud !== AUDIENCE || claims.location !== location || claims.exp <= now || claims.iat > now + 60) return null;
    if (claims.version !== operatorSessionVersion()) return null;
    if (!['todd', 'ty'].includes(claims.sub) || !['pin', 'ghl'].includes(claims.provider)) return null;
    return claims;
  } catch {
    return null;
  }
}

export async function requireOperator(req: Request): Promise<OperatorClaims | null> {
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') ?? '');
  return match ? verifyOperatorToken(match[1]) : null;
}

export function secureJson(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(init.headers ?? {}) },
  });
}

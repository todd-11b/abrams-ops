import { sha256, supabaseRequest } from './server-data';

const ADDRESS = /^[0-9a-f:.]{3,64}$/i;

// Vercel sets x-vercel-forwarded-for on Node functions; the Edge runtime is
// only guaranteed to carry x-real-ip. Both are written by the platform, unlike
// x-forwarded-for, which a proxy in front of Vercel can supply.
export function clientAddress(req: Request): string {
  const candidates = [
    req.headers.get('x-vercel-forwarded-for'),
    req.headers.get('x-real-ip'),
  ];
  for (const candidate of candidates) {
    const address = candidate?.trim() ?? '';
    if (address && ADDRESS.test(address)) return address;
  }
  return '';
}

export async function consumeLoginAttempt(req: Request, credentialsValid: boolean): Promise<boolean> {
  const address = clientAddress(req);
  const pepper = process.env.OPERATOR_RATE_LIMIT_PEPPER ?? '';
  if (!address || pepper.length < 32) return false;
  const keyHash = await sha256(`${pepper}\n${address}`);
  const result = await supabaseRequest('rpc/consume_operator_login_attempt', {
    method: 'POST',
    body: JSON.stringify({ p_key_hash: keyHash, p_credentials_valid: credentialsValid }),
  });
  if (!result.ok) return false;
  const value = await result.json();
  return value === true || (Array.isArray(value) && value[0] === true);
}

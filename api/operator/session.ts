import { issueOperatorToken, requireOperator, secureJson } from '../_lib/operator-auth';
import { consumeLoginAttempt } from '../_lib/login-rate-limit';

export const config = { runtime: 'edge' };

export default async function handler(req: Request) {
  if (req.method === 'GET') {
    const claims = await requireOperator(req);
    return claims ? secureJson({ actor: claims.sub, role: claims.role, provider: claims.provider, expires_at: claims.exp }) : secureJson({ error: 'unauthorized' }, { status: 401 });
  }
  if (req.method !== 'POST') return secureJson({ error: 'method not allowed' }, { status: 405 });
  let body: { pin?: string };
  try { body = await req.json(); } catch { return secureJson({ error: 'invalid JSON' }, { status: 400 }); }
  const pinMap: Array<[string | undefined, 'todd' | 'ty']> = [
    [process.env.OPERATOR_TODD_PIN, 'todd'],
    [process.env.OPERATOR_TY_PIN, 'ty'],
  ];
  const presented = typeof body.pin === 'string' ? body.pin : '';
  let actor: 'todd' | 'ty' | undefined;
  for (const [pin, candidate] of pinMap) {
    if (!pin || pin.length !== presented.length) continue;
    let mismatch = 0;
    for (let index = 0; index < pin.length; index += 1) mismatch |= pin.charCodeAt(index) ^ presented.charCodeAt(index);
    if (mismatch === 0) actor = candidate;
  }
  if (!await consumeLoginAttempt(req, Boolean(actor))) {
    return secureJson({ error: 'invalid credentials' }, { status: 401, headers: { 'Retry-After': '900' } });
  }
  if (!actor) return secureJson({ error: 'invalid credentials' }, { status: 401 });
  try {
    const { token, claims } = await issueOperatorToken(actor);
    return secureJson({ token, actor, role: claims.role, provider: claims.provider, expires_at: claims.exp });
  } catch {
    return secureJson({ error: 'operator auth is not configured' }, { status: 500 });
  }
}

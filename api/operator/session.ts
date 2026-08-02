import { issueOperatorToken, requireOperator, secureJson } from '../_lib/operator-auth';
import { consumeLoginAttempt } from '../_lib/login-rate-limit';
import { parseOperatorPinConfig, resolveOperatorFromPin } from '../_lib/operator-pin';

export const config = { runtime: 'edge' };

export default async function handler(req: Request) {
  if (req.method === 'GET') {
    const claims = await requireOperator(req);
    return claims ? secureJson({ actor: claims.sub, role: claims.role, provider: claims.provider, expires_at: claims.exp }) : secureJson({ error: 'unauthorized' }, { status: 401 });
  }
  if (req.method !== 'POST') return secureJson({ error: 'method not allowed' }, { status: 405 });
  let body: { pin?: string };
  try { body = await req.json(); } catch { return secureJson({ error: 'invalid JSON' }, { status: 400 }); }
  let pinConfig;
  try { pinConfig = parseOperatorPinConfig(); }
  catch { return secureJson({ error: 'operator auth is not configured' }, { status: 500 }); }
  const actor = resolveOperatorFromPin(body.pin, pinConfig);
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

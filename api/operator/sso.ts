import { issueOperatorToken, secureJson } from '../_lib/operator-auth';
import { consumeLoginAttempt } from '../_lib/login-rate-limit';
import { decryptGhlUserContext, parseGhlSsoConfig, resolveOperatorFromGhlUser } from '../_lib/ghl-sso';

export const config = { runtime: 'edge' };

/**
 * Signs in an operator from the encrypted user context HighLevel gives an
 * embedded app, so the dashboard needs no PIN. The PIN route stays the way in
 * from a phone, where the app runs outside HighLevel.
 */
export default async function handler(req: Request) {
  if (req.method !== 'POST') return secureJson({ error: 'method not allowed' }, { status: 405 });
  let body: { encryptedData?: unknown };
  try { body = await req.json(); } catch { return secureJson({ error: 'invalid JSON' }, { status: 400 }); }

  let ssoConfig;
  try { ssoConfig = parseGhlSsoConfig(); }
  catch { return secureJson({ error: 'HighLevel SSO is not configured' }, { status: 500 }); }

  const context = await decryptGhlUserContext(body.encryptedData, ssoConfig.sharedSecret);
  const actor = resolveOperatorFromGhlUser(context, ssoConfig);
  if (!await consumeLoginAttempt(req, Boolean(actor))) {
    return secureJson({ error: 'invalid credentials' }, { status: 401, headers: { 'Retry-After': '900' } });
  }
  if (!actor) return secureJson({ error: 'invalid credentials' }, { status: 401 });

  try {
    const { token, claims } = await issueOperatorToken(actor, 'ghl');
    return secureJson({ token, actor, role: claims.role, provider: claims.provider, expires_at: claims.exp });
  } catch {
    return secureJson({ error: 'operator auth is not configured' }, { status: 500 });
  }
}

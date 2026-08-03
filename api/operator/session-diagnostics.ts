// TEMPORARY: deployed to diagnose the production login failure. Returns
// booleans only - never a secret, a header value, or a client address - and is
// removed once the cutover is proven.
import { secureJson } from '../_lib/operator-auth';
import { clientAddress } from '../_lib/login-rate-limit';
import { parseOperatorPinConfig } from '../_lib/operator-pin';
import { supabaseRequest } from '../_lib/server-data';

export const config = { runtime: 'edge' };

export default async function handler(req: Request) {
  const headers = ['x-vercel-forwarded-for', 'x-real-ip', 'x-forwarded-for'];
  let pins = false;
  try { parseOperatorPinConfig(); pins = true; } catch { pins = false; }
  let supabaseOk = false;
  try {
    const res = await supabaseRequest('operator_login_limits?select=key_hash&limit=1');
    supabaseOk = res.ok;
  } catch { supabaseOk = false; }
  return secureJson({
    headers_present: Object.fromEntries(headers.map((h) => [h, req.headers.get(h) !== null])),
    client_address_resolved: clientAddress(req) !== '',
    pepper_at_least_32_chars: (process.env.OPERATOR_RATE_LIMIT_PEPPER ?? '').length >= 32,
    session_secret_configured: (process.env.OPERATOR_SESSION_SECRET ?? '').length > 0,
    pin_config_valid: pins,
    supabase_service_read_ok: supabaseOk,
  });
}

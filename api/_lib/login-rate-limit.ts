import { sha256, supabaseRequest } from './server-data';

export async function consumeLoginAttempt(req: Request, credentialsValid: boolean): Promise<boolean> {
  const clientAddress = req.headers.get('x-vercel-forwarded-for')?.trim() ?? '';
  const pepper = process.env.OPERATOR_RATE_LIMIT_PEPPER ?? '';
  if (!clientAddress || clientAddress.includes(',') || !/^[0-9a-f:.]{3,64}$/i.test(clientAddress) || pepper.length < 32) return false;
  const keyHash = await sha256(`${pepper}\n${clientAddress}`);
  const result = await supabaseRequest('rpc/consume_operator_login_attempt', {
    method: 'POST',
    body: JSON.stringify({ p_key_hash: keyHash, p_credentials_valid: credentialsValid }),
  });
  if (!result.ok) return false;
  const value = await result.json();
  return value === true || (Array.isArray(value) && value[0] === true);
}

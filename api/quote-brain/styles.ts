import { authorizeQuoteBrain, json, unauthorized } from './_lib/auth';
import { listStyles } from './_lib/form';

export const config = { runtime: 'edge' };

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (!authorizeQuoteBrain(req)) return unauthorized();
  if (req.method !== 'GET' && req.method !== 'POST') return json({ error: 'method not allowed' }, { status: 405 });
  return json({ styles: listStyles() });
}

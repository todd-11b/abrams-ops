import { authorizeQuoteBrain, json, unauthorized } from './_lib/auth';
import { buildQuoteForm, listStyles, parseQuoteInput, quotePayload } from './_lib/form';

export const config = { runtime: 'edge' };

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (!authorizeQuoteBrain(req)) return unauthorized();
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, { status: 405 });
  let body: unknown;
  try { body = await req.json(); } catch { return json({ error: 'invalid JSON' }, { status: 400 }); }
  const { input, error } = parseQuoteInput(body);
  if (error) return json({ error }, { status: 400 });
  const built = buildQuoteForm(input);
  if ('error' in built) return json({ error: built.error, styles: listStyles() }, { status: 400 });
  return json(quotePayload(built.form, built.resolved));
}

function mismatch(expected: string, provided: string): boolean {
  if (expected.length !== provided.length) return true;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ provided.charCodeAt(i);
  return diff !== 0;
}

export function quoteBrainSecret(): string {
  return process.env.QUOTE_BRAIN_SECRET?.trim() ?? '';
}

export function readBearer(req: Request): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') ?? '');
  const token = match?.[1]?.trim() ?? '';
  return token || null;
}

export function authorizeQuoteBrain(req: Request): boolean {
  const secret = quoteBrainSecret();
  const token = readBearer(req);
  if (!secret || secret.length < 16 || !token) return false;
  return !mismatch(secret, token);
}

export function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(init.headers ?? {}) },
  });
}

export function unauthorized(): Response {
  return json({ error: 'unauthorized' }, { status: 401 });
}

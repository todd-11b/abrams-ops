const encoder = new TextEncoder();

export async function sha256(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function serverEnv() {
  const url = process.env.SUPABASE_URL ?? '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  if (!url || !key) throw new Error('server data is not configured');
  return { url, key };
}

export function supabaseRequest(path: string, init: RequestInit = {}) {
  const { url, key } = serverEnv();
  return fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(init.headers ?? {}) },
  });
}

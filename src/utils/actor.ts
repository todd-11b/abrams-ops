import type { Actor } from '../types/production';

const SESSION_KEY = 'abrams_operator_session';

interface StoredSession { token: string; actor: Actor; expiresAt: number }

export function storeOperatorSession(session: StoredSession): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function getOperatorSession(): StoredSession | null {
  try {
    const session = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? '') as StoredSession;
    if (!session.token || !['todd', 'ty'].includes(session.actor) || session.expiresAt <= Math.floor(Date.now() / 1000)) {
      clearStoredActor();
      return null;
    }
    return session;
  } catch { return null; }
}

export function getStoredActor(): Actor | null { return getOperatorSession()?.actor ?? null; }

export async function signInWithPin(pin: string): Promise<Actor> {
  const res = await fetch('/api/operator/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  });
  if (!res.ok) throw new Error(res.status === 401 ? 'Incorrect PIN' : 'Sign-in unavailable');
  const body = await res.json() as { token: string; actor: Actor; expires_at: number };
  storeOperatorSession({ token: body.token, actor: body.actor, expiresAt: body.expires_at });
  return body.actor;
}

export function clearStoredActor(): void { sessionStorage.removeItem(SESSION_KEY); }

export async function operatorFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const session = getOperatorSession();
  if (!session) throw new Error('Operator session required');
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${session.token}`);
  const res = await fetch(input, { ...init, headers });
  if (res.status === 401) clearStoredActor();
  return res;
}

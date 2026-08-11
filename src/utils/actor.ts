import type { Actor } from '../types/production';

const SESSION_KEY = 'abrams_operator_session';

interface StoredSession { token: string; actor: Actor; expiresAt: number }

const sessionEndListeners = new Set<() => void>();

/** Lets a mounted PIN gate re-lock the moment a session expires or is rejected. */
export function onOperatorSessionEnded(listener: () => void): () => void {
  sessionEndListeners.add(listener);
  return () => { sessionEndListeners.delete(listener); };
}

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

/** True only when the app is running inside another site's frame, i.e. HighLevel. */
export function isEmbedded(): boolean {
  try { return window.parent !== window.self; } catch { return true; }
}

/**
 * Asks the embedding HighLevel window for the encrypted user context it hands
 * apps, then trades it for an operator session. Resolves to null whenever the
 * app is not embedded or HighLevel does not answer, so the PIN gate still shows.
 */
export async function signInWithGhlSso(timeoutMs = 3000): Promise<Actor | null> {
  if (!isEmbedded()) return null;
  const encryptedData = await new Promise<unknown>((resolve) => {
    const onMessage = ({ data }: MessageEvent) => {
      if (data?.message !== 'REQUEST_USER_DATA_RESPONSE') return;
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
      resolve(data.payload);
    };
    const timer = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      resolve(null);
    }, timeoutMs);
    window.addEventListener('message', onMessage);
    window.parent.postMessage({ message: 'REQUEST_USER_DATA' }, '*');
  });
  if (typeof encryptedData !== 'string' || !encryptedData) return null;

  const res = await fetch('/api/operator/sso', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ encryptedData }),
  });
  if (!res.ok) return null;
  const body = await res.json() as { token: string; actor: Actor; expires_at: number };
  storeOperatorSession({ token: body.token, actor: body.actor, expiresAt: body.expires_at });
  return body.actor;
}

export function clearStoredActor(): void {
  const hadSession = sessionStorage.getItem(SESSION_KEY) !== null;
  sessionStorage.removeItem(SESSION_KEY);
  if (hadSession) for (const listener of [...sessionEndListeners]) listener();
}

export async function operatorFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const session = getOperatorSession();
  if (!session) throw new Error('Operator session required');
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${session.token}`);
  const res = await fetch(input, { ...init, headers });
  if (res.status === 401) clearStoredActor();
  return res;
}

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signInWithPin, getStoredActor, getOperatorSession, clearStoredActor, onOperatorSessionEnded, operatorFetch } from './actor';

describe('server-backed operator session', () => {
  beforeEach(() => { sessionStorage.clear(); vi.restoreAllMocks(); });

  it('stores the short-lived server token and actor', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ token: 'signed-token', actor: 'todd', expires_at: Math.floor(Date.now()/1000)+60 }), { status: 200 })));
    await expect(signInWithPin('7419')).resolves.toBe('todd');
    expect(getStoredActor()).toBe('todd');
    expect(getOperatorSession()?.token).toBe('signed-token');
  });

  it('does not validate a PIN in browser code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid credentials' }), { status: 401 })));
    await expect(signInWithPin('7419')).rejects.toThrow('Incorrect PIN');
    expect(getStoredActor()).toBeNull();
  });

  it('rejects expired storage and supports logout', () => {
    sessionStorage.setItem('abrams_operator_session', JSON.stringify({ token: 'x', actor: 'ty', expiresAt: 1 }));
    expect(getStoredActor()).toBeNull();
    sessionStorage.setItem('abrams_operator_session', JSON.stringify({ token: 'x', actor: 'ty', expiresAt: Math.floor(Date.now()/1000)+60 }));
    clearStoredActor();
    expect(getStoredActor()).toBeNull();
  });

  it('notifies subscribers when an expired session is rejected mid-session', async () => {
    const ended = vi.fn();
    const unsubscribe = onOperatorSessionEnded(ended);
    sessionStorage.setItem('abrams_operator_session', JSON.stringify({ token: 'x', actor: 'ty', expiresAt: Math.floor(Date.now()/1000)+60 }));
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));

    await operatorFetch('/api/operator/data', { method: 'POST' });

    expect(ended).toHaveBeenCalledTimes(1);
    expect(getStoredActor()).toBeNull();
    unsubscribe();
    clearStoredActor();
    expect(ended).toHaveBeenCalledTimes(1);
  });
});

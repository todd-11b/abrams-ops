import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signInWithPin, getStoredActor, getOperatorSession, clearStoredActor, onOperatorSessionEnded, operatorFetch, signInWithGhlSso } from './actor';

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

describe('HighLevel SSO sign-in', () => {
  const parent = { postMessage: vi.fn() };

  beforeEach(() => { sessionStorage.clear(); vi.restoreAllMocks(); parent.postMessage.mockReset(); });

  /** Stands in for the HighLevel dashboard answering the app's postMessage. */
  function embedWithReply(payload: unknown | null) {
    vi.spyOn(window, 'parent', 'get').mockReturnValue(parent as unknown as Window);
    parent.postMessage.mockImplementation(() => {
      if (payload === null) return;
      window.dispatchEvent(new MessageEvent('message', { data: { message: 'REQUEST_USER_DATA_RESPONSE', payload } }));
    });
  }

  it('trades the encrypted context for a session without asking for a PIN', async () => {
    embedWithReply('encrypted-context');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ token: 'sso-token', actor: 'ty', expires_at: Math.floor(Date.now()/1000)+60 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(signInWithGhlSso()).resolves.toBe('ty');
    expect(getOperatorSession()?.token).toBe('sso-token');
    expect(fetchMock).toHaveBeenCalledWith('/api/operator/sso', expect.objectContaining({ method: 'POST' }));
  });

  it('gives up so the PIN gate shows when the server rejects the context', async () => {
    embedWithReply('encrypted-context');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));

    await expect(signInWithGhlSso()).resolves.toBeNull();
    expect(getStoredActor()).toBeNull();
  });

  it('gives up when the embedding window never answers', async () => {
    vi.useFakeTimers();
    embedWithReply(null);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const pending = signInWithGhlSso(3000);
    await vi.advanceTimersByTimeAsync(3000);
    await expect(pending).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('does nothing at all when the app is not embedded', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(signInWithGhlSso()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

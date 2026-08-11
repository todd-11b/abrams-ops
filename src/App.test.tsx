import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
  vi.resetModules();
});

describe('App environment isolation', () => {
  it('renders the app when browser owner-contact routing is absent', async () => {
    const originalContactId = import.meta.env.VITE_GHL_TODD_CONTACT_ID;
    delete import.meta.env.VITE_GHL_TODD_CONTACT_ID;

    try {
      window.history.replaceState({}, '', '/production');
      const { default: App } = await import('./App');
      render(<App />);

      expect(screen.getByText('Production — Enter PIN')).toBeTruthy();
      expect(screen.getByRole('button', { name: '1' })).toBeTruthy();
    } finally {
      import.meta.env.VITE_GHL_TODD_CONTACT_ID = originalContactId;
    }
  });
});

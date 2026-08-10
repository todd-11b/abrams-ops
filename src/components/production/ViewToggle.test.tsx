import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useProductionView } from './ViewToggle';

describe('useProductionView', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('initializes from valid storage without a follow-up render and persists changes', () => {
    localStorage.setItem('abrams_production_view', 'field');
    const { result } = renderHook(() => useProductionView());

    expect(result.current[0]).toBe('field');
    act(() => result.current[1]('office'));
    expect(result.current[0]).toBe('office');
    expect(localStorage.getItem('abrams_production_view')).toBe('office');
  });

  it('falls back to the viewport when storage is invalid', () => {
    localStorage.setItem('abrams_production_view', 'invalid');
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 600 });

    const { result } = renderHook(() => useProductionView());

    expect(result.current[0]).toBe('field');
  });

  it('falls back to the viewport when storage access is blocked', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });

    const { result } = renderHook(() => useProductionView());

    expect(result.current[0]).toBe('office');
  });

  it('retains the selected view when storage writes are blocked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const { result } = renderHook(() => useProductionView());

    expect(() => act(() => result.current[1]('field'))).not.toThrow();
    expect(result.current[0]).toBe('field');
  });
});

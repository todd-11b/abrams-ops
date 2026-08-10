import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useProductionView } from './ViewToggle';

describe('useProductionView', () => {
  beforeEach(() => localStorage.clear());

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
});

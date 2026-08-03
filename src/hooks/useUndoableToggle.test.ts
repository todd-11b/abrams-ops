import { describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { UNDO_WINDOW_MS, useUndoableToggle } from './useUndoableToggle';

const label = () => 'Load posts';

describe('useUndoableToggle', () => {
  it('offers an undo naming the item, and reverses the tick when pressed', async () => {
    const toggle = vi.fn();
    const { result } = renderHook(() => useUndoableToggle(toggle, label));

    await act(async () => { await result.current.toggleWithUndo('i1', true); });
    expect(result.current.undo).toMatchObject({ message: 'Load posts ticked', itemId: 'i1', checked: true });

    act(() => { result.current.revert(); });
    expect(toggle).toHaveBeenLastCalledWith('i1', false);
    expect(result.current.undo).toBeNull();
  });

  // A stale toggle would replay the checklist as it stood at the tap, wiping a
  // tick or skip made while the toast was still up.
  it('reverts through the current toggle, not the one captured at tap time', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(({ toggle }) => useUndoableToggle(toggle, label), {
      initialProps: { toggle: first as (id: string, checked: boolean) => void },
    });

    await act(async () => { await result.current.toggleWithUndo('i1', true); });
    rerender({ toggle: second });
    act(() => { result.current.revert(); });

    expect(second).toHaveBeenCalledWith('i1', false);
    expect(first).toHaveBeenCalledTimes(1);
  });

  // StrictMode double-invokes state updaters, so the reversal must not live in one.
  it('saves the reversal once under StrictMode', async () => {
    const toggle = vi.fn();
    const { result } = renderHook(() => useUndoableToggle(toggle, label), { wrapper: StrictMode });

    await act(async () => { await result.current.toggleWithUndo('i1', true); });
    act(() => { result.current.revert(); });

    expect(toggle.mock.calls).toEqual([['i1', true], ['i1', false]]);
  });

  it('drops the offer once the window closes, so a later press cannot reverse it', async () => {
    vi.useFakeTimers();
    const toggle = vi.fn();
    const { result } = renderHook(() => useUndoableToggle(toggle, label));

    await act(async () => { await result.current.toggleWithUndo('i1', true); });
    act(() => { vi.advanceTimersByTime(UNDO_WINDOW_MS); });

    expect(result.current.undo).toBeNull();
    act(() => { result.current.revert(); });
    expect(toggle).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

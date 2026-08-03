import { useCallback, useEffect, useRef, useState } from 'react';

export const UNDO_WINDOW_MS = 8000;

export interface PendingUndo {
  message: string;
  itemId: string;
  checked: boolean;
}

type Toggle = (itemId: string, checked: boolean) => Promise<void> | void;

/**
 * A checklist tick saves immediately — gloved hands on a windy site should not
 * confirm every item — so the safety net is a brief undo rather than a dialog.
 * The revert calls the current toggle, not the one captured at tap time, so a
 * tick or skip made during the undo window is not rolled back with it.
 */
export function useUndoableToggle(toggle: Toggle, label: (itemId: string) => string) {
  const [undo, setUndo] = useState<PendingUndo | null>(null);
  const toggleRef = useRef(toggle);
  useEffect(() => { toggleRef.current = toggle; }, [toggle]);

  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), UNDO_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [undo]);

  const toggleWithUndo = useCallback(async (itemId: string, checked: boolean) => {
    await toggleRef.current(itemId, checked);
    setUndo({ message: `${label(itemId)} ${checked ? 'ticked' : 'unticked'}`, itemId, checked });
  }, [label]);

  const revert = useCallback(() => {
    setUndo((pending) => {
      if (pending) void toggleRef.current(pending.itemId, !pending.checked);
      return null;
    });
  }, []);

  return { undo, toggleWithUndo, revert };
}

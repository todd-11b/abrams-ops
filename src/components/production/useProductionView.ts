import { useState } from 'react';

const STORAGE_KEY = 'abrams_production_view';
export type ProductionView = 'office' | 'field';

function detectDefault(): ProductionView {
  if (typeof window === 'undefined') return 'office';
  return window.innerWidth > 768 ? 'office' : 'field';
}

function readInitialView(): ProductionView {
  if (typeof window === 'undefined') return 'office';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === 'office' || stored === 'field' ? stored : detectDefault();
  } catch {
    return detectDefault();
  }
}

export function useProductionView(): [ProductionView, (view: ProductionView) => void] {
  const [view, setView] = useState<ProductionView>(readInitialView);
  const update = (next: ProductionView) => {
    setView(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // The in-memory view remains usable when storage is unavailable.
    }
  };
  return [view, update];
}

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

export function useProductionView(): [ProductionView, (v: ProductionView) => void] {
  const [view, setView] = useState<ProductionView>(readInitialView);
  const update = (next: ProductionView) => {
    setView(next);
    localStorage.setItem(STORAGE_KEY, next);
  };
  return [view, update];
}

interface Props {
  view: ProductionView;
  onChange: (v: ProductionView) => void;
}

export function ViewToggle({ view, onChange }: Props) {
  return (
    <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden text-sm">
      <button
        onClick={() => onChange('office')}
        className={`px-3 py-1.5 ${view === 'office' ? 'bg-[#0a1f3d] text-white' : 'bg-white text-slate-700'}`}
      >🖥 Office</button>
      <button
        onClick={() => onChange('field')}
        className={`px-3 py-1.5 ${view === 'field' ? 'bg-[#0a1f3d] text-white' : 'bg-white text-slate-700'}`}
      >📱 Field</button>
    </div>
  );
}

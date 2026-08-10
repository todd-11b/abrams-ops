import type { ProductionView } from './useProductionView';

interface Props {
  view: ProductionView;
  onChange: (view: ProductionView) => void;
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

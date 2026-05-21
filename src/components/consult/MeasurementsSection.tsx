import { Trash2, Plus } from "lucide-react";
import {
  ConsultFormData,
  FenceLineItem,
  FENCE_STYLES,
  FENCE_TYPE_OPTIONS,
  calcSections,
  FenceStyle,
} from "./consultTypes";

interface Props {
  data: ConsultFormData;
  onChange: (updates: Partial<ConsultFormData>) => void;
}

function currency(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export const MeasurementsSection = ({ data, onChange }: Props) => {
  const updateLine = (id: string, updates: Partial<FenceLineItem>) => {
    onChange({
      fenceLines: data.fenceLines.map((l) => {
        if (l.id !== id) return l;
        const updated = { ...l, ...updates };
        // auto-fill price when style changes
        if (updates.style && FENCE_STYLES[updates.style]) {
          updated.pricePerSection = FENCE_STYLES[updates.style].pricePerSection;
        }
        return updated;
      }),
    });
  };

  const addLine = () => {
    const defaultStyle = "wood_pine_6";
    onChange({
      fenceLines: [
        ...data.fenceLines,
        {
          id: crypto.randomUUID(),
          label: `Run ${data.fenceLines.length + 1}`,
          style: defaultStyle,
          linearFeet: 0,
          pricePerSection: FENCE_STYLES[defaultStyle].pricePerSection,
        },
      ],
    });
  };

  const removeLine = (id: string) => {
    onChange({ fenceLines: data.fenceLines.filter((l) => l.id !== id) });
  };

  return (
    <div className="space-y-5">
      {/* Fence Type (General) */}
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1.5">General Fence Type</label>
        <select
          value={data.fenceType}
          onChange={(e) => onChange({ fenceType: e.target.value })}
          className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0a1f3d]/30"
        >
          <option value="">Select type...</option>
          {FENCE_TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      {/* Line Items */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-gray-700">Fence Lines</span>
          <button
            type="button"
            onClick={addLine}
            className="flex items-center gap-1.5 text-sm font-semibold text-[#0a1f3d] bg-[#0a1f3d]/10 px-3 py-1.5 rounded-lg active:bg-[#0a1f3d]/20"
          >
            <Plus size={14} /> Add Line
          </button>
        </div>

        {data.fenceLines.map((line, idx) => {
          let style = FENCE_STYLES[line.style];
          if (!style) {
            style = Object.values(FENCE_STYLES).find(s => (s as FenceStyle).label === line.style) as FenceStyle;
          }
          const sections = style ? calcSections(line.linearFeet, style.spacingFt) : 0;
          const lineTotal = sections * line.pricePerSection;
          const materialCost = style ? sections * style.materialCostPerSection : 0;
          const lineMargin =
            line.pricePerSection > 0
              ? ((line.pricePerSection - (style?.materialCostPerSection ?? 0)) / line.pricePerSection) * 100
              : 0;

          return (
            <div key={line.id} className="rounded-2xl border border-gray-200 p-4 bg-gray-50 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">Line {idx + 1}</span>
                {data.fenceLines.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeLine(line.id)}
                    className="text-red-400 p-1 rounded-lg active:bg-red-50"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Run Name (e.g. South Run)</label>
                  <input
                    type="text"
                    value={line.label || ""}
                    onChange={(e) => updateLine(line.id, { label: e.target.value })}
                    placeholder="Run name"
                    className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0a1f3d]/30"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Style</label>
                  <select
                    value={line.style}
                    onChange={(e) => updateLine(line.id, { style: e.target.value })}
                    className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0a1f3d]/30"
                  >
                    {Object.entries(FENCE_STYLES).map(([key, s]) => (
                      <option key={key} value={key}>{(s as FenceStyle).label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">Linear Feet</label>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={line.linearFeet || ""}
                    onChange={(e) => updateLine(line.id, { linearFeet: Number(e.target.value) })}
                    placeholder="0"
                    className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0a1f3d]/30 font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 mb-1 block">$/Section</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    value={line.pricePerSection || ""}
                    onChange={(e) => updateLine(line.id, { pricePerSection: Number(e.target.value) })}
                    placeholder="0"
                    className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0a1f3d]/30 font-mono"
                  />
                </div>
              </div>

              {line.linearFeet > 0 && style && (
                <div className="pt-1 border-t border-gray-200 space-y-1">
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>{sections} sections × {currency(line.pricePerSection)}</span>
                    <span className="font-bold text-[#0a1f3d] font-mono">{currency(lineTotal)}</span>
                  </div>
                  <div className="flex justify-between text-[10px] text-gray-400 font-mono">
                    <span>materials ~{currency(materialCost)}</span>
                    <span>margin {lineMargin.toFixed(1)}%</span>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

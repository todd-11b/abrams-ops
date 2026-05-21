import type { ReactNode } from "react";
import { ConsultFormData, AddOns } from "./consultTypes";

interface Props {
  data: ConsultFormData;
  onChange: (updates: Partial<ConsultFormData>) => void;
}

function AddOnRow({
  label,
  enabled,
  onToggle,
  children,
}: {
  label: string;
  enabled: boolean;
  onToggle: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-gray-50 overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-3"
      >
        <span className="text-sm font-semibold text-gray-700">{label}</span>
        <div
          className={`w-10 h-6 rounded-full transition-colors ${
            enabled ? "bg-[#0a1f3d]" : "bg-gray-300"
          } relative`}
        >
          <div
            className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${
              enabled ? "translate-x-5" : "translate-x-1"
            }`}
          />
        </div>
      </button>
      {enabled && <div className="px-4 pb-4 space-y-3 border-t border-gray-200 pt-3">{children}</div>}
    </div>
  );
}

export const AddOnsSection = ({ data, onChange }: Props) => {
  const a = data.addOns;

  const update = (updates: Partial<AddOns>) => {
    onChange({ addOns: { ...a, ...updates } });
  };

  return (
    <div className="space-y-4">
      <AddOnRow
        label="Demo / Haul-Away"
        enabled={a.demo.enabled}
        onToggle={() => update({ demo: { ...a.demo, enabled: !a.demo.enabled } })}
      >
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Linear Feet</label>
            <input
              type="number"
              inputMode="numeric"
              value={a.demo.lf || ""}
              onChange={(e) => update({ demo: { ...a.demo, lf: Number(e.target.value) } })}
              placeholder="0"
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0a1f3d]/30 font-mono"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">$/LF</label>
            <input
              type="number"
              inputMode="decimal"
              value={a.demo.pricePerLf || ""}
              onChange={(e) => update({ demo: { ...a.demo, pricePerLf: Number(e.target.value) } })}
              placeholder="6"
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0a1f3d]/30 font-mono"
            />
          </div>
        </div>
        {a.demo.lf > 0 && (
          <div className="text-xs text-right text-[#0a1f3d] font-bold font-mono">
            ${(a.demo.lf * a.demo.pricePerLf).toLocaleString()}
          </div>
        )}
      </AddOnRow>

      <AddOnRow
        label="Staining"
        enabled={a.stain.enabled}
        onToggle={() => update({ stain: { ...a.stain, enabled: !a.stain.enabled } })}
      >
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Square Feet</label>
            <input
              type="number"
              inputMode="numeric"
              value={a.stain.sf || ""}
              onChange={(e) => update({ stain: { ...a.stain, sf: Number(e.target.value) } })}
              placeholder="0"
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0a1f3d]/30 font-mono"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">$/SF</label>
            <input
              type="number"
              inputMode="decimal"
              value={a.stain.pricePerSf || ""}
              onChange={(e) => update({ stain: { ...a.stain, pricePerSf: Number(e.target.value) } })}
              placeholder="2.50"
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0a1f3d]/30 font-mono"
            />
          </div>
        </div>
        {a.stain.sf > 0 && (
          <div className="text-xs text-right text-[#0a1f3d] font-bold font-mono">
            ${(a.stain.sf * a.stain.pricePerSf).toFixed(2)}
          </div>
        )}
      </AddOnRow>

      <AddOnRow
        label="Pool / Magna Latch Upgrade"
        enabled={a.poolLatch.enabled}
        onToggle={() => update({ poolLatch: { ...a.poolLatch, enabled: !a.poolLatch.enabled } })}
      >
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Gates</label>
            <input
              type="number"
              inputMode="numeric"
              value={a.poolLatch.qty || ""}
              onChange={(e) => update({ poolLatch: { ...a.poolLatch, qty: Number(e.target.value) } })}
              placeholder="0"
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0a1f3d]/30 font-mono"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">$/Gate</label>
            <input
              type="number"
              inputMode="decimal"
              value={a.poolLatch.priceEach || ""}
              onChange={(e) => update({ poolLatch: { ...a.poolLatch, priceEach: Number(e.target.value) } })}
              placeholder="175"
              className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0a1f3d]/30 font-mono"
            />
          </div>
        </div>
        {a.poolLatch.qty > 0 && (
          <div className="text-xs text-right text-[#0a1f3d] font-bold font-mono">
            ${(a.poolLatch.qty * a.poolLatch.priceEach).toLocaleString()}
          </div>
        )}
      </AddOnRow>
    </div>
  );
};

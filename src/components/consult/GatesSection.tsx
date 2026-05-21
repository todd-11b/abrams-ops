import { ConsultFormData } from "./consultTypes";

interface Props {
  data: ConsultFormData;
  onChange: (updates: Partial<ConsultFormData>) => void;
}

function NumRow({
  label,
  qty,
  price,
  onQty,
  onPrice,
}: {
  label: string;
  qty: number;
  price: number;
  onQty: (n: number) => void;
  onPrice: (n: number) => void;
}) {
  return (
    <div className="rounded-2xl border border-gray-200 p-4 bg-gray-50 space-y-3">
      <span className="text-sm font-semibold text-gray-700">{label}</span>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Quantity</label>
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={qty || ""}
            onChange={(e) => onQty(Number(e.target.value))}
            placeholder="0"
            className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0a1f3d]/30 font-mono"
          />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">Price Each</label>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            value={price || ""}
            onChange={(e) => onPrice(Number(e.target.value))}
            placeholder="0"
            className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0a1f3d]/30 font-mono"
          />
        </div>
      </div>
      {qty > 0 && (
        <div className="flex justify-between text-xs pt-1 border-t border-gray-200 text-gray-500">
          <span>{qty} × ${price.toLocaleString()}</span>
          <span className="font-bold text-[#0a1f3d] font-mono">
            ${(qty * price).toLocaleString()}
          </span>
        </div>
      )}
    </div>
  );
}

export const GatesSection = ({ data, onChange }: Props) => {
  const g = data.gates;

  const updateGateQty = (type: "walk" | "double", newQty: number) => {
    const currentQty = type === "walk" ? g.walk.qty : g.double.qty;
    const diff = newQty - currentQty;

    let newInstances = [...(data.gateInstances || [])];

    if (diff > 0) {
      // Add new instances
      for (let i = 0; i < diff; i++) {
        newInstances.push({
          id: crypto.randomUUID(),
          type,
          position: { x: 150, y: 150 + (newInstances.length * 40) },
          rotation: 0
        });
      }
    } else if (diff < 0) {
      // Remove instances of this type from the end
      const toRemove = Math.abs(diff);
      let removedCount = 0;
      for (let i = newInstances.length - 1; i >= 0 && removedCount < toRemove; i--) {
        if (newInstances[i].type === type) {
          newInstances.splice(i, 1);
          removedCount++;
        }
      }
    }

    onChange({
      gates: { ...g, [type]: { ...g[type], qty: newQty } },
      gateInstances: newInstances
    });
  };

  return (
    <div className="space-y-4">
      <NumRow
        label="Walk Gate"
        qty={g.walk.qty}
        price={g.walk.price}
        onQty={(n) => updateGateQty("walk", n)}
        onPrice={(n) => onChange({ gates: { ...g, walk: { ...g.walk, price: n } } })}
      />
      <NumRow
        label="Double Gate"
        qty={g.double.qty}
        price={g.double.price}
        onQty={(n) => updateGateQty("double", n)}
        onPrice={(n) => onChange({ gates: { ...g, double: { ...g.double, price: n } } })}
      />
    </div>
  );
};

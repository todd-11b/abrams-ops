import { ConsultFormData } from "./consultTypes";

interface Props {
  data: ConsultFormData;
  onChange: (updates: Partial<ConsultFormData>) => void;
}

type SegOption<T extends string> = { label: string; value: T };

function SegControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T | "";
  options: SegOption<T>[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-xl overflow-hidden border border-gray-200 w-full">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`flex-1 py-3 text-sm font-medium transition-colors ${
            value === opt.value
              ? "bg-[#0a1f3d] text-white"
              : "bg-white text-gray-600 hover:bg-gray-50"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export const PropertySection = ({ data, onChange }: Props) => {
  return (
    <div className="space-y-5">
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1.5">Property Address</label>
        <input
          type="text"
          value={data.propertyAddress}
          onChange={(e) => onChange({ propertyAddress: e.target.value })}
          placeholder="123 Main St, Overland Park, KS"
          className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0a1f3d]/30"
        />
      </div>

      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1.5">HOA Approval Needed?</label>
        <SegControl
          value={data.hoaApproval}
          options={[
            { label: "Yes", value: "Yes" as const },
            { label: "No", value: "No" as const },
            { label: "Unsure", value: "Unsure" as const },
          ]}
          onChange={(v) => onChange({ hoaApproval: v })}
        />
      </div>

      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1.5">Sprinklers / Irrigation?</label>
        <SegControl
          value={data.sprinklers}
          options={[
            { label: "Yes", value: "Yes" as const },
            { label: "No", value: "No" as const },
            { label: "Unknown", value: "Unknown" as const },
          ]}
          onChange={(v) => onChange({ sprinklers: v })}
        />
      </div>

      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1.5">Lot Notes / Obstacles</label>
        <textarea
          value={data.lotNotes}
          onChange={(e) => onChange({ lotNotes: e.target.value })}
          placeholder="Slope, trees, existing structures..."
          rows={3}
          className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0a1f3d]/30 resize-none"
        />
      </div>

      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1.5">Yard Sensitivity</label>
        <textarea
          value={data.yardSensitivity}
          onChange={(e) => onChange({ yardSensitivity: e.target.value })}
          placeholder="Landscaping, garden beds, irrigation heads..."
          rows={2}
          className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0a1f3d]/30 resize-none"
        />
      </div>

      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1.5">Clean Site Risk Areas</label>
        <textarea
          value={data.cleanSiteRisks}
          onChange={(e) => onChange({ cleanSiteRisks: e.target.value })}
          placeholder="Tight access, gravel paths, fragile areas..."
          rows={2}
          className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0a1f3d]/30 resize-none"
        />
      </div>

      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1.5">Pet Considerations</label>
        <textarea
          value={data.petConsiderations}
          onChange={(e) => onChange({ petConsiderations: e.target.value })}
          placeholder="Dog breed, size, containment needs..."
          rows={2}
          className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0a1f3d]/30 resize-none"
        />
      </div>
    </div>
  );
};

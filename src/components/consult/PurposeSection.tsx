import { ConsultFormData, PURPOSE_OPTIONS, TIMELINE_OPTIONS } from "./consultTypes";

interface Props {
  data: ConsultFormData;
  onChange: (updates: Partial<ConsultFormData>) => void;
}

export const PurposeSection = ({ data, onChange }: Props) => {
  const togglePurpose = (p: string) => {
    const current = data.purposes;
    onChange({
      purposes: current.includes(p) ? current.filter((x) => x !== p) : [...current, p],
    });
  };

  return (
    <div className="space-y-5">
      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-3">Purpose (select all that apply)</label>
        <div className="grid grid-cols-2 gap-2">
          {PURPOSE_OPTIONS.map((p) => {
            const active = data.purposes.includes(p);
            return (
              <button
                key={p}
                type="button"
                onClick={() => togglePurpose(p)}
                className={`py-3 px-4 rounded-xl border text-sm font-medium transition-colors ${
                  active
                    ? "bg-[#0a1f3d] text-white border-[#0a1f3d]"
                    : "bg-white text-gray-600 border-gray-200 hover:border-[#0a1f3d]/40"
                }`}
              >
                {p}
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <label className="block text-sm font-semibold text-gray-700 mb-1.5">Timeline</label>
        <select
          value={data.timeline}
          onChange={(e) => onChange({ timeline: e.target.value })}
          className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-[#0a1f3d]/30"
        >
          <option value="">Select timeline...</option>
          {TIMELINE_OPTIONS.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>
    </div>
  );
};

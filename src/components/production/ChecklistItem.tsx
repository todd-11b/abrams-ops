import { useState } from 'react';
import type { ChecklistItem as Item } from '../../types/production';

interface Props {
  item: Item;
  onToggle: (id: string, checked: boolean) => Promise<void>;
  onSkip: (id: string, reason: string) => Promise<void>;
}

export function ChecklistItem({ item, onToggle, onSkip }: Props) {
  const [showSkip, setShowSkip] = useState(false);
  const [reason, setReason] = useState('');

  if (item.skipped) {
    return (
      <div className="flex items-start gap-2 py-2 text-slate-500 line-through">
        <span>⏭</span>
        <div>
          <div>{item.label}</div>
          {item.skip_reason && <div className="text-xs">Skipped: {item.skip_reason}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="py-2">
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={item.checked}
          onChange={(e) => onToggle(item.item_id, e.target.checked)}
          className="mt-1 h-5 w-5 rounded border-slate-400"
        />
        <span className={item.checked ? 'text-slate-400 line-through' : 'text-slate-800'}>
          {item.label}
        </span>
      </label>
      {item.skippable && !item.checked && (
        <div className="ml-8 mt-1">
          {!showSkip ? (
            <button onClick={() => setShowSkip(true)} className="text-xs text-slate-500 underline">
              Skip
            </button>
          ) : (
            <div className="flex gap-2 mt-1">
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason"
                className="border rounded px-2 py-1 text-sm flex-1"
              />
              <button
                disabled={!reason.trim()}
                onClick={() => onSkip(item.item_id, reason.trim())}
                className="px-3 py-1 bg-[#0a1f3d] text-white rounded text-sm disabled:opacity-40"
              >Save</button>
              <button onClick={() => { setShowSkip(false); setReason(''); }} className="text-sm text-slate-500">Cancel</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

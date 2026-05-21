import { useState } from 'react';

interface Props {
  onClose: () => void;
  onBlock: (reason: string, note: string) => Promise<void>;
}

const REASONS = [
  'weather',
  'customer_unreachable',
  'materials_back_order',
  'permit_pending',
  'utility_marking_pending',
  'other',
];

export function BlockedModal({ onClose, onBlock }: Props) {
  const [reason, setReason] = useState(REASONS[0]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-md p-5 space-y-3">
        <h2 className="font-semibold text-lg">Block this job</h2>
        <label className="block text-sm">
          Reason
          <select value={reason} onChange={(e) => setReason(e.target.value)} className="w-full border rounded p-2 mt-1">
            {REASONS.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
          </select>
        </label>
        <label className="block text-sm">
          Note
          <textarea value={note} onChange={(e) => setNote(e.target.value)} className="w-full border rounded p-2 mt-1" rows={3} />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-2 text-slate-600">Cancel</button>
          <button
            onClick={async () => { setBusy(true); await onBlock(reason, note); setBusy(false); onClose(); }}
            disabled={busy}
            className="px-4 py-2 bg-amber-600 text-white rounded disabled:opacity-50"
          >{busy ? 'Saving…' : 'Block job'}</button>
        </div>
      </div>
    </div>
  );
}

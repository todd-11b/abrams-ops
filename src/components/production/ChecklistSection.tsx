import { useState, type ReactNode } from 'react';
import { ChecklistItem as Row } from './ChecklistItem';
import type { ChecklistItem } from '../../types/production';

interface Props {
  title: string;
  photoDescription: string | null;
  items: ChecklistItem[];
  photoUploaded: boolean;
  onToggle: (id: string, checked: boolean) => Promise<void>;
  onSkip: (id: string, reason: string) => Promise<void>;
  onFlagIssueHere?: () => void;
  photoUploadSlot?: ReactNode;
}

export function ChecklistSection({ title, photoDescription, items, photoUploaded, onToggle, onSkip, onFlagIssueHere, photoUploadSlot }: Props) {
  const [open, setOpen] = useState(true);
  const done = items.length > 0 && items.every((i) => i.checked || i.skipped);
  const photoOk = !photoDescription || photoUploaded;
  return (
    <div className="border rounded-lg overflow-hidden bg-white">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100"
      >
        <span className="font-semibold text-slate-800 text-left">
          {done && photoOk ? '✅ ' : ''}{title}
        </span>
        <span className="text-slate-400">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="px-4 py-2">
          {items.map((it) => (
            <Row key={it.item_id} item={it} onToggle={onToggle} onSkip={onSkip} />
          ))}
          {photoDescription && (
            <div className="mt-3 pt-3 border-t">
              <div className="text-xs text-slate-500 mb-2">Photo: {photoDescription}</div>
              {photoUploaded ? (
                <div className="text-emerald-700 text-sm">✅ Photo uploaded</div>
              ) : (
                photoUploadSlot
              )}
            </div>
          )}
          {onFlagIssueHere && (
            <div className="mt-2 pt-2 border-t">
              <button
                onClick={onFlagIssueHere}
                className="text-xs text-rose-700 underline"
              >🚩 Flag issue in this section</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

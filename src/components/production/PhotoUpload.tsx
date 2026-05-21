import { useRef, useState } from 'react';
import { usePhotoQueue } from '../../hooks/usePhotoQueue';
import type { PhotoPhase } from '../../types/production';

interface Props {
  jobId: string;
  contactId: string;
  phase: PhotoPhase;
  onUploaded?: (photoId: string) => void;
  label?: string;
}

export function PhotoUpload({ jobId, contactId, phase, onUploaded, label }: Props) {
  const { upload, pendingCount } = usePhotoQueue(jobId, contactId);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  const pick = () => inputRef.current?.click();

  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setWarning(null);
    const result = await upload(file, phase);
    setBusy(false);
    if (result.ok) {
      onUploaded?.(result.photoId);
    } else {
      setWarning('⚠️ Upload pending');
    }
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div>
      <button
        onClick={pick}
        disabled={busy}
        className="px-4 py-2 bg-[#0a1f3d] text-white rounded text-sm disabled:opacity-50"
      >
        {busy ? 'Uploading…' : (label ?? '📷 Upload photo')}
      </button>
      <input ref={inputRef} type="file" accept="image/*" capture="environment" hidden onChange={onChange} />
      {warning && <div className="text-xs text-amber-700 mt-1">{warning}</div>}
      {pendingCount > 0 && <div className="text-xs text-slate-500 mt-1">{pendingCount} queued</div>}
    </div>
  );
}

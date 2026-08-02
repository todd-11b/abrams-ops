import { useState } from 'react';
import { useIssue } from '../../hooks/useIssue';
import { PhotoUpload } from './PhotoUpload';
import type { IssueType, IssueSeverity, ChecklistSectionKey } from '../../types/production';

interface Props {
  jobId: string;
  contactId: string;
  section: ChecklistSectionKey | null;
  onClose: () => void;
}

const TYPES: { value: IssueType; label: string }[] = [
  { value: 'sprinkler_hit', label: 'Sprinkler hit' },
  { value: 'material_shortage', label: 'Material shortage' },
  { value: 'weather_delay', label: 'Weather delay' },
  { value: 'customer_concern', label: 'Customer concern' },
  { value: 'gate_issue', label: 'Gate issue' },
  { value: 'grade_issue', label: 'Grade issue' },
  { value: 'utility_conflict', label: 'Utility conflict' },
  { value: 'other', label: 'Other' },
];

export function FlagIssueModal({ jobId, contactId, section, onClose }: Props) {
  const { create } = useIssue();
  const [type, setType] = useState<IssueType>('other');
  const [severity, setSeverity] = useState<IssueSeverity>('low');
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [alertError, setAlertError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const result = await create({ job_id: jobId, contact_id: contactId, type, severity, note, photos, section });
      setAlertError(result.alertError);
      setSaved(true);
      // Hold the success flash long enough to register, then close and scroll
      // to the top so the new entry in the Open Issues panel is in view.
      // An undelivered owner alert has to be read, so that flash waits for a tap.
      if (result.alertError) return;
      setTimeout(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        onClose();
      }, 700);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create issue');
      setSubmitting(false);
    }
  };

  if (saved) {
    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
        <div className="bg-white rounded-lg w-full max-w-md p-6 flex flex-col items-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center text-2xl">✅</div>
          <div className="font-semibold text-emerald-700">Issue flagged</div>
          <div className="text-xs text-slate-500">Logged at {new Date().toLocaleTimeString()}</div>
          {alertError && (
            <>
              <div className="text-sm text-rose-700 text-center">
                Owner text alert did not send ({alertError}). Call Todd.
              </div>
              <button onClick={onClose} className="px-4 py-2 border rounded-lg text-sm">Close</button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-md p-5 space-y-3">
        <h2 className="font-semibold text-lg">🚩 Flag Issue</h2>
        {section && <div className="text-xs text-slate-500">Section: {section}</div>}
        <label className="block text-sm">
          Type
          <select value={type} onChange={(e) => setType(e.target.value as IssueType)} className="w-full border rounded p-2 mt-1">
            {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
        <label className="block text-sm">
          Severity
          <select value={severity} onChange={(e) => setSeverity(e.target.value as IssueSeverity)} className="w-full border rounded p-2 mt-1">
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High — texts Todd</option>
          </select>
        </label>
        <label className="block text-sm">
          Note
          <textarea value={note} onChange={(e) => setNote(e.target.value)} className="w-full border rounded p-2 mt-1" rows={3} />
        </label>
        <div>
          <div className="text-sm mb-1">Photo (required for sprinkler / utility)</div>
          <PhotoUpload
            jobId={jobId}
            contactId={contactId}
            phase="issue"
            onUploaded={(photoId) => setPhotos((p) => [...p, photoId])}
            label="📷 Attach photo"
          />
          {photos.length > 0 && <div className="text-xs text-slate-500 mt-1">{photos.length} attached</div>}
        </div>
        {error && <div className="text-rose-700 text-sm">{error}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-2 text-slate-600">Cancel</button>
          <button
            onClick={submit}
            disabled={submitting}
            className="px-4 py-2 bg-[#0a1f3d] text-white rounded disabled:opacity-50"
          >{submitting ? 'Saving…' : 'Flag Issue'}</button>
        </div>
      </div>
    </div>
  );
}

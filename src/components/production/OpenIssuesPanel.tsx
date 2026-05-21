import { useState } from 'react';
import { useJobIssues } from '../../hooks/useJobIssues';
import type { JobIssue, IssueSeverity } from '../../types/production';

interface Props {
  jobId: string;
}

const SEVERITY_STYLE: Record<IssueSeverity, string> = {
  low: 'bg-slate-100 text-slate-700 border-slate-300',
  medium: 'bg-amber-100 text-amber-800 border-amber-400',
  high: 'bg-rose-100 text-rose-800 border-rose-400',
};

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function IssueRow({
  issue,
  photoUrls,
  onResolve,
}: {
  issue: JobIssue;
  photoUrls: Record<string, string>;
  onResolve: (id: string, note: string) => Promise<void>;
}) {
  const [showResolve, setShowResolve] = useState(false);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!note.trim()) return;
    setSubmitting(true);
    try {
      await onResolve(issue.issue_id, note.trim());
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={`border-l-4 ${SEVERITY_STYLE[issue.severity]} bg-white rounded p-3 text-sm`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-slate-800">
            🚩 {issue.type.replace(/_/g, ' ')}
            <span className="ml-2 text-xs uppercase tracking-wide text-slate-500">{issue.severity}</span>
          </div>
          {issue.section && (
            <div className="text-xs text-slate-500 mt-0.5">Section: {issue.section}</div>
          )}
          {issue.note && <div className="text-slate-700 mt-1">{issue.note}</div>}
          {issue.photos.length > 0 && (
            <div className="mt-2 flex gap-2 flex-wrap">
              {issue.photos.map((pid) => {
                const url = photoUrls[pid];
                if (!url) {
                  return (
                    <div key={pid} className="w-16 h-16 bg-slate-100 rounded border border-slate-200 flex items-center justify-center text-xs text-slate-400">
                      …
                    </div>
                  );
                }
                return (
                  <a
                    key={pid}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="block w-16 h-16 rounded border border-slate-200 overflow-hidden bg-slate-100"
                  >
                    <img src={url} alt="issue photo" className="w-full h-full object-cover" loading="lazy" />
                  </a>
                );
              })}
            </div>
          )}
          <div className="text-xs text-slate-400 mt-1">{formatRelative(issue.created_at)}</div>
        </div>
        {!showResolve && (
          <button
            onClick={() => setShowResolve(true)}
            className="shrink-0 text-xs px-2 py-1 bg-emerald-700 text-white rounded"
          >Resolve</button>
        )}
      </div>
      {showResolve && (
        <div className="mt-2 pt-2 border-t flex gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Resolution note (required)"
            className="border rounded px-2 py-1 text-sm flex-1"
          />
          <button
            onClick={submit}
            disabled={submitting || !note.trim()}
            className="px-3 py-1 bg-emerald-700 text-white rounded text-sm disabled:opacity-40"
          >{submitting ? 'Saving…' : 'Save'}</button>
          <button
            onClick={() => { setShowResolve(false); setNote(''); }}
            className="text-sm text-slate-500"
          >Cancel</button>
        </div>
      )}
    </div>
  );
}

export function OpenIssuesPanel({ jobId }: Props) {
  const { open, photoUrls, resolve, loading } = useJobIssues(jobId);

  if (loading) return null;
  if (open.length === 0) return null;

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-slate-700 px-1">
        🚩 Open issues ({open.length})
      </h2>
      <div className="space-y-2">
        {open.map((i) => (
          <IssueRow key={i.issue_id} issue={i} photoUrls={photoUrls} onResolve={resolve} />
        ))}
      </div>
    </section>
  );
}

import type { JobStatus } from '../../types/production';

interface Props { status: JobStatus; }

const STYLES: Record<JobStatus, string> = {
  active: 'bg-emerald-100 text-emerald-700',
  blocked: 'bg-amber-100 text-amber-800 border border-amber-400',
  needs_office_review: 'bg-rose-100 text-rose-800',
  complete: 'bg-slate-200 text-slate-700',
};

const LABELS: Record<JobStatus, string> = {
  active: 'Active',
  blocked: 'Blocked',
  needs_office_review: 'Needs Review',
  complete: 'Complete',
};

export function StatusBadge({ status }: Props) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${STYLES[status]}`}>
      {LABELS[status]}
    </span>
  );
}

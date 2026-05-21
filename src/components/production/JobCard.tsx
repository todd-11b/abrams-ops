import { Link } from 'react-router-dom';
import { StatusBadge } from './StatusBadge';
import { StagePill } from './StagePill';
import type { Job } from '../../types/production';

interface Props { job: Job; openIssueCount?: number; }

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000);
}

export function JobCard({ job, openIssueCount = 0 }: Props) {
  const daysBlocked = job.blocked_at ? daysSince(job.blocked_at) ?? 0 : 0;
  const depositOverdue = job.deposit_status === 'unpaid'
    && (daysSince(job.created_at) ?? 0) >= 3;
  const unscheduledOverdue = !job.install_date
    && (daysSince(job.created_at) ?? 0) >= 5;

  const borderClass = job.status === 'blocked'
    ? 'border-amber-400 animate-pulse'
    : 'border-slate-200';

  return (
    <Link
      to={`/production/job/${job.job_id}`}
      className={`block rounded-lg border-2 ${borderClass} bg-white p-4 hover:shadow-md transition`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="font-semibold text-slate-900">{job.job_number}</span>
            <StatusBadge status={job.status} />
            <StagePill stage={job.stage} />
            {openIssueCount > 0 && (
              <span className="inline-block rounded-full bg-rose-100 text-rose-800 border border-rose-300 px-2 py-0.5 text-xs font-semibold">
                🚩 {openIssueCount} open
              </span>
            )}
          </div>
          <div className="text-sm text-slate-600">
            {job.install_date ? `Install: ${job.install_date}` : 'Unscheduled'}
            {job.scheduled_start_window && ` · ${job.scheduled_start_window.replace('_', ' ')}`}
          </div>
        </div>
        <div className="text-right text-xs text-slate-500">
          {job.status === 'blocked' && daysBlocked >= 3 && (
            <div className="text-amber-700 font-semibold">⚠ Blocked {daysBlocked}d</div>
          )}
          {depositOverdue && <div className="text-rose-700">Deposit unpaid</div>}
          {unscheduledOverdue && <div className="text-rose-700">No install date</div>}
          <div>Deposit: {job.deposit_status}</div>
        </div>
      </div>
    </Link>
  );
}

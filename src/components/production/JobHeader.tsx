import type { Job, JobFenceSpec } from '../../types/production';
import { StatusBadge } from './StatusBadge';
import { StagePill } from './StagePill';

interface Props { job: Job; spec: JobFenceSpec | null; address: string; customerName: string; }

export function JobHeader({ job, spec, address, customerName }: Props) {
  const mapsHref = `https://maps.google.com/?q=${encodeURIComponent(address)}`;
  const accessLines = Object.entries(job.access_notes ?? {})
    .filter(([, v]) => v !== '' && v !== null && v !== undefined)
    .map(([k, v]) => `${k}: ${String(v)}`);
  return (
    <div className="sticky top-0 z-10 bg-white border-b border-slate-200 p-3 space-y-1">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold">{customerName}</span>
        <StatusBadge status={job.status} />
        <StagePill stage={job.stage} />
      </div>
      <div className="text-sm">
        <a href={mapsHref} target="_blank" rel="noreferrer" className="text-blue-700 underline">
          {address || '(no address)'}
        </a>
      </div>
      <div className="text-xs text-slate-600 flex gap-3 flex-wrap">
        <span>{job.job_number}</span>
        {job.install_date && <span>Install: {job.install_date}</span>}
        {spec && <span>{spec.total_sections} sections · {spec.total_lf} LF</span>}
      </div>
      {accessLines.length > 0 && (
        <div className="text-xs text-amber-800 bg-amber-50 rounded p-2">
          {accessLines.map((l) => <div key={l}>⚠ {l}</div>)}
        </div>
      )}
    </div>
  );
}

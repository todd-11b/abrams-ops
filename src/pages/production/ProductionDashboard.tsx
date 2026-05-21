import { useMemo } from 'react';
import { useJobs } from '../../hooks/useJobs';
import { useOpenIssueCounts } from '../../hooks/useOpenIssueCounts';
import { JobCard } from '../../components/production/JobCard';
import { ViewToggle, useProductionView } from '../../components/production/ViewToggle';
import type { Job } from '../../types/production';

export default function ProductionDashboard() {
  const { jobs, loading, error } = useJobs();
  const { countsByJob } = useOpenIssueCounts();
  const [view, setView] = useProductionView();

  const sorted = useMemo<Job[]>(() => {
    const blocked = jobs.filter((j) => j.status === 'blocked');
    const rest = jobs.filter((j) => j.status !== 'blocked');
    blocked.sort((a, b) => (a.blocked_at ?? '').localeCompare(b.blocked_at ?? ''));
    rest.sort((a, b) => {
      if (!a.install_date && !b.install_date) return 0;
      if (!a.install_date) return 1;
      if (!b.install_date) return -1;
      return a.install_date.localeCompare(b.install_date);
    });
    return [...blocked, ...rest];
  }, [jobs]);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#0a1f3d]">Production</h1>
          <div className="text-xs text-slate-500">{sorted.length} active jobs</div>
        </div>
        <ViewToggle view={view} onChange={setView} />
      </header>

      <main className="p-4 md:p-6 space-y-3 max-w-3xl mx-auto">
        {loading && <div className="text-slate-500">Loading…</div>}
        {error && <div className="text-rose-700">{error}</div>}
        {!loading && sorted.length === 0 && (
          <div className="text-slate-500 text-center py-12">No active jobs yet.</div>
        )}
        {sorted.map((j) => <JobCard key={j.job_id} job={j} openIssueCount={countsByJob[j.job_id] ?? 0} />)}
      </main>
    </div>
  );
}

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { subscribeToRefresh } from '../lib/dataRefresh';

export function useOpenIssueCounts() {
  const [countsByJob, setCountsByJob] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('job_issues')
      .select('job_id')
      .eq('resolved', false);
    if (error) {
      console.error('[useOpenIssueCounts] load failed:', error);
      setCountsByJob({});
      return;
    }
    const next: Record<string, number> = {};
    for (const row of (data ?? []) as { job_id: string }[]) {
      next[row.job_id] = (next[row.job_id] ?? 0) + 1;
    }
    setCountsByJob(next);
  }, []);

  useEffect(() => {
    load();
    return subscribeToRefresh('job_issues', load);
  }, [load]);

  return { countsByJob, reload: load };
}

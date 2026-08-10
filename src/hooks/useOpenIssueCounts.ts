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
    let cancelled = false;
    let initialStarted = false;
    const refresh = () => {
      initialStarted = true;
      return load();
    };
    const start = async () => {
      await Promise.resolve();
      if (!cancelled && !initialStarted) await refresh();
    };
    void start();
    const unsubscribe = subscribeToRefresh('job_issues', refresh);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [load]);

  return { countsByJob, reload: load };
}

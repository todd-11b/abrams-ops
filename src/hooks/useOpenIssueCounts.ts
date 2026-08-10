import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { subscribeToRefresh } from '../lib/dataRefresh';

export function useOpenIssueCounts() {
  const [countsByJob, setCountsByJob] = useState<Record<string, number>>({});
  const active = useRef(true);
  const requestGeneration = useRef(0);

  const load = useCallback(async (isActive: () => boolean = () => true) => {
    if (!isActive()) return;
    const { data, error } = await supabase
      .from('job_issues')
      .select('job_id')
      .eq('resolved', false);
    if (!isActive()) return;
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
    active.current = true;
    const generation = requestGeneration;
    let effectActive = true;
    let initialStarted = false;
    const refresh = () => {
      initialStarted = true;
      const request = ++generation.current;
      return load(() => effectActive && active.current && request === generation.current);
    };
    const start = async () => {
      await Promise.resolve();
      if (effectActive && active.current && !initialStarted) await refresh();
    };
    void start();
    const unsubscribe = subscribeToRefresh('job_issues', refresh);
    return () => {
      effectActive = false;
      active.current = false;
      generation.current++;
      unsubscribe();
    };
  }, [load]);

  const reload = useCallback(() => {
    const request = ++requestGeneration.current;
    return load(() => active.current && request === requestGeneration.current);
  }, [load]);

  return { countsByJob, reload };
}

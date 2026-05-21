import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';

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
    const channel = supabase
      .channel('issue-counts')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_issues' }, load)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  return { countsByJob, reload: load };
}

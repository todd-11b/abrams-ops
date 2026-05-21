// src/hooks/useJobs.ts
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Job } from '../types/production';

export function useJobs() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('jobs')
      .select('*')
      .is('archived_at', null)
      .eq('deposit_status', 'paid')
      .order('install_date', { ascending: true, nullsFirst: false });
    if (error) {
      setError(error.message);
      setJobs([]);
    } else {
      setJobs((data ?? []) as Job[]);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel('jobs-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, load)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  return { jobs, loading, error, reload: load };
}

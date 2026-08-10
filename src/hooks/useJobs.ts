// src/hooks/useJobs.ts
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { subscribeToRefresh } from '../lib/dataRefresh';
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
      // Awaiting-deposit jobs are listed too, so a signed or invoiced job is
      // never invisible while it waits for payment.
      .in('deposit_status', ['paid', 'pending_invoice'])
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
    const timeoutId = window.setTimeout(load, 0);
    const unsubscribe = subscribeToRefresh('jobs', load);
    return () => {
      window.clearTimeout(timeoutId);
      unsubscribe();
    };
  }, [load]);

  return { jobs, loading, error, reload: load };
}

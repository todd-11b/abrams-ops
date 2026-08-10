// src/hooks/useJobs.ts
import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { subscribeToRefresh } from '../lib/dataRefresh';
import type { Job } from '../types/production';

export function useJobs() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true);
  const requestGeneration = useRef(0);

  const load = useCallback(async (isActive: () => boolean = () => true) => {
    if (!isActive()) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('jobs')
      .select('*')
      .is('archived_at', null)
      // Awaiting-deposit jobs are listed too, so a signed or invoiced job is
      // never invisible while it waits for payment.
      .in('deposit_status', ['paid', 'pending_invoice'])
      .order('install_date', { ascending: true, nullsFirst: false });
    if (!isActive()) return;
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
    const unsubscribe = subscribeToRefresh('jobs', refresh);
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

  return { jobs, loading, error, reload };
}

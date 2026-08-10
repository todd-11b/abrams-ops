// src/hooks/useJob.ts
import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { notifyRefresh, subscribeToRefresh } from '../lib/dataRefresh';
import { useActivityLog } from './useActivityLog';
import {
  syncStageScheduled,
  syncStageInInstall,
  syncStageJobComplete,
} from '../utils/ghlSync';
import type { Job, JobFenceSpec, JobStage, JobStatus } from '../types/production';

export function useJob(jobId: string | undefined) {
  const [job, setJob] = useState<Job | null>(null);
  const [spec, setSpec] = useState<JobFenceSpec | null>(null);
  const [loading, setLoading] = useState(Boolean(jobId));
  const [error, setError] = useState<string | null>(null);
  const active = useRef(true);
  const requestGeneration = useRef(0);
  const { append } = useActivityLog();

  const load = useCallback(async (isActive: () => boolean = () => true) => {
    if (!isActive()) return;
    if (!jobId) {
      setJob(null);
      setSpec(null);
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const [j, s] = await Promise.all([
      supabase.from('jobs').select('*').eq('job_id', jobId).maybeSingle(),
      supabase.from('job_fence_specs').select('*').eq('job_id', jobId).maybeSingle(),
    ]);
    if (!isActive()) return;
    if (j.error) { setError(j.error.message); setLoading(false); return; }
    setJob((j.data ?? null) as Job | null);
    setSpec((s.data ?? null) as JobFenceSpec | null);
    setError(null);
    setLoading(false);
  }, [jobId]);

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
    const unsubscribe = jobId ? subscribeToRefresh('jobs', refresh) : undefined;
    return () => {
      effectActive = false;
      active.current = false;
      generation.current++;
      unsubscribe?.();
    };
  }, [jobId, load]);

  const setStage = useCallback(async (stage: JobStage) => {
    if (!job) return;
    const { error } = await supabase
      .from('jobs')
      .update({ stage, last_activity_at: new Date().toISOString() })
      .eq('job_id', job.job_id);
    if (error) throw error;
    await append({ job_id: job.job_id, contact_id: job.contact_id, type: 'stage_change', payload: { to: stage, from: job.stage } });
    if (stage === 'scheduled') await syncStageScheduled(job);
    if (stage === 'in_install') await syncStageInInstall(job);
    if (stage === 'job_complete') await syncStageJobComplete(job);
    notifyRefresh('jobs');
  }, [job, append]);

  const block = useCallback(async (reason: string, note: string) => {
    if (!job) return;
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('jobs')
      .update({
        status: 'blocked' as JobStatus,
        blocked_reason: reason,
        blocked_note: note,
        blocked_at: now,
        last_activity_at: now,
      })
      .eq('job_id', job.job_id);
    if (error) throw error;
    await append({ job_id: job.job_id, contact_id: job.contact_id, type: 'job_blocked', payload: { reason, note } });
    notifyRefresh('jobs');
  }, [job, append]);

  const unblock = useCallback(async () => {
    if (!job) return;
    const { error } = await supabase
      .from('jobs')
      .update({ status: 'active', blocked_reason: null, blocked_note: null, blocked_at: null })
      .eq('job_id', job.job_id);
    if (error) throw error;
    await append({ job_id: job.job_id, contact_id: job.contact_id, type: 'job_unblocked' });
    notifyRefresh('jobs');
  }, [job, append]);

  const reload = useCallback(() => {
    const request = ++requestGeneration.current;
    return load(() => active.current && request === requestGeneration.current);
  }, [load]);

  return { job, spec, loading, error, reload, setStage, block, unblock };
}

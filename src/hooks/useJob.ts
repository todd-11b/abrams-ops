// src/hooks/useJob.ts
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useActivityLog } from './useActivityLog';
import {
  syncStageScheduled,
  syncStageInInstall,
  syncStageJobComplete,
  sendBlockSms,
} from '../utils/ghlSync';
import { shouldFireBlockNotification } from '../utils/notificationThrottle';
import type { Job, JobFenceSpec, JobStage, JobStatus } from '../types/production';

export function useJob(jobId: string | undefined) {
  const [job, setJob] = useState<Job | null>(null);
  const [spec, setSpec] = useState<JobFenceSpec | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { append } = useActivityLog();

  const load = useCallback(async () => {
    if (!jobId) return;
    setLoading(true);
    const [j, s] = await Promise.all([
      supabase.from('jobs').select('*').eq('job_id', jobId).maybeSingle(),
      supabase.from('job_fence_specs').select('*').eq('job_id', jobId).maybeSingle(),
    ]);
    if (j.error) { setError(j.error.message); setLoading(false); return; }
    setJob((j.data ?? null) as Job | null);
    setSpec((s.data ?? null) as JobFenceSpec | null);
    setError(null);
    setLoading(false);
  }, [jobId]);

  useEffect(() => {
    load();
    if (!jobId) return;
    const channel = supabase
      .channel(`job-${jobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs', filter: `job_id=eq.${jobId}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
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
  }, [job, append]);

  const unblock = useCallback(async () => {
    if (!job) return;
    const { error } = await supabase
      .from('jobs')
      .update({ status: 'active', blocked_reason: null, blocked_note: null, blocked_at: null })
      .eq('job_id', job.job_id);
    if (error) throw error;
    await append({ job_id: job.job_id, contact_id: job.contact_id, type: 'job_unblocked' });
  }, [job, append]);

  const checkBlockNotification = useCallback(async () => {
    if (!job || job.status !== 'blocked') return;
    if (!shouldFireBlockNotification(job.blocked_at, job.last_blocked_notification_at)) return;
    await sendBlockSms({
      jobNumber: job.job_number,
      customerName: '(see GHL)',
      reason: job.blocked_reason ?? 'unspecified',
      address: '(see GHL)',
      jobId: job.job_id,
    });
    await supabase
      .from('jobs')
      .update({ last_blocked_notification_at: new Date().toISOString() })
      .eq('job_id', job.job_id);
  }, [job]);

  return { job, spec, loading, error, reload: load, setStage, block, unblock, checkBlockNotification };
}

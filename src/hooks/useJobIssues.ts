import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useActivityLog } from './useActivityLog';
import type { JobIssue } from '../types/production';

export function useJobIssues(jobId: string | undefined) {
  const [issues, setIssues] = useState<JobIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const { append } = useActivityLog();

  const load = useCallback(async () => {
    if (!jobId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('job_issues')
      .select('*')
      .eq('job_id', jobId)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('[useJobIssues] load failed:', error);
      setIssues([]);
    } else {
      setIssues((data ?? []) as JobIssue[]);
    }
    setLoading(false);
  }, [jobId]);

  useEffect(() => {
    load();
    if (!jobId) return;
    const channel = supabase
      .channel(`issues-${jobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'job_issues', filter: `job_id=eq.${jobId}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [jobId, load]);

  const resolve = useCallback(async (issueId: string, resolutionNote: string) => {
    const { error } = await supabase
      .from('job_issues')
      .update({
        resolved: true,
        resolved_at: new Date().toISOString(),
        resolution_note: resolutionNote,
      })
      .eq('issue_id', issueId);
    if (error) throw error;
    await append({ job_id: jobId ?? null, type: 'issue_resolved', payload: { issue_id: issueId, resolution_note: resolutionNote } });
  }, [jobId, append]);

  const open = issues.filter((i) => !i.resolved);
  const resolved = issues.filter((i) => i.resolved);

  return { issues, open, resolved, loading, resolve, reload: load };
}

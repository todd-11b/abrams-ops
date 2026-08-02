// src/hooks/useIssue.ts
import { useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { notifyRefresh } from '../lib/dataRefresh';
import { useActivityLog } from './useActivityLog';
import { sendOwnerAlert } from '../utils/ghlSync';
import { getStoredActor } from '../utils/actor';
import type {
  IssueType,
  IssueSeverity,
  ChecklistSectionKey,
  JobIssue,
} from '../types/production';

interface CreateIssueInput {
  job_id: string;
  contact_id: string;
  type: IssueType;
  severity: IssueSeverity;
  note: string;
  photos: string[];
  section: ChecklistSectionKey | null;
}

export interface CreateIssueResult {
  issue: JobIssue;
  /** Set when the issue was recorded but the owner alert could not be delivered. */
  alertError: string | null;
}

export function useIssue() {
  const { append } = useActivityLog();

  const create = useCallback(async (input: CreateIssueInput): Promise<CreateIssueResult> => {
    let severity = input.severity;
    let customer_visible = false;
    if (input.type === 'customer_concern') {
      if (severity === 'low') severity = 'medium';
      customer_visible = true;
    }
    if ((input.type === 'sprinkler_hit' || input.type === 'utility_conflict') && input.photos.length === 0) {
      throw new Error('Photo required for sprinkler hits and utility conflicts');
    }

    const { data, error } = await supabase
      .from('job_issues')
      .insert({
        job_id: input.job_id,
        contact_id: input.contact_id,
        type: input.type,
        severity,
        customer_visible,
        note: input.note,
        photos: input.photos,
        section: input.section,
        created_by: getStoredActor(),
      })
      .select('*')
      .single();
    if (error) throw error;
    await append({
      job_id: input.job_id,
      contact_id: input.contact_id,
      type: 'issue_flagged',
      payload: { issue_id: (data as JobIssue).issue_id, type: input.type, severity, section: input.section },
    });
    const issue = data as JobIssue;
    let alertError: string | null = null;
    if (severity === 'high') {
      try {
        await sendOwnerAlert({ kind: 'issue_high', jobId: input.job_id, issueId: issue.issue_id });
      } catch (err) {
        alertError = err instanceof Error ? err.message : 'Owner alert failed';
      }
    }
    notifyRefresh('job_issues');
    return { issue, alertError };
  }, [append]);

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
    await append({ type: 'issue_resolved', payload: { issue_id: issueId } });
    notifyRefresh('job_issues');
  }, [append]);

  return { create, resolve };
}

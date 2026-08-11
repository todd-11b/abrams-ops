// src/utils/ghlSync.ts
import { crmApi } from '../lib/crm-api';
import { operatorFetch } from './actor';
import type { Job } from '../types/production';

interface JobWithOpp {
  proposal_id: string | null;
  production_opportunity_id: string | null;
  opportunity_contract: 'legacy_single_v1' | 'separate_v1';
  contact_id: string;
}

function stageOpportunity(job: JobWithOpp): string | null {
  if (job.opportunity_contract === 'separate_v1') return job.production_opportunity_id;
  if (job.opportunity_contract === 'legacy_single_v1') return job.proposal_id;
  return null;
}

async function moveStage(opportunityId: string | null, stage: 'job_created' | 'scheduled' | 'in_install' | 'job_complete', label: string) {
  if (!opportunityId) {
    console.warn(`[ghlSync] ${label}: no opportunityId, skipping stage move`);
    return;
  }
  try {
    await crmApi.moveOpportunityToStage(opportunityId, stage);
  } catch (err) {
    console.error(`[ghlSync] ${label} failed:`, err);
    // Swallow — never roll back Supabase. Hooks may schedule retry.
  }
}

export async function syncStageJobCreated(job: JobWithOpp) {
  await moveStage(stageOpportunity(job), 'job_created', 'syncStageJobCreated');
}
export async function syncStageScheduled(job: JobWithOpp) {
  await moveStage(stageOpportunity(job), 'scheduled', 'syncStageScheduled');
}
export async function syncStageInInstall(job: JobWithOpp) {
  await moveStage(stageOpportunity(job), 'in_install', 'syncStageInInstall');
}
export async function syncStageJobComplete(job: JobWithOpp) {
  await moveStage(stageOpportunity(job), 'job_complete', 'syncStageJobComplete');
}

export type OwnerAlert =
  | { kind: 'job_blocked'; jobId: string }
  | { kind: 'issue_high'; jobId: string; issueId: string };

/**
 * The server composes and sends the alert from stored job data, so delivery no
 * longer depends on the signed-in operator's CRM messaging scope. Failures
 * reject: callers surface them rather than dropping an owner alert.
 */
export async function sendOwnerAlert(alert: OwnerAlert): Promise<void> {
  const response = await operatorFetch('/api/operator/alerts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: alert.kind,
      job_id: alert.jobId,
      ...(alert.kind === 'issue_high' ? { issue_id: alert.issueId } : {}),
    }),
  });
  if (!response.ok) throw new Error(`Owner alert failed (${response.status})`);
}

export type { Job };

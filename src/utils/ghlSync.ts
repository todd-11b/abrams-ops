// src/utils/ghlSync.ts
import { crmApi } from '../lib/crm-api';
import { productionEnv } from '../lib/env';
import type { Job } from '../types/production';

interface JobWithOpp { proposal_id: string | null; contact_id: string; }

async function moveStage(opportunityId: string | null, stageId: string, label: string) {
  if (!opportunityId) {
    console.warn(`[ghlSync] ${label}: no opportunityId, skipping stage move`);
    return;
  }
  try {
    await crmApi.moveOpportunityToStage(opportunityId, stageId);
  } catch (err) {
    console.error(`[ghlSync] ${label} failed:`, err);
    // Swallow — never roll back Supabase. Hooks may schedule retry.
  }
}

export async function syncStageJobCreated(job: JobWithOpp) {
  await moveStage(job.proposal_id, productionEnv.stages.job_created, 'syncStageJobCreated');
}
export async function syncStageScheduled(job: JobWithOpp) {
  await moveStage(job.proposal_id, productionEnv.stages.scheduled, 'syncStageScheduled');
}
export async function syncStageInInstall(job: JobWithOpp) {
  await moveStage(job.proposal_id, productionEnv.stages.in_install, 'syncStageInInstall');
}
export async function syncStageJobComplete(job: JobWithOpp) {
  await moveStage(job.proposal_id, productionEnv.stages.job_complete, 'syncStageJobComplete');
}

export interface BlockSmsContext {
  jobNumber: string;
  customerName: string;
  reason: string;
  address: string;
  jobId: string;
}

export async function sendBlockSms(ctx: BlockSmsContext) {
  const body =
    `🚨 ABRAMS ALERT\n` +
    `Job: ${ctx.jobNumber} — ${ctx.customerName}\n` +
    `Reason: ${ctx.reason}\n` +
    `Address: ${ctx.address}\n` +
    `Open: abramsfence.com/production/job/${ctx.jobId}`;
  try {
    await crmApi.sendSms(productionEnv.toddPhone, body);
  } catch (err) {
    console.error('[ghlSync] sendBlockSms failed:', err);
  }
}

export interface IssueSmsContext {
  jobNumber: string;
  customerName: string;
  issueType: string;
  address: string;
  jobId: string;
}

export async function sendHighSeverityIssueSms(ctx: IssueSmsContext) {
  const body =
    `🚨 ABRAMS ALERT\n` +
    `Job: ${ctx.jobNumber} — ${ctx.customerName}\n` +
    `Reason: ${ctx.issueType}\n` +
    `Address: ${ctx.address}\n` +
    `Open: abramsfence.com/production/job/${ctx.jobId}`;
  try {
    await crmApi.sendSms(productionEnv.toddPhone, body);
  } catch (err) {
    console.error('[ghlSync] sendHighSeverityIssueSms failed:', err);
  }
}

export type { Job };

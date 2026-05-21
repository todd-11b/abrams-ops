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

async function resolveContactCard(contactId: string): Promise<{ name: string; address: string }> {
  try {
    const resp = await crmApi.getContact(contactId);
    const c = (resp as { contact?: { firstName?: string; lastName?: string; address1?: string } }).contact ?? {};
    const name = `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || '(no name)';
    const address = c.address1 || '(no address)';
    return { name, address };
  } catch (err) {
    console.error('[ghlSync] resolveContactCard failed:', err);
    return { name: '(name unavailable)', address: '(address unavailable)' };
  }
}

export interface BlockSmsContext {
  jobNumber: string;
  contactId: string;
  reason: string;
  jobId: string;
}

export async function sendBlockSms(ctx: BlockSmsContext) {
  const { name, address } = await resolveContactCard(ctx.contactId);
  const body =
    `🚨 ABRAMS ALERT\n` +
    `Job: ${ctx.jobNumber} — ${name}\n` +
    `Reason: ${ctx.reason}\n` +
    `Address: ${address}\n` +
    `Open: abramsfence.com/production/job/${ctx.jobId}`;
  try {
    await crmApi.sendSms(productionEnv.toddContactId, body);
  } catch (err) {
    console.error('[ghlSync] sendBlockSms failed:', err);
  }
}

export interface IssueSmsContext {
  jobNumber: string;
  contactId: string;
  issueType: string;
  jobId: string;
}

export async function sendHighSeverityIssueSms(ctx: IssueSmsContext) {
  const { name, address } = await resolveContactCard(ctx.contactId);
  const body =
    `🚨 ABRAMS ALERT\n` +
    `Job: ${ctx.jobNumber} — ${name}\n` +
    `Reason: ${ctx.issueType}\n` +
    `Address: ${address}\n` +
    `Open: abramsfence.com/production/job/${ctx.jobId}`;
  try {
    await crmApi.sendSms(productionEnv.toddContactId, body);
  } catch (err) {
    console.error('[ghlSync] sendHighSeverityIssueSms failed:', err);
  }
}

export type { Job };

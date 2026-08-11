import { beforeEach, describe, expect, it, vi } from 'vitest';

const moveOpportunityToStage = vi.hoisted(() => vi.fn());
vi.mock('../lib/crm-api', () => ({ crmApi: { moveOpportunityToStage } }));
vi.mock('../lib/env', () => ({
  productionEnv: { stages: { job_created: 'created', scheduled: 'scheduled', in_install: 'install', job_complete: 'complete' } },
}));

import { syncStageInInstall, syncStageJobComplete, syncStageJobCreated, syncStageScheduled } from './ghlSync';

const base = { contact_id: 'contact-1', proposal_id: 'sales-opp' };

beforeEach(() => { moveOpportunityToStage.mockReset().mockResolvedValue({}); });

describe('job stage opportunity routing', () => {
  it('routes every new lifecycle stage to the Production opportunity only', async () => {
    const job = { ...base, production_opportunity_id: 'production-opp', opportunity_contract: 'separate_v1' as const };
    await syncStageJobCreated(job);
    await syncStageScheduled(job);
    await syncStageInInstall(job);
    await syncStageJobComplete(job);
    expect(moveOpportunityToStage.mock.calls).toEqual([
      ['production-opp', 'job_created'], ['production-opp', 'scheduled'], ['production-opp', 'in_install'], ['production-opp', 'job_complete'],
    ]);
    expect(moveOpportunityToStage.mock.calls.flat()).not.toContain('sales-opp');
  });

  it('preserves explicit legacy one-ID behavior without reclassifying it', async () => {
    await syncStageScheduled({ ...base, production_opportunity_id: null, opportunity_contract: 'legacy_single_v1' });
    expect(moveOpportunityToStage).toHaveBeenCalledWith('sales-opp', 'scheduled');
  });

  it('fails closed when a separated job has no Production ID', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await syncStageInInstall({ ...base, production_opportunity_id: null, opportunity_contract: 'separate_v1' });
    expect(moveOpportunityToStage).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('no opportunityId'));
  });
});

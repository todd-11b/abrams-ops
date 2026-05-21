import { describe, it, expect } from 'vitest';
import { validateProductionEnv } from './env';

describe('validateProductionEnv', () => {
  it('throws when pipeline id is missing', () => {
    expect(() =>
      validateProductionEnv({
        VITE_GHL_FENCE_PRODUCTION_PIPELINE_ID: '',
        VITE_GHL_STAGE_JOB_CREATED: 's1',
        VITE_GHL_STAGE_SCHEDULED: 's2',
        VITE_GHL_STAGE_IN_INSTALL: 's3',
        VITE_GHL_STAGE_JOB_COMPLETE: 's4',
        VITE_GHL_TODD_PHONE: '+18168256198',
      })
    ).toThrow(/VITE_GHL_FENCE_PRODUCTION_PIPELINE_ID/);
  });

  it('throws when phone is not in E.164 format', () => {
    expect(() =>
      validateProductionEnv({
        VITE_GHL_FENCE_PRODUCTION_PIPELINE_ID: 'p1',
        VITE_GHL_STAGE_JOB_CREATED: 's1',
        VITE_GHL_STAGE_SCHEDULED: 's2',
        VITE_GHL_STAGE_IN_INSTALL: 's3',
        VITE_GHL_STAGE_JOB_COMPLETE: 's4',
        VITE_GHL_TODD_PHONE: '8168256198',
      })
    ).toThrow(/E\.164/);
  });

  it('returns config object when all vars present and valid', () => {
    const cfg = validateProductionEnv({
      VITE_GHL_FENCE_PRODUCTION_PIPELINE_ID: 'p1',
      VITE_GHL_STAGE_JOB_CREATED: 's1',
      VITE_GHL_STAGE_SCHEDULED: 's2',
      VITE_GHL_STAGE_IN_INSTALL: 's3',
      VITE_GHL_STAGE_JOB_COMPLETE: 's4',
      VITE_GHL_TODD_PHONE: '+18168256198',
    });
    expect(cfg.pipelineId).toBe('p1');
    expect(cfg.stages.job_created).toBe('s1');
    expect(cfg.toddPhone).toBe('+18168256198');
  });

  it('throws when a required var is whitespace-only', () => {
    expect(() =>
      validateProductionEnv({
        VITE_GHL_FENCE_PRODUCTION_PIPELINE_ID: '   ',
        VITE_GHL_STAGE_JOB_CREATED: 's1',
        VITE_GHL_STAGE_SCHEDULED: 's2',
        VITE_GHL_STAGE_IN_INSTALL: 's3',
        VITE_GHL_STAGE_JOB_COMPLETE: 's4',
        VITE_GHL_TODD_PHONE: '+18168256198',
      })
    ).toThrow(/VITE_GHL_FENCE_PRODUCTION_PIPELINE_ID/);
  });
});

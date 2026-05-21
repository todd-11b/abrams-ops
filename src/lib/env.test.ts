import { describe, it, expect } from 'vitest';
import { validateProductionEnv } from './env';

const VALID = {
  VITE_GHL_FENCE_PRODUCTION_PIPELINE_ID: 'p1',
  VITE_GHL_STAGE_JOB_CREATED: 's1',
  VITE_GHL_STAGE_SCHEDULED: 's2',
  VITE_GHL_STAGE_IN_INSTALL: 's3',
  VITE_GHL_STAGE_JOB_COMPLETE: 's4',
  VITE_GHL_TODD_CONTACT_ID: 'Z3OW0NMGj3sk93ofJuVq',
};

describe('validateProductionEnv', () => {
  it('throws when pipeline id is missing', () => {
    expect(() =>
      validateProductionEnv({ ...VALID, VITE_GHL_FENCE_PRODUCTION_PIPELINE_ID: '' })
    ).toThrow(/VITE_GHL_FENCE_PRODUCTION_PIPELINE_ID/);
  });

  it('throws when contact id has unsupported characters', () => {
    expect(() =>
      validateProductionEnv({ ...VALID, VITE_GHL_TODD_CONTACT_ID: 'bad id with spaces' })
    ).toThrow(/contact id/);
  });

  it('throws when contact id is too short', () => {
    expect(() =>
      validateProductionEnv({ ...VALID, VITE_GHL_TODD_CONTACT_ID: 'short' })
    ).toThrow(/contact id/);
  });

  it('returns config object when all vars present and valid', () => {
    const cfg = validateProductionEnv(VALID);
    expect(cfg.pipelineId).toBe('p1');
    expect(cfg.stages.job_created).toBe('s1');
    expect(cfg.toddContactId).toBe('Z3OW0NMGj3sk93ofJuVq');
  });

  it('throws when a required var is whitespace-only', () => {
    expect(() =>
      validateProductionEnv({ ...VALID, VITE_GHL_FENCE_PRODUCTION_PIPELINE_ID: '   ' })
    ).toThrow(/VITE_GHL_FENCE_PRODUCTION_PIPELINE_ID/);
  });
});

export interface ProductionEnvConfig {
  pipelineId: string;
  stages: {
    job_created: string;
    scheduled: string;
    in_install: string;
    job_complete: string;
  };
  toddPhone: string;
}

interface RawEnv {
  VITE_GHL_FENCE_PRODUCTION_PIPELINE_ID?: string;
  VITE_GHL_STAGE_JOB_CREATED?: string;
  VITE_GHL_STAGE_SCHEDULED?: string;
  VITE_GHL_STAGE_IN_INSTALL?: string;
  VITE_GHL_STAGE_JOB_COMPLETE?: string;
  VITE_GHL_TODD_PHONE?: string;
}

const REQUIRED_KEYS: Array<keyof RawEnv> = [
  'VITE_GHL_FENCE_PRODUCTION_PIPELINE_ID',
  'VITE_GHL_STAGE_JOB_CREATED',
  'VITE_GHL_STAGE_SCHEDULED',
  'VITE_GHL_STAGE_IN_INSTALL',
  'VITE_GHL_STAGE_JOB_COMPLETE',
  'VITE_GHL_TODD_PHONE',
];

export function validateProductionEnv(env: RawEnv): ProductionEnvConfig {
  const missing = REQUIRED_KEYS.filter((k) => !env[k] || !env[k]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Missing required production env vars: ${missing.join(', ')}. ` +
        `Run \`vercel env pull .env.local\` and restart the dev server.`
    );
  }
  if (!/^\+\d{8,15}$/.test(env.VITE_GHL_TODD_PHONE!)) {
    throw new Error(
      `VITE_GHL_TODD_PHONE must be E.164 format (e.g. +18168256198). Got: ${env.VITE_GHL_TODD_PHONE}`
    );
  }
  return {
    pipelineId: env.VITE_GHL_FENCE_PRODUCTION_PIPELINE_ID!,
    stages: {
      job_created: env.VITE_GHL_STAGE_JOB_CREATED!,
      scheduled: env.VITE_GHL_STAGE_SCHEDULED!,
      in_install: env.VITE_GHL_STAGE_IN_INSTALL!,
      job_complete: env.VITE_GHL_STAGE_JOB_COMPLETE!,
    },
    toddPhone: env.VITE_GHL_TODD_PHONE!,
  };
}

export const productionEnv = validateProductionEnv(
  import.meta.env as unknown as RawEnv
);

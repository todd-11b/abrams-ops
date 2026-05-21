export interface ProductionEnvConfig {
  pipelineId: string;
  stages: {
    job_created: string;
    scheduled: string;
    in_install: string;
    job_complete: string;
  };
  toddContactId: string;
}

interface RawEnv extends Record<string, string | undefined> {
  VITE_GHL_FENCE_PRODUCTION_PIPELINE_ID?: string;
  VITE_GHL_STAGE_JOB_CREATED?: string;
  VITE_GHL_STAGE_SCHEDULED?: string;
  VITE_GHL_STAGE_IN_INSTALL?: string;
  VITE_GHL_STAGE_JOB_COMPLETE?: string;
  VITE_GHL_TODD_CONTACT_ID?: string;
}

const REQUIRED_KEYS: Array<keyof RawEnv> = [
  'VITE_GHL_FENCE_PRODUCTION_PIPELINE_ID',
  'VITE_GHL_STAGE_JOB_CREATED',
  'VITE_GHL_STAGE_SCHEDULED',
  'VITE_GHL_STAGE_IN_INSTALL',
  'VITE_GHL_STAGE_JOB_COMPLETE',
  'VITE_GHL_TODD_CONTACT_ID',
];

export function validateProductionEnv(env: RawEnv): ProductionEnvConfig {
  const missing = REQUIRED_KEYS.filter((k) => !env[k] || !env[k]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Missing required production env vars: ${missing.join(', ')}. ` +
        `Run \`vercel env pull .env.local\` and restart the dev server.`
    );
  }
  // GHL v2 contact IDs are short alphanumeric tokens (e.g. Z3OW0NMGj3sk93ofJuVq).
  if (!/^[A-Za-z0-9]{16,32}$/.test(env.VITE_GHL_TODD_CONTACT_ID!)) {
    throw new Error(
      `VITE_GHL_TODD_CONTACT_ID must be a GHL contact id (alphanumeric, 16–32 chars). Got: ${env.VITE_GHL_TODD_CONTACT_ID}`
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
    toddContactId: env.VITE_GHL_TODD_CONTACT_ID!,
  };
}

export const productionEnv = validateProductionEnv(
  import.meta.env as RawEnv
);

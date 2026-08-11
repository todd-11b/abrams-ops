import { supabaseRequest } from './server-data';

const GHL_BASE = 'https://services.leadconnectorhq.com';
const ID = /^[A-Za-z0-9_-]{1,100}$/;

interface PipelineStage { id?: string }
interface Pipeline { id?: string; stages?: PipelineStage[] }
interface Opportunity {
  id?: string;
  contactId?: string;
  pipelineId?: string;
  pipelineStageId?: string;
  name?: string;
}

interface ProductionConfig {
  apiKey: string;
  locationId: string;
  salesPipelineId: string;
  productionPipelineId: string;
  productionStageId: string;
  productionStages: Record<ProductionStage, string>;
}

export type ProductionStage = 'job_created' | 'scheduled' | 'in_install' | 'job_complete';

interface ClaimRow {
  claim_status: 'ready' | 'busy' | 'claimed' | 'reconcile';
  production_opportunity_id: string | null;
  create_attempted: boolean;
}

export class ProductionOpportunityError extends Error {
  constructor(message: string, readonly status = 502) { super(message); }
}

function requiredId(name: string): string {
  const value = process.env[name]?.trim() ?? '';
  if (!ID.test(value)) throw new ProductionOpportunityError(`missing or invalid ${name}`, 500);
  return value;
}

function readConfig(): ProductionConfig {
  const productionStages: Record<ProductionStage, string> = {
    job_created: requiredId('GHL_STAGE_JOB_CREATED'),
    scheduled: requiredId('GHL_STAGE_SCHEDULED'),
    in_install: requiredId('GHL_STAGE_IN_INSTALL'),
    job_complete: requiredId('GHL_STAGE_JOB_COMPLETE'),
  };
  const config = {
    apiKey: process.env.GHL_API_KEY?.trim() ?? '',
    locationId: requiredId('GHL_LOCATION_ID'),
    salesPipelineId: requiredId('GHL_SALES_PIPELINE_ID'),
    productionPipelineId: requiredId('GHL_PRODUCTION_PIPELINE_ID'),
    productionStageId: productionStages.job_created,
    productionStages,
  };
  if (!config.apiKey) throw new ProductionOpportunityError('missing GHL_API_KEY', 500);
  if (config.salesPipelineId === config.productionPipelineId) {
    throw new ProductionOpportunityError('Sales and Production pipelines must be distinct', 500);
  }
  const publicStages: Record<ProductionStage, string> = {
    job_created: process.env.VITE_GHL_STAGE_JOB_CREATED?.trim() ?? '',
    scheduled: process.env.VITE_GHL_STAGE_SCHEDULED?.trim() ?? '',
    in_install: process.env.VITE_GHL_STAGE_IN_INSTALL?.trim() ?? '',
    job_complete: process.env.VITE_GHL_STAGE_JOB_COMPLETE?.trim() ?? '',
  };
  if ((process.env.VITE_GHL_FENCE_PRODUCTION_PIPELINE_ID?.trim() ?? '') !== config.productionPipelineId ||
      Object.entries(publicStages).some(([stage, id]) => id !== config.productionStages[stage as ProductionStage])) {
    throw new ProductionOpportunityError('server and browser Production routing do not match', 500);
  }
  return config;
}

function ghlHeaders(apiKey: string, version = '2021-07-28') {
  return { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Version: version };
}

async function validatePipelineParentage(config: ProductionConfig): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${GHL_BASE}/opportunities/pipelines?locationId=${encodeURIComponent(config.locationId)}`, {
      headers: ghlHeaders(config.apiKey),
    });
  } catch {
    throw new ProductionOpportunityError('could not validate CRM pipeline configuration');
  }
  if (!response.ok) throw new ProductionOpportunityError('could not validate CRM pipeline configuration');
  const payload = await response.json().catch(() => null) as { pipelines?: Pipeline[] } | null;
  const sales = payload?.pipelines?.find((pipeline) => pipeline.id === config.salesPipelineId);
  const production = payload?.pipelines?.find((pipeline) => pipeline.id === config.productionPipelineId);
  if (!sales) throw new ProductionOpportunityError('configured Sales pipeline does not exist', 500);
  const productionStageIds = new Set(production?.stages?.map((stage) => stage.id).filter(Boolean));
  if (!production || Object.values(config.productionStages).some((stageId) => !productionStageIds.has(stageId))) {
    throw new ProductionOpportunityError('a configured Production stage is not in the Production pipeline', 500);
  }
}

export function productionStageRouting(stage: ProductionStage): string {
  return readConfig().productionStages[stage];
}

function deterministicName(salesOpportunityId: string): string {
  return `[ABRAMS-PRODUCTION:${salesOpportunityId}]`;
}

async function exactMatches(config: ProductionConfig, contactId: string, salesOpportunityId: string): Promise<Opportunity[]> {
  const name = deterministicName(salesOpportunityId);
  const query = new URLSearchParams({
    locationId: config.locationId,
    contactId,
    pipelineId: config.productionPipelineId,
    query: name,
    limit: '100',
  });
  let response: Response;
  try {
    response = await fetch(`${GHL_BASE}/opportunities/search?${query}`, { headers: ghlHeaders(config.apiKey, 'v3') });
  } catch {
    throw new ProductionOpportunityError('could not reconcile Production opportunity');
  }
  if (!response.ok) throw new ProductionOpportunityError('could not reconcile Production opportunity');
  const payload = await response.json().catch(() => null) as { opportunities?: Opportunity[] } | null;
  return (payload?.opportunities ?? []).filter((opportunity) =>
    ID.test(opportunity.id ?? '') &&
    opportunity.contactId === contactId &&
    opportunity.pipelineId === config.productionPipelineId &&
    opportunity.name === name
  );
}

async function rpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const response = await supabaseRequest(`rpc/${name}`, { method: 'POST', body: JSON.stringify(body) });
  if (!response.ok) throw new ProductionOpportunityError(`Production opportunity ${name} failed`);
  return response.json() as Promise<T>;
}

async function finalize(salesOpportunityId: string, leaseToken: string, productionOpportunityId: string): Promise<string> {
  return rpc<string>('finalize_production_opportunity', {
    p_sales_opportunity_id: salesOpportunityId,
    p_lease_token: leaseToken,
    p_production_opportunity_id: productionOpportunityId,
  });
}

export async function ensureProductionOpportunity(input: {
  contactId: string;
  salesOpportunityId: string;
  monetaryValue?: number;
}): Promise<string> {
  if (!ID.test(input.contactId) || !ID.test(input.salesOpportunityId)) {
    throw new ProductionOpportunityError('invalid Sales opportunity provenance', 400);
  }
  const config = readConfig();
  await validatePipelineParentage(config);
  const leaseToken = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('');
  const name = deterministicName(input.salesOpportunityId);
  const [claim] = await rpc<ClaimRow[]>('claim_production_opportunity', {
    p_sales_opportunity_id: input.salesOpportunityId,
    p_contact_id: input.contactId,
    p_production_pipeline_id: config.productionPipelineId,
    p_production_stage_id: config.productionStageId,
    p_deterministic_name: name,
    p_lease_token: leaseToken,
  });
  if (!claim) throw new ProductionOpportunityError('Production opportunity claim returned no result');
  if (claim.claim_status === 'ready' && ID.test(claim.production_opportunity_id ?? '')) {
    return claim.production_opportunity_id!;
  }
  if (claim.claim_status === 'busy') throw new ProductionOpportunityError('Production opportunity creation is already in progress', 409);

  const existing = await exactMatches(config, input.contactId, input.salesOpportunityId);
  if (existing.length > 1) throw new ProductionOpportunityError('multiple matching Production opportunities require manual reconciliation', 409);
  if (existing.length === 1) return finalize(input.salesOpportunityId, leaseToken, existing[0].id!);
  if (claim.claim_status === 'reconcile' || claim.create_attempted) {
    throw new ProductionOpportunityError('Production opportunity creation outcome is still ambiguous; retry reconciliation later', 409);
  }

  const attempted = await rpc<boolean>('mark_production_opportunity_attempted', {
    p_sales_opportunity_id: input.salesOpportunityId,
    p_lease_token: leaseToken,
  });
  if (!attempted) throw new ProductionOpportunityError('Production opportunity claim expired before creation', 409);

  let created: Response;
  try {
    created = await fetch(`${GHL_BASE}/opportunities/`, {
      method: 'POST',
      headers: ghlHeaders(config.apiKey),
      body: JSON.stringify({
        pipelineId: config.productionPipelineId,
        pipelineStageId: config.productionStageId,
        locationId: config.locationId,
        contactId: input.contactId,
        name,
        status: 'open',
        ...(input.monetaryValue === undefined ? {} : { monetaryValue: input.monetaryValue }),
      }),
    });
  } catch {
    throw new ProductionOpportunityError('Production opportunity create outcome is ambiguous; retry reconciliation later', 409);
  }
  if (!created.ok) {
    throw new ProductionOpportunityError(`Production opportunity create returned HTTP ${created.status}; reconciliation required`, 409);
  }
  const payload = await created.json().catch(() => null) as { opportunity?: Opportunity; id?: string } | null;
  const createdId = payload?.opportunity?.id ?? payload?.id;
  if (ID.test(createdId ?? '')) return finalize(input.salesOpportunityId, leaseToken, createdId!);

  const afterCreate = await exactMatches(config, input.contactId, input.salesOpportunityId);
  if (afterCreate.length === 1) return finalize(input.salesOpportunityId, leaseToken, afterCreate[0].id!);
  throw new ProductionOpportunityError('Production opportunity was created but could not be reconciled', 409);
}

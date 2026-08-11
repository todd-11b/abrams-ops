import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const requiredServer = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'GHL_API_KEY',
  'GHL_LOCATION_ID',
  'GHL_WEBHOOK_SECRET',
  'GHL_TODD_CONTACT_ID',
  'GHL_STAGE_JOB_CREATED',
  'GHL_STAGE_JOB_COMPLETE',
  'OPERATOR_SESSION_SECRET',
  'OPERATOR_TODD_PIN',
  'OPERATOR_TY_PIN',
  'OPERATOR_RATE_LIMIT_PEPPER',
  'CRON_SECRET',
];
const optionalServer = [
  'OPERATOR_SESSION_VERSION',
  'GHL_APP_SHARED_SECRET',
  'GHL_SSO_TODD_USER_ID',
  'GHL_SSO_TY_USER_ID',
  'GHL_OUTBOUND_IP_PREFIXES',
  'GHL_SALES_PIPELINE_ID',
  'GHL_SALES_PIPELINE_STAGE_ID',
  'GHL_BUSINESS_NAME',
];
const requiredPublic = [
  'VITE_GHL_FENCE_PRODUCTION_PIPELINE_ID',
  'VITE_GHL_STAGE_JOB_CREATED',
  'VITE_GHL_STAGE_SCHEDULED',
  'VITE_GHL_STAGE_IN_INSTALL',
  'VITE_GHL_STAGE_JOB_COMPLETE',
  'VITE_GHL_TODD_CONTACT_ID',
];
const obsoleteBrowser = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_GHL_API_KEY',
  'VITE_GHL_LOCATION_ID',
  'VITE_STRIPE_PUBLISHABLE_KEY',
];

const envExample = fs.readFileSync('.env.example', 'utf8');
const assignments = [...envExample.matchAll(/^([A-Z][A-Z0-9_]*)=(.*)$/gm)];
const actualNames = assignments.map((match) => match[1]);
const expectedNames = [...requiredPublic, ...requiredServer, ...optionalServer];
if (new Set(actualNames).size !== actualNames.length) throw new Error('.env.example contains duplicate names');
if (actualNames.length !== expectedNames.length || expectedNames.some((name) => !actualNames.includes(name))) {
  throw new Error('.env.example names do not match the source contract');
}
if (assignments.some((match) => match[2] !== '')) throw new Error('.env.example must not contain example values');
if (obsoleteBrowser.some((name) => envExample.includes(name))) throw new Error('.env.example contains obsolete browser variables');
if (!envExample.includes('must be distinct') || !envExample.includes('exactly four ASCII digits')) throw new Error('.env.example PIN contract is missing');
if (!envExample.includes('Client-public routing (browser-exposed, required)') ||
    !envExample.includes('Server-only secrets (required; never browser-exposed)') ||
    !envExample.includes('Server-only configuration (required)') ||
    !envExample.includes('Server-only configuration (optional/defaulted)')) {
  throw new Error('.env.example classification headings are missing');
}

const formerContactIdentifier = process.env.FORMER_GHL_CONTACT_ID;
if (formerContactIdentifier) {
  const trackedPaths = execFileSync('git', ['ls-files', '-z'])
    .toString()
    .split('\0')
    .filter(Boolean);
  const identifier = Buffer.from(formerContactIdentifier);
  if (trackedPaths.some((file) => fs.readFileSync(file).includes(identifier))) {
    throw new Error('former GHL contact identifier remains in the tracked tree');
  }
}

const historicalPins = [process.env.HISTORICAL_OPERATOR_PIN_1, process.env.HISTORICAL_OPERATOR_PIN_2].filter(Boolean);
if (historicalPins.length > 0 && historicalPins.length !== 2) throw new Error('both historical PIN candidates are required for the transient scan');
if (historicalPins.length === 2) {
  const candidates = historicalPins.map((value) => Buffer.from(value));
  const trackedPaths = execFileSync('git', ['ls-files', '-z']).toString().split('\0').filter(Boolean);
  const buildPaths = fs.existsSync('dist') ? fs.readdirSync('dist', { recursive: true }).filter((path) => typeof path === 'string' && fs.statSync(`dist/${path}`).isFile()).map((path) => `dist/${path}`) : [];
  for (const file of [...trackedPaths, ...buildPaths]) {
    const content = fs.readFileSync(file);
    if (candidates.some((candidate) => content.includes(candidate))) throw new Error('historical operator PIN remains in proposed source or build output');
  }
}

const files = fs.readdirSync('src', { recursive: true }).filter((file) => typeof file === 'string' && /\.(ts|tsx)$/.test(file));
const client = files.map((file) => fs.readFileSync(`src/${file}`, 'utf8')).join('\n');
if (/VITE_GHL_API_KEY/.test(client)) throw new Error('browser GHL secret reference remains');
if (/createClient\s*\(/.test(client)) throw new Error('browser Supabase client remains');
const additive = fs.readFileSync('supabase/migrations/20260801000000_operator_containment.sql', 'utf8');
if (!additive.includes('consume_operator_login_attempt') || !additive.includes("interval '15 minutes'") || !additive.includes("interval '24 hours'") || !additive.includes('failed_attempts + 1 >= 5')) throw new Error('durable login throttling is missing');
for (const signature of ['consume_operator_login_attempt(text,boolean)', 'create_job_from_proposal_token(text,jsonb)']) {
  if (!additive.includes(`REVOKE ALL ON FUNCTION ${signature} FROM PUBLIC, anon, authenticated;`)) throw new Error(`public RPC revoke missing: ${signature}`);
  if (!additive.includes(`GRANT EXECUTE ON FUNCTION ${signature} TO service_role;`)) throw new Error(`service-role RPC grant missing: ${signature}`);
}
if (!additive.includes('v_created := FOUND;') || !additive.includes('v_job.job_number, v_created')) throw new Error('cross-token conflict result is not deduplicated');
const deposits = fs.readFileSync('supabase/migrations/20260803000000_deposit_invoice_drafts.sql', 'utf8');
if (!deposits.includes('REVOKE ALL ON deposit_invoice_drafts FROM PUBLIC, anon, authenticated;')) throw new Error('deposit draft table is reachable from the browser roles');
if (!deposits.includes('REVOKE ALL ON FUNCTION create_job_from_deposit_draft(text) FROM PUBLIC, anon, authenticated;') ||
    !deposits.includes('GRANT EXECUTE ON FUNCTION create_job_from_deposit_draft(text) TO service_role;')) {
  throw new Error('deposit draft RPC grants are not service-role only');
}
if (!deposits.includes('deposit_invoice_drafts_live_proposal')) throw new Error('deposit drafts allow more than one live price per opportunity');
const invoiceRoute = fs.readFileSync('api/operator/invoice.ts', 'utf8');
if (/invoices\/[^`'"]*\/send/.test(invoiceRoute)) throw new Error('the invoice route sends rather than drafts');
if (!invoiceRoute.includes("canOperator(operator, 'operator:invoices')")) throw new Error('the invoice route is not owner-gated');
const cronRoute = fs.readFileSync('api/cron/blocked-jobs.ts', 'utf8');
if (!cronRoute.includes('`Bearer ${secret}`') || !cronRoute.includes('!secret ||')) throw new Error('the scheduled sweep is not gated on a configured cron secret');
if (!cronRoute.includes('secretMatches(')) throw new Error('the cron secret is not compared in constant time');
const ssoRoute = fs.readFileSync('api/operator/sso.ts', 'utf8');
if (!ssoRoute.includes('parseGhlSsoConfig()')) throw new Error('the SSO route does not fail closed on an unconfigured shared secret');
if (!ssoRoute.includes('consumeLoginAttempt(')) throw new Error('the SSO route is not rate limited');
const ssoLib = fs.readFileSync('api/_lib/ghl-sso.ts', 'utf8');
if (!ssoLib.includes('context.activeLocation !== config.location')) throw new Error('SSO accepts a HighLevel session from another location');
if (!/GHL_APP_SHARED_SECRET/.test(ssoLib) || /GHL_APP_SHARED_SECRET/.test(client)) throw new Error('the HighLevel shared secret is not server-only');
const restrictive = fs.readFileSync('supabase/migrations/20260801000001_operator_containment_restrict.sql', 'utf8');
if (!restrictive.includes('REVOKE ALL ON jobs') || /CREATE POLICY\s+\w+\s+ON\s+\w+\s+FOR ALL\s+TO public\s+USING \(true\)/i.test(restrictive)) throw new Error('containment migration is permissive');
const rollback = fs.readFileSync('supabase/rollback/20260801000002_operator_containment_rollback.sql', 'utf8');
for (const policy of ['job_photos_insert', 'job_photos_select']) {
  if (!rollback.includes(`CREATE POLICY "${policy}"`)) throw new Error(`rollback does not restore ${policy}`);
}
console.log('containment static checks passed');

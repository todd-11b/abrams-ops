import fs from 'node:fs';

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
const restrictive = fs.readFileSync('supabase/migrations/20260801000001_operator_containment_restrict.sql', 'utf8');
if (!restrictive.includes('REVOKE ALL ON jobs') || /CREATE POLICY\s+\w+\s+ON\s+\w+\s+FOR ALL\s+TO public\s+USING \(true\)/i.test(restrictive)) throw new Error('containment migration is permissive');
const rollback = fs.readFileSync('supabase/migrations/20260801000002_operator_containment_rollback.sql', 'utf8');
for (const policy of ['job_photos_insert', 'job_photos_select']) {
  if (!rollback.includes(`CREATE POLICY "${policy}"`)) throw new Error(`rollback does not restore ${policy}`);
}
console.log('containment static checks passed');

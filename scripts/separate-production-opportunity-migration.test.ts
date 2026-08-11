import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = fs.readFileSync('supabase/migrations/20260811051345_separate_production_opportunity.sql', 'utf8');

describe('separate Production opportunity migration', () => {
  it('backfills existing data as explicit legacy without inventing a Production ID', () => {
    expect(sql).toContain("opportunity_contract text NOT NULL DEFAULT 'legacy_single_v1'");
    expect(sql).toContain('UPDATE jobs SET sales_opportunity_id = proposal_id');
    expect(sql).toContain("opportunity_contract = 'legacy_single_v1' AND production_opportunity_id IS NULL");
  });

  it('requires distinct IDs for every new separated job path', () => {
    expect(sql).toContain("opportunity_contract = 'separate_v1' AND sales_opportunity_id IS NOT NULL AND production_opportunity_id IS NOT NULL AND production_opportunity_id <> sales_opportunity_id");
    expect(sql).toContain("RAISE EXCEPTION 'production_opportunity_required'");
    expect(sql).toContain("RAISE EXCEPTION 'job_opportunity_contract_conflict'");
  });

  it('makes an attempted remote create reconciliation-only and locks RPCs to service_role', () => {
    expect(sql).toContain('create_attempted_at timestamptz');
    expect(sql).toContain("CASE WHEN v_link.create_attempted_at IS NULL THEN 'claimed' ELSE 'reconcile' END");
    expect(sql).toContain('REVOKE ALL ON production_opportunity_links FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION finalize_production_opportunity(text,text,text) TO service_role;');
  });
});

-- Keep the consult/Sales opportunity immutable and give production work an
-- explicit, separately persisted HighLevel opportunity. Existing rows retain
-- their historical one-ID meaning; only newly issued links/drafts use v2.

ALTER TABLE proposal_access_tokens
  ADD COLUMN sales_opportunity_id text,
  ADD COLUMN production_opportunity_id text,
  ADD COLUMN opportunity_contract text NOT NULL DEFAULT 'legacy_single_v1';
UPDATE proposal_access_tokens SET sales_opportunity_id = proposal_id WHERE sales_opportunity_id IS NULL;
ALTER TABLE proposal_access_tokens ALTER COLUMN sales_opportunity_id SET NOT NULL;
ALTER TABLE proposal_access_tokens ADD CONSTRAINT proposal_access_tokens_opportunity_contract_check CHECK (
  (opportunity_contract = 'legacy_single_v1' AND production_opportunity_id IS NULL)
  OR (opportunity_contract = 'separate_pending_v1' AND production_opportunity_id IS NULL)
  OR (opportunity_contract = 'separate_v1' AND production_opportunity_id IS NOT NULL AND production_opportunity_id <> sales_opportunity_id)
);

ALTER TABLE deposit_invoice_drafts
  ADD COLUMN sales_opportunity_id text,
  ADD COLUMN production_opportunity_id text,
  ADD COLUMN opportunity_contract text NOT NULL DEFAULT 'legacy_single_v1';
UPDATE deposit_invoice_drafts SET sales_opportunity_id = proposal_id WHERE sales_opportunity_id IS NULL;
ALTER TABLE deposit_invoice_drafts ALTER COLUMN sales_opportunity_id SET NOT NULL;
ALTER TABLE deposit_invoice_drafts ADD CONSTRAINT deposit_invoice_drafts_opportunity_contract_check CHECK (
  (opportunity_contract = 'legacy_single_v1' AND production_opportunity_id IS NULL)
  OR (opportunity_contract = 'separate_pending_v1' AND production_opportunity_id IS NULL)
  OR (opportunity_contract = 'separate_v1' AND production_opportunity_id IS NOT NULL AND production_opportunity_id <> sales_opportunity_id)
);

ALTER TABLE jobs
  ADD COLUMN sales_opportunity_id text,
  ADD COLUMN production_opportunity_id text,
  ADD COLUMN opportunity_contract text NOT NULL DEFAULT 'legacy_single_v1';
UPDATE jobs SET sales_opportunity_id = proposal_id WHERE sales_opportunity_id IS NULL AND proposal_id IS NOT NULL;
ALTER TABLE jobs ADD CONSTRAINT jobs_opportunity_contract_check CHECK (
  (opportunity_contract = 'legacy_single_v1' AND production_opportunity_id IS NULL)
  OR (opportunity_contract = 'separate_v1' AND sales_opportunity_id IS NOT NULL AND production_opportunity_id IS NOT NULL AND production_opportunity_id <> sales_opportunity_id)
);
CREATE UNIQUE INDEX jobs_production_opportunity_id_unique
  ON jobs (production_opportunity_id) WHERE production_opportunity_id IS NOT NULL;

CREATE TABLE production_opportunity_links (
  sales_opportunity_id text PRIMARY KEY,
  contact_id text NOT NULL,
  production_pipeline_id text NOT NULL,
  production_stage_id text NOT NULL,
  deterministic_name text NOT NULL,
  production_opportunity_id text UNIQUE,
  lease_token text CHECK (lease_token IS NULL OR length(lease_token) = 64),
  lease_expires_at timestamptz,
  create_attempted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (production_opportunity_id IS NULL OR production_opportunity_id <> sales_opportunity_id)
);
ALTER TABLE production_opportunity_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON production_opportunity_links FROM PUBLIC, anon, authenticated;

-- Atomically reserves one Sales ID for creation/reconciliation. Once a remote
-- create has been attempted, every later claimant is reconciliation-only: a
-- timeout can never cause an automatic second HighLevel create.
CREATE OR REPLACE FUNCTION claim_production_opportunity(
  p_sales_opportunity_id text,
  p_contact_id text,
  p_production_pipeline_id text,
  p_production_stage_id text,
  p_deterministic_name text,
  p_lease_token text
) RETURNS TABLE(
  claim_status text,
  production_opportunity_id text,
  create_attempted boolean
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_link production_opportunity_links%ROWTYPE; v_now timestamptz := now();
BEGIN
  IF length(p_lease_token) <> 64 OR p_sales_opportunity_id = '' OR p_contact_id = ''
     OR p_production_pipeline_id = '' OR p_production_stage_id = '' OR p_deterministic_name = '' THEN
    RAISE EXCEPTION 'invalid_production_claim' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO production_opportunity_links(
    sales_opportunity_id, contact_id, production_pipeline_id, production_stage_id, deterministic_name
  ) VALUES (
    p_sales_opportunity_id, p_contact_id, p_production_pipeline_id, p_production_stage_id, p_deterministic_name
  ) ON CONFLICT (sales_opportunity_id) DO NOTHING;

  SELECT * INTO v_link FROM production_opportunity_links
    WHERE sales_opportunity_id = p_sales_opportunity_id FOR UPDATE;
  IF v_link.contact_id <> p_contact_id OR v_link.production_pipeline_id <> p_production_pipeline_id
     OR v_link.production_stage_id <> p_production_stage_id OR v_link.deterministic_name <> p_deterministic_name THEN
    RAISE EXCEPTION 'production_claim_mismatch' USING ERRCODE = 'P0001';
  END IF;
  IF v_link.production_opportunity_id IS NOT NULL THEN
    RETURN QUERY SELECT 'ready'::text, v_link.production_opportunity_id, true; RETURN;
  END IF;
  IF v_link.lease_token IS NOT NULL AND v_link.lease_token <> p_lease_token
     AND v_link.lease_expires_at > v_now THEN
    RETURN QUERY SELECT 'busy'::text, NULL::text, v_link.create_attempted_at IS NOT NULL; RETURN;
  END IF;
  UPDATE production_opportunity_links SET
    lease_token = p_lease_token,
    lease_expires_at = v_now + interval '5 minutes',
    updated_at = v_now
    WHERE sales_opportunity_id = p_sales_opportunity_id;
  RETURN QUERY SELECT
    CASE WHEN v_link.create_attempted_at IS NULL THEN 'claimed' ELSE 'reconcile' END::text,
    NULL::text,
    v_link.create_attempted_at IS NOT NULL;
END $$;

CREATE OR REPLACE FUNCTION mark_production_opportunity_attempted(
  p_sales_opportunity_id text,
  p_lease_token text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_changed integer;
BEGIN
  UPDATE production_opportunity_links SET create_attempted_at = COALESCE(create_attempted_at, now()), updated_at = now()
    WHERE sales_opportunity_id = p_sales_opportunity_id
      AND lease_token = p_lease_token AND lease_expires_at > now()
      AND production_opportunity_id IS NULL;
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed = 1;
END $$;

CREATE OR REPLACE FUNCTION finalize_production_opportunity(
  p_sales_opportunity_id text,
  p_lease_token text,
  p_production_opportunity_id text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_link production_opportunity_links%ROWTYPE;
BEGIN
  SELECT * INTO v_link FROM production_opportunity_links
    WHERE sales_opportunity_id = p_sales_opportunity_id FOR UPDATE;
  IF NOT FOUND OR v_link.lease_token <> p_lease_token OR v_link.lease_expires_at <= now() THEN
    RAISE EXCEPTION 'production_claim_not_owned' USING ERRCODE = 'P0001';
  END IF;
  IF p_production_opportunity_id = '' OR p_production_opportunity_id = p_sales_opportunity_id THEN
    RAISE EXCEPTION 'invalid_production_opportunity' USING ERRCODE = 'P0001';
  END IF;
  UPDATE production_opportunity_links SET
    production_opportunity_id = p_production_opportunity_id,
    lease_token = NULL,
    lease_expires_at = NULL,
    updated_at = now()
    WHERE sales_opportunity_id = p_sales_opportunity_id;
  RETURN p_production_opportunity_id;
END $$;

CREATE OR REPLACE FUNCTION release_unattempted_production_claim(
  p_sales_opportunity_id text,
  p_lease_token text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_changed integer;
BEGIN
  UPDATE production_opportunity_links SET lease_token = NULL, lease_expires_at = NULL, updated_at = now()
    WHERE sales_opportunity_id = p_sales_opportunity_id AND lease_token = p_lease_token
      AND create_attempted_at IS NULL AND production_opportunity_id IS NULL;
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN v_changed = 1;
END $$;

REVOKE ALL ON FUNCTION claim_production_opportunity(text,text,text,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION mark_production_opportunity_attempted(text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION finalize_production_opportunity(text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION release_unattempted_production_claim(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_production_opportunity(text,text,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION mark_production_opportunity_attempted(text,text) TO service_role;
GRANT EXECUTE ON FUNCTION finalize_production_opportunity(text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION release_unattempted_production_claim(text,text) TO service_role;

CREATE OR REPLACE FUNCTION create_job_from_proposal_token(
  p_token_hash text,
  p_fence_spec jsonb DEFAULT NULL
) RETURNS TABLE(job_id uuid, job_number text, created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_token proposal_access_tokens%ROWTYPE; v_job jobs%ROWTYPE; v_created boolean := false;
BEGIN
  SELECT * INTO v_token FROM proposal_access_tokens
    WHERE token_hash = p_token_hash AND purpose = 'proposal_view_sign' FOR UPDATE;
  IF NOT FOUND OR v_token.expires_at <= now() THEN RAISE EXCEPTION 'invalid_or_expired_token' USING ERRCODE = 'P0001'; END IF;
  IF v_token.fence_spec IS NULL AND v_token.job_id IS NULL THEN RAISE EXCEPTION 'unpriced_token' USING ERRCODE = 'P0001'; END IF;
  IF v_token.opportunity_contract = 'separate_pending_v1' THEN RAISE EXCEPTION 'production_opportunity_required' USING ERRCODE = 'P0001'; END IF;
  IF v_token.opportunity_contract = 'separate_v1' AND
     (v_token.production_opportunity_id IS NULL OR v_token.production_opportunity_id = v_token.sales_opportunity_id) THEN
    RAISE EXCEPTION 'invalid_production_opportunity' USING ERRCODE = 'P0001';
  END IF;
  IF v_token.job_id IS NOT NULL THEN
    SELECT * INTO v_job FROM jobs WHERE jobs.job_id = v_token.job_id;
    RETURN QUERY SELECT v_job.job_id, v_job.job_number, false; RETURN;
  END IF;
  INSERT INTO jobs(contact_id, proposal_id, sales_opportunity_id, production_opportunity_id, opportunity_contract,
                   stage, status, deposit_status, signed_at)
    VALUES(v_token.contact_id, v_token.proposal_id, v_token.sales_opportunity_id,
           v_token.production_opportunity_id, v_token.opportunity_contract,
           'job_created', 'active', 'pending_invoice', now())
    ON CONFLICT (proposal_id) WHERE proposal_id IS NOT NULL DO NOTHING RETURNING * INTO v_job;
  v_created := FOUND;
  IF NOT FOUND THEN SELECT * INTO v_job FROM jobs WHERE proposal_id = v_token.proposal_id; END IF;
  IF v_job.opportunity_contract <> v_token.opportunity_contract
     OR v_job.sales_opportunity_id IS DISTINCT FROM v_token.sales_opportunity_id
     OR v_job.production_opportunity_id IS DISTINCT FROM v_token.production_opportunity_id THEN
    RAISE EXCEPTION 'job_opportunity_contract_conflict' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM job_fence_specs WHERE job_fence_specs.job_id = v_job.job_id) THEN
    INSERT INTO job_fence_specs(job_id, fence_lines, gates, addons, total_sections, total_lf, proposal_total)
    SELECT v_job.job_id, COALESCE(v_token.fence_spec->'fence_lines','[]'), COALESCE(v_token.fence_spec->'gates','[]'),
      COALESCE(v_token.fence_spec->'addons','[]'), COALESCE((v_token.fence_spec->>'total_sections')::integer,0),
      COALESCE((v_token.fence_spec->>'total_lf')::numeric,0), COALESCE((v_token.fence_spec->>'proposal_total')::numeric,0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM job_activity_log WHERE job_activity_log.job_id = v_job.job_id AND type = 'proposal_signed') THEN
    INSERT INTO job_activity_log(job_id, contact_id, type, actor, source, payload)
      VALUES(v_job.job_id, v_token.contact_id, 'proposal_signed', 'system', 'system',
        jsonb_build_object('sales_opportunity_id',v_token.sales_opportunity_id,'production_opportunity_id',v_token.production_opportunity_id));
  END IF;
  UPDATE proposal_access_tokens SET consumed_at = COALESCE(consumed_at,now()), job_id = v_job.job_id WHERE token_id = v_token.token_id;
  RETURN QUERY SELECT v_job.job_id, v_job.job_number, v_created;
END $$;

CREATE OR REPLACE FUNCTION create_job_from_deposit_draft(p_proposal_id text)
RETURNS TABLE(job_id uuid, job_number text, created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_draft deposit_invoice_drafts%ROWTYPE; v_job jobs%ROWTYPE; v_created boolean := false;
BEGIN
  SELECT * INTO v_draft FROM deposit_invoice_drafts
    WHERE sales_opportunity_id = p_proposal_id AND superseded_at IS NULL FOR UPDATE;
  IF NOT FOUND OR v_draft.ghl_invoice_id IS NULL THEN RAISE EXCEPTION 'no_live_draft' USING ERRCODE = 'P0001'; END IF;
  IF v_draft.opportunity_contract = 'separate_pending_v1' THEN RAISE EXCEPTION 'production_opportunity_required' USING ERRCODE = 'P0001'; END IF;
  IF v_draft.opportunity_contract = 'separate_v1' AND
     (v_draft.production_opportunity_id IS NULL OR v_draft.production_opportunity_id = v_draft.sales_opportunity_id) THEN
    RAISE EXCEPTION 'invalid_production_opportunity' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_job FROM jobs WHERE proposal_id = v_draft.proposal_id;
  IF NOT FOUND THEN
    INSERT INTO jobs(contact_id, proposal_id, sales_opportunity_id, production_opportunity_id, opportunity_contract,
                     stage, status, deposit_status)
      VALUES(v_draft.contact_id, v_draft.proposal_id, v_draft.sales_opportunity_id,
             v_draft.production_opportunity_id, v_draft.opportunity_contract,
             'job_created', 'active', 'pending_invoice')
      ON CONFLICT (proposal_id) WHERE proposal_id IS NOT NULL DO NOTHING RETURNING * INTO v_job;
    v_created := FOUND;
    IF NOT FOUND THEN SELECT * INTO v_job FROM jobs WHERE proposal_id = v_draft.proposal_id; END IF;
  END IF;
  IF v_job.opportunity_contract <> v_draft.opportunity_contract
     OR v_job.sales_opportunity_id IS DISTINCT FROM v_draft.sales_opportunity_id
     OR v_job.production_opportunity_id IS DISTINCT FROM v_draft.production_opportunity_id THEN
    RAISE EXCEPTION 'job_opportunity_contract_conflict' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM job_fence_specs WHERE job_fence_specs.job_id = v_job.job_id) THEN
    INSERT INTO job_fence_specs(job_id, fence_lines, gates, addons, total_sections, total_lf, proposal_total)
    SELECT v_job.job_id, COALESCE(v_draft.fence_spec->'fence_lines','[]'), COALESCE(v_draft.fence_spec->'gates','[]'),
      COALESCE(v_draft.fence_spec->'addons','[]'), COALESCE((v_draft.fence_spec->>'total_sections')::integer,0),
      COALESCE((v_draft.fence_spec->>'total_lf')::numeric,0), COALESCE((v_draft.fence_spec->>'proposal_total')::numeric,0);
  END IF;
  IF v_created THEN
    INSERT INTO job_activity_log(job_id, contact_id, type, actor, source, payload)
      VALUES(v_job.job_id, v_draft.contact_id, 'job_created_from_deposit', 'system', 'workflow',
        jsonb_build_object('sales_opportunity_id', v_draft.sales_opportunity_id,
                           'production_opportunity_id', v_draft.production_opportunity_id,
                           'invoice_id', v_draft.ghl_invoice_id));
  END IF;
  UPDATE deposit_invoice_drafts SET job_id = v_job.job_id WHERE draft_id = v_draft.draft_id;
  RETURN QUERY SELECT v_job.job_id, v_job.job_number, v_created;
END $$;

-- CREATE OR REPLACE preserves the existing service_role grants, but keep the
-- boundary explicit for migration review and clean database rebuilds.
REVOKE ALL ON FUNCTION create_job_from_proposal_token(text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION create_job_from_deposit_draft(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_job_from_proposal_token(text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION create_job_from_deposit_draft(text) TO service_role;

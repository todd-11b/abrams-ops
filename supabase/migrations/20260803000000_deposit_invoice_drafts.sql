-- Abrams Ops deposit invoice drafts, 2026-08-03. Additive.
-- A customer can pay without ever signing, so the price a payment turns into a
-- job is frozen when the invoice is drafted, exactly as a proposal link freezes
-- it when the link is issued.
CREATE TABLE deposit_invoice_drafts (
  draft_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id text NOT NULL,
  proposal_id text NOT NULL,
  -- Null while the row reserves the opportunity, before the CRM has returned an
  -- invoice id: the unique index below is what stops a second click drafting a
  -- second payable invoice.
  ghl_invoice_id text,
  deposit_amount numeric NOT NULL CHECK (deposit_amount >= 0),
  -- Server-derived snapshot of the quote, recomputed from the stored proposal
  -- when the operator drafts the invoice. No request body supplies it.
  fence_spec jsonb NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  job_id uuid REFERENCES jobs(job_id)
);
ALTER TABLE deposit_invoice_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON deposit_invoice_drafts FROM PUBLIC, anon, authenticated;

-- One live draft per opportunity: re-pricing supersedes the previous one so a
-- payment can never be matched to a stale amount.
CREATE UNIQUE INDEX deposit_invoice_drafts_live_proposal
  ON deposit_invoice_drafts (proposal_id) WHERE superseded_at IS NULL;
CREATE INDEX deposit_invoice_drafts_invoice ON deposit_invoice_drafts (ghl_invoice_id);

-- Creates the job a paid deposit implies when nobody signed a proposal. The
-- payable values come from the draft's frozen snapshot, never from the webhook
-- body, and jobs.proposal_id is unique so a redelivery cannot duplicate a job.
CREATE OR REPLACE FUNCTION create_job_from_deposit_draft(p_proposal_id text)
RETURNS TABLE(job_id uuid, job_number text, created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_draft deposit_invoice_drafts%ROWTYPE; v_job jobs%ROWTYPE; v_created boolean := false;
BEGIN
  SELECT * INTO v_draft FROM deposit_invoice_drafts
    WHERE proposal_id = p_proposal_id AND superseded_at IS NULL
    FOR UPDATE;
  -- A reservation with no invoice id yet is not something a customer can have paid.
  IF NOT FOUND OR v_draft.ghl_invoice_id IS NULL THEN RAISE EXCEPTION 'no_live_draft' USING ERRCODE = 'P0001'; END IF;

  SELECT * INTO v_job FROM jobs WHERE proposal_id = p_proposal_id;
  IF NOT FOUND THEN
    INSERT INTO jobs(contact_id, proposal_id, stage, status, deposit_status)
      VALUES(v_draft.contact_id, v_draft.proposal_id, 'job_created', 'active', 'pending_invoice')
      ON CONFLICT (proposal_id) WHERE proposal_id IS NOT NULL DO NOTHING RETURNING * INTO v_job;
    v_created := FOUND;
    IF NOT FOUND THEN SELECT * INTO v_job FROM jobs WHERE proposal_id = p_proposal_id; END IF;
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
        jsonb_build_object('proposal_id', v_draft.proposal_id, 'invoice_id', v_draft.ghl_invoice_id));
  END IF;

  UPDATE deposit_invoice_drafts SET job_id = v_job.job_id WHERE draft_id = v_draft.draft_id;
  RETURN QUERY SELECT v_job.job_id, v_job.job_number, v_created;
END $$;
REVOKE ALL ON FUNCTION create_job_from_deposit_draft(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_job_from_deposit_draft(text) TO service_role;

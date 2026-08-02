-- Abrams Ops containment v1.0, 2026-08-01. Source-only: do not apply without authorization.
CREATE TABLE proposal_access_tokens (
  token_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  contact_id text NOT NULL,
  proposal_id text NOT NULL,
  purpose text NOT NULL CHECK (purpose = 'proposal_view_sign'),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  job_id uuid REFERENCES jobs(job_id),
  -- Server-derived snapshot of the quote, recomputed from the stored proposal
  -- when the operator issues the link. The signing request never supplies it.
  fence_spec jsonb,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE proposal_access_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON proposal_access_tokens FROM anon, authenticated;

CREATE TABLE operator_login_limits (
  key_hash text PRIMARY KEY CHECK (length(key_hash) = 64),
  failed_attempts integer NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE operator_login_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON operator_login_limits FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION consume_operator_login_attempt(p_key_hash text, p_credentials_valid boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_limit operator_login_limits%ROWTYPE; v_now timestamptz := now();
BEGIN
  IF length(p_key_hash) <> 64 THEN RETURN false; END IF;
  DELETE FROM operator_login_limits
    WHERE updated_at < v_now - interval '24 hours'
      AND (locked_until IS NULL OR locked_until <= v_now);
  INSERT INTO operator_login_limits(key_hash) VALUES (p_key_hash)
    ON CONFLICT (key_hash) DO NOTHING;
  SELECT * INTO v_limit FROM operator_login_limits WHERE key_hash = p_key_hash FOR UPDATE;
  IF v_limit.locked_until IS NOT NULL AND v_limit.locked_until > v_now THEN RETURN false; END IF;
  IF p_credentials_valid THEN
    DELETE FROM operator_login_limits WHERE key_hash = p_key_hash;
    RETURN true;
  END IF;
  IF v_limit.window_started_at <= v_now - interval '15 minutes' THEN
    UPDATE operator_login_limits SET failed_attempts = 1, window_started_at = v_now, locked_until = NULL, updated_at = v_now WHERE key_hash = p_key_hash;
  ELSIF v_limit.failed_attempts + 1 >= 5 THEN
    UPDATE operator_login_limits SET failed_attempts = failed_attempts + 1, locked_until = v_now + interval '15 minutes', updated_at = v_now WHERE key_hash = p_key_hash;
  ELSE
    UPDATE operator_login_limits SET failed_attempts = failed_attempts + 1, updated_at = v_now WHERE key_hash = p_key_hash;
  END IF;
  RETURN false;
END $$;
REVOKE ALL ON FUNCTION consume_operator_login_attempt(text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION consume_operator_login_attempt(text,boolean) TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT proposal_id FROM jobs WHERE proposal_id IS NOT NULL GROUP BY proposal_id HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'containment preflight failed: duplicate jobs.proposal_id values require explicit reconciliation';
  END IF;
END $$;
CREATE UNIQUE INDEX jobs_proposal_id_unique ON jobs (proposal_id) WHERE proposal_id IS NOT NULL;

-- p_fence_spec is retained for signature compatibility and is deliberately
-- ignored: the customer total is read from the token's server-derived snapshot
-- so an unauthenticated signing request cannot alter a payable amount.
CREATE OR REPLACE FUNCTION create_job_from_proposal_token(
  p_token_hash text,
  p_fence_spec jsonb DEFAULT NULL
) RETURNS TABLE(job_id uuid, job_number text, created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_token proposal_access_tokens%ROWTYPE; v_job jobs%ROWTYPE; v_created boolean := false;
BEGIN
  SELECT * INTO v_token FROM proposal_access_tokens
    WHERE token_hash = p_token_hash AND purpose = 'proposal_view_sign'
    FOR UPDATE;
  IF NOT FOUND OR v_token.expires_at <= now() THEN RAISE EXCEPTION 'invalid_or_expired_token' USING ERRCODE = 'P0001'; END IF;
  -- A token with no snapshot predates server-derived pricing. jobs.proposal_id
  -- is unique, so creating an unpriced job here would be unrecoverable without
  -- manual surgery; refuse and let the operator issue a new link instead.
  IF v_token.fence_spec IS NULL AND v_token.job_id IS NULL THEN RAISE EXCEPTION 'unpriced_token' USING ERRCODE = 'P0001'; END IF;
  IF v_token.job_id IS NOT NULL THEN
    SELECT * INTO v_job FROM jobs WHERE jobs.job_id = v_token.job_id;
    RETURN QUERY SELECT v_job.job_id, v_job.job_number, false; RETURN;
  END IF;
  INSERT INTO jobs(contact_id, proposal_id, stage, status, deposit_status, signed_at)
    VALUES(v_token.contact_id, v_token.proposal_id, 'job_created', 'active', 'pending_invoice', now())
    ON CONFLICT (proposal_id) WHERE proposal_id IS NOT NULL DO NOTHING RETURNING * INTO v_job;
  v_created := FOUND;
  IF NOT FOUND THEN SELECT * INTO v_job FROM jobs WHERE proposal_id = v_token.proposal_id; END IF;
  IF NOT EXISTS (SELECT 1 FROM job_fence_specs WHERE job_fence_specs.job_id = v_job.job_id) THEN
    INSERT INTO job_fence_specs(job_id, fence_lines, gates, addons, total_sections, total_lf, proposal_total)
    SELECT v_job.job_id, COALESCE(v_token.fence_spec->'fence_lines','[]'), COALESCE(v_token.fence_spec->'gates','[]'),
      COALESCE(v_token.fence_spec->'addons','[]'), COALESCE((v_token.fence_spec->>'total_sections')::integer,0),
      COALESCE((v_token.fence_spec->>'total_lf')::numeric,0), COALESCE((v_token.fence_spec->>'proposal_total')::numeric,0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM job_activity_log WHERE job_activity_log.job_id = v_job.job_id AND type = 'proposal_signed') THEN
    INSERT INTO job_activity_log(job_id, contact_id, type, actor, source, payload)
      VALUES(v_job.job_id, v_token.contact_id, 'proposal_signed', 'system', 'system', jsonb_build_object('proposal_id',v_token.proposal_id));
  END IF;
  UPDATE proposal_access_tokens SET consumed_at = COALESCE(consumed_at,now()), job_id = v_job.job_id WHERE token_id = v_token.token_id;
  RETURN QUERY SELECT v_job.job_id, v_job.job_number, v_created;
END $$;
REVOKE ALL ON FUNCTION create_job_from_proposal_token(text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION create_job_from_proposal_token(text,jsonb) TO service_role;

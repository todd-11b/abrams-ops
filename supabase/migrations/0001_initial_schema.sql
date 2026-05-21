-- Abrams Fence Ops — initial schema
-- Run in Supabase dashboard SQL editor.

-- 1. Core job record
CREATE TABLE jobs (
  job_id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_number              TEXT UNIQUE,
  contact_id              TEXT NOT NULL,
  proposal_id             TEXT,
  stage                   TEXT NOT NULL DEFAULT 'job_created',
  status                  TEXT NOT NULL DEFAULT 'active',
  install_date            DATE,
  scheduled_start_window  TEXT CHECK (scheduled_start_window IN ('morning', 'afternoon', 'all_day')),
  deposit_status          TEXT NOT NULL DEFAULT 'unpaid' CHECK (deposit_status IN ('unpaid', 'paid')),
  deposit_paid_at         TIMESTAMPTZ,
  blocked_reason          TEXT,
  blocked_note            TEXT,
  blocked_at              TIMESTAMPTZ,
  needs_review_reason     TEXT,
  access_notes            JSONB DEFAULT '{}',
  last_activity_at        TIMESTAMPTZ DEFAULT NOW(),
  last_activity_by        TEXT,
  completed_at            TIMESTAMPTZ,
  archived_at             TIMESTAMPTZ,
  last_ghl_sync           TIMESTAMPTZ,
  ghl_stage               TEXT,
  created_at              TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Job number auto-generation
CREATE SEQUENCE job_number_seq START 1;

CREATE OR REPLACE FUNCTION generate_job_number()
RETURNS TRIGGER AS $$
BEGIN
  NEW.job_number := 'AF-' || EXTRACT(YEAR FROM NOW())::TEXT || '-' || LPAD(nextval('job_number_seq')::TEXT, 4, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_job_number
  BEFORE INSERT ON jobs
  FOR EACH ROW
  WHEN (NEW.job_number IS NULL)
  EXECUTE FUNCTION generate_job_number();

-- 3. Fence specs (from proposal)
CREATE TABLE job_fence_specs (
  spec_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          UUID REFERENCES jobs(job_id) ON DELETE CASCADE,
  fence_lines     JSONB DEFAULT '[]',
  gates           JSONB DEFAULT '[]',
  addons          JSONB DEFAULT '[]',
  total_sections  INTEGER DEFAULT 0,
  total_lf        NUMERIC DEFAULT 0,
  proposal_total  NUMERIC DEFAULT 0
);

-- 4. Checklist items
CREATE TABLE job_checklists (
  checklist_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          UUID REFERENCES jobs(job_id) ON DELETE CASCADE,
  section         TEXT NOT NULL,
  item_id         TEXT NOT NULL,
  label           TEXT NOT NULL,
  checked         BOOLEAN DEFAULT FALSE,
  checked_at      TIMESTAMPTZ,
  skippable       BOOLEAN DEFAULT FALSE,
  skipped         BOOLEAN DEFAULT FALSE,
  skip_reason     TEXT,
  photo_required  BOOLEAN DEFAULT FALSE,
  photo_uploaded  BOOLEAN DEFAULT FALSE,
  UNIQUE(job_id, item_id)
);

-- 5. Photos
CREATE TABLE job_photos (
  photo_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          UUID REFERENCES jobs(job_id) ON DELETE CASCADE,
  phase           TEXT NOT NULL,
  url             TEXT NOT NULL,
  uploaded_at     TIMESTAMPTZ DEFAULT NOW(),
  uploaded_by     TEXT,
  synced          BOOLEAN DEFAULT FALSE
);

-- 6. Issues — never deleted
CREATE TABLE job_issues (
  issue_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id            UUID REFERENCES jobs(job_id),
  contact_id        TEXT,
  type              TEXT NOT NULL,
  severity          TEXT NOT NULL CHECK (severity IN ('low', 'medium', 'high')),
  customer_visible  BOOLEAN DEFAULT FALSE,
  note              TEXT,
  photos            JSONB DEFAULT '[]',
  created_by        TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  resolved          BOOLEAN DEFAULT FALSE,
  resolved_at       TIMESTAMPTZ,
  resolution_note   TEXT
);

-- 7. Activity log — append only, never updated, never deleted
CREATE TABLE job_activity_log (
  activity_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        UUID REFERENCES jobs(job_id),
  contact_id    TEXT,
  type          TEXT NOT NULL,
  actor         TEXT,
  source        TEXT NOT NULL CHECK (source IN ('manual', 'workflow', 'system')),
  payload       JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Helpful indexes for the office dashboard query patterns
CREATE INDEX idx_jobs_install_date ON jobs(install_date) WHERE archived_at IS NULL;
CREATE INDEX idx_jobs_status ON jobs(status) WHERE archived_at IS NULL;
CREATE INDEX idx_jobs_contact_id ON jobs(contact_id);
CREATE INDEX idx_checklists_job_id ON job_checklists(job_id);
CREATE INDEX idx_photos_job_id ON job_photos(job_id);
CREATE INDEX idx_issues_job_id ON job_issues(job_id);
CREATE INDEX idx_activity_job_id ON job_activity_log(job_id, created_at DESC);

-- Append-only enforcement at the database layer.
-- job_issues and job_activity_log: deletes blocked outright.
-- job_activity_log: updates also blocked.
-- (Application layer still enforces this; this is belt + suspenders.)
ALTER TABLE job_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY issues_no_delete ON job_issues FOR DELETE USING (false);
CREATE POLICY activity_no_delete ON job_activity_log FOR DELETE USING (false);
CREATE POLICY activity_no_update ON job_activity_log FOR UPDATE USING (false);

-- Permissive read/insert/update for authenticated users on the rest.
-- Tighten these once auth model is finalized.
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_fence_specs ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY jobs_all ON jobs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY fence_specs_all ON job_fence_specs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY checklists_all ON job_checklists FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY photos_all ON job_photos FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY issues_read ON job_issues FOR SELECT USING (true);
CREATE POLICY issues_insert ON job_issues FOR INSERT WITH CHECK (true);
CREATE POLICY issues_update ON job_issues FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY activity_read ON job_activity_log FOR SELECT USING (true);
CREATE POLICY activity_insert ON job_activity_log FOR INSERT WITH CHECK (true);

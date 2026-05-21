-- Production module additions on top of 20260520000000_initial_schema.sql

-- Issue context (from spec section 3.6): which phase the issue was flagged in.
-- Nullable: null when flagged via the persistent top-right button outside any section.
ALTER TABLE job_issues
  ADD COLUMN section TEXT
  CHECK (section IS NULL OR section IN ('loadout', 'onsite', 'install', 'clean', 'walkthrough'));

-- Block-notification rate-limit state (from spec section 3.5):
-- Stores the timestamp of the last "Job blocked" SMS so the next fire respects the 48h throttle.
ALTER TABLE jobs
  ADD COLUMN last_blocked_notification_at TIMESTAMPTZ;

CREATE INDEX idx_jobs_blocked_active
  ON jobs(blocked_at)
  WHERE status = 'blocked' AND archived_at IS NULL;

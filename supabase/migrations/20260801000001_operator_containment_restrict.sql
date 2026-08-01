-- Abrams Ops containment v1.2 restrictive cutover, 2026-08-01.
-- Apply only after the compatible server/UI build and non-customer fixture proof.
DROP POLICY IF EXISTS jobs_all ON jobs;
DROP POLICY IF EXISTS fence_specs_all ON job_fence_specs;
DROP POLICY IF EXISTS checklists_all ON job_checklists;
DROP POLICY IF EXISTS photos_all ON job_photos;
DROP POLICY IF EXISTS issues_read ON job_issues;
DROP POLICY IF EXISTS issues_insert ON job_issues;
DROP POLICY IF EXISTS issues_update ON job_issues;
DROP POLICY IF EXISTS activity_read ON job_activity_log;
DROP POLICY IF EXISTS activity_insert ON job_activity_log;
REVOKE ALL ON jobs, job_fence_specs, job_checklists, job_photos, job_issues, job_activity_log FROM anon, authenticated;

DROP POLICY IF EXISTS "Public can upload job photos" ON storage.objects;
DROP POLICY IF EXISTS "Public can view job photos" ON storage.objects;
DROP POLICY IF EXISTS job_photos_insert ON storage.objects;
DROP POLICY IF EXISTS job_photos_select ON storage.objects;

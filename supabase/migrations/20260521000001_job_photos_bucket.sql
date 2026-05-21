-- Create the job-photos storage bucket used by usePhotoQueue and PhotoUpload.
-- Private (public = false). Path convention: {jobId}/{phase}/{timestamp}_{photoId}.jpg
-- Allowed MIME types restricted to images. File size cap 50 MB (mobile-photo ceiling).

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'job-photos',
  'job-photos',
  false,
  52428800,
  ARRAY['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Authenticated users (and the anon key used by the SPA — RLS is permissive in V1 per spec section 14)
-- can insert objects into the job-photos bucket.
DROP POLICY IF EXISTS "job_photos_insert" ON storage.objects;
CREATE POLICY "job_photos_insert"
ON storage.objects
FOR INSERT
TO public
WITH CHECK (bucket_id = 'job-photos');

-- Authenticated users can read objects in the job-photos bucket
-- (so the field view and dashboard can render the thumbnails/links).
DROP POLICY IF EXISTS "job_photos_select" ON storage.objects;
CREATE POLICY "job_photos_select"
ON storage.objects
FOR SELECT
TO public
USING (bucket_id = 'job-photos');

-- No DELETE policy on purpose — V1 photos are append-only audit records.

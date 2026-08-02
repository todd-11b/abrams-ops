const JOB_PHOTO_PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(loadout|onsite|install|clean|issue)\/[A-Za-z0-9_-]{1,120}\.[A-Za-z0-9]{1,5}$/;

export const MAX_SIGNED_PHOTO_PATHS = 50;

/**
 * Object keys in the private `job-photos` bucket are always
 * `<jobId>/<phase>/<file>`. Traversal segments, absolute keys and any phase
 * outside the client contract are rejected.
 */
export function isJobPhotoPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 200) return false;
  if (value.startsWith('/') || value.split('/').includes('..')) return false;
  return JOB_PHOTO_PATH.test(value);
}

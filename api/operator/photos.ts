import { canOperator, requireOperator, secureJson } from '../_lib/operator-auth';
import { MAX_SIGNED_PHOTO_PATHS, isJobPhotoPath } from '../_lib/photo-path';
import { serverEnv } from '../_lib/server-data';

export const config = { runtime: 'edge' };
export default async function handler(req: Request) {
  const operator = await requireOperator(req);
  if (!operator) return secureJson({ error: 'unauthorized' }, { status: 401 });
  if (!canOperator(operator, 'operator:photos')) return secureJson({ error: 'forbidden' }, { status: 403 });
  if (req.method !== 'POST') return secureJson({ error: 'method not allowed' }, { status: 405 });
  const { url, key } = serverEnv(); const type = req.headers.get('content-type') ?? '';
  if (type.includes('multipart/form-data')) {
    const fd = await req.formData(); const path = String(fd.get('path') ?? ''); const file = fd.get('file');
    if (!(file instanceof File) || !isJobPhotoPath(path)) return secureJson({ error: 'invalid upload' }, { status: 400 });
    const upload = await fetch(`${url}/storage/v1/object/job-photos/${path}`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': file.type || 'image/jpeg', 'x-upsert': 'false' }, body: file });
    return upload.ok ? secureJson({ path }, { status: 201 }) : secureJson({ error: 'upload failed' }, { status: 502 });
  }
  let body: { paths?: string[] }; try { body = await req.json(); } catch { return secureJson({ error: 'invalid JSON' }, { status: 400 }); }
  if (!Array.isArray(body.paths) || body.paths.length > MAX_SIGNED_PHOTO_PATHS || !body.paths.every(isJobPhotoPath)) return secureJson({ error: 'invalid paths' }, { status: 400 });
  const signed = await fetch(`${url}/storage/v1/object/sign/job-photos`, { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 3600, paths: body.paths }) });
  if (!signed.ok) return secureJson({ error: 'signed URL failed' }, { status: 502 });
  const rows = await signed.json() as Array<{ signedURL?: string; signedUrl?: string }>;
  return secureJson({ data: rows.map((row) => ({ signedUrl: `${url}/storage/v1${row.signedURL ?? row.signedUrl ?? ''}` })) });
}

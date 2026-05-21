// src/hooks/usePhotoQueue.ts
import { useCallback, useState } from 'react';
import { supabase } from '../lib/supabase';
import { crmApi } from '../lib/crm-api';
import { useActivityLog } from './useActivityLog';
import type { PhotoPhase } from '../types/production';

interface PendingUpload {
  file: File;
  phase: PhotoPhase;
  attempts: number;
}

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 30_000;
const BUCKET = 'job-photos';

function lsKey(jobId: string) {
  return `abrams_job_${jobId}_photos_queue`;
}

export function usePhotoQueue(jobId: string, contactId: string) {
  const { append } = useActivityLog();
  const [pendingCount, setPendingCount] = useState(0);

  const uploadToSupabase = useCallback(async (file: File, phase: PhotoPhase) => {
    const ts = Date.now();
    const photoId = crypto.randomUUID();
    const path = `${jobId}/${phase}/${ts}_${photoId}.jpg`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
      contentType: file.type || 'image/jpeg',
      upsert: false,
    });
    if (error) throw error;
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    const url = data.publicUrl;
    const { error: rowErr } = await supabase.from('job_photos').insert({
      photo_id: photoId,
      job_id: jobId,
      phase,
      url,
      synced: false,
    });
    if (rowErr) throw rowErr;
    return { photoId, url };
  }, [jobId]);

  const mirrorToGhl = useCallback(async (file: File, photoId: string) => {
    try {
      await crmApi.uploadPhoto(contactId, file);
      await supabase.from('job_photos').update({ synced: true }).eq('photo_id', photoId);
    } catch (err) {
      console.error('[usePhotoQueue] GHL mirror failed (will retry in field):', err);
    }
  }, [contactId]);

  const enqueueRetry = useCallback((up: PendingUpload) => {
    const raw = localStorage.getItem(lsKey(jobId));
    const queue: PendingUpload[] = raw ? JSON.parse(raw) : [];
    queue.push(up);
    localStorage.setItem(lsKey(jobId), JSON.stringify(queue));
    setPendingCount(queue.length);
  }, [jobId]);

  const upload = useCallback(async (file: File, phase: PhotoPhase) => {
    let attempts = 0;
    while (attempts < MAX_ATTEMPTS) {
      try {
        const { photoId } = await uploadToSupabase(file, phase);
        await append({ job_id: jobId, contact_id: contactId, type: 'photo_uploaded', payload: { phase, photo_id: photoId } });
        if (phase !== 'issue') {
          // Fire-and-forget mirror — never block the UI.
          void mirrorToGhl(file, photoId);
        }
        return { ok: true as const, photoId };
      } catch (err) {
        attempts++;
        console.error(`[usePhotoQueue] attempt ${attempts} failed:`, err);
        if (attempts >= MAX_ATTEMPTS) {
          enqueueRetry({ file, phase, attempts });
          return { ok: false as const, error: err };
        }
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }
    return { ok: false as const, error: new Error('exhausted retries') };
  }, [uploadToSupabase, mirrorToGhl, enqueueRetry, append, jobId, contactId]);

  return { upload, pendingCount };
}

// src/hooks/useActivityLog.ts
import { useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { getStoredActor } from '../utils/actor';
import type { ActivitySource } from '../types/production';

export interface LogEvent {
  job_id?: string | null;
  contact_id?: string | null;
  type: string;
  source?: ActivitySource;
  payload?: Record<string, unknown>;
}

export function useActivityLog() {
  const append = useCallback(async (e: LogEvent) => {
    const { error } = await supabase.from('job_activity_log').insert({
      job_id: e.job_id ?? null,
      contact_id: e.contact_id ?? null,
      type: e.type,
      actor: getStoredActor(),
      source: e.source ?? 'manual',
      payload: e.payload ?? {},
    });
    if (error) {
      console.error('[useActivityLog] insert failed:', error);
      throw error;
    }
  }, []);

  return { append };
}

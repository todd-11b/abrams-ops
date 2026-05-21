// src/hooks/useChecklist.ts
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useActivityLog } from './useActivityLog';
import { buildChecklistRowsForJob } from '../utils/checklistTemplate';
import type { ChecklistItem, ChecklistSectionKey } from '../types/production';

function lsKey(jobId: string) {
  return `abrams_job_${jobId}_checklist`;
}

export function useChecklist(jobId: string | undefined) {
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { append } = useActivityLog();

  const load = useCallback(async () => {
    if (!jobId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('job_checklists')
      .select('*')
      .eq('job_id', jobId);
    if (error) {
      console.error('[useChecklist] load failed:', error);
      setItems([]);
      setLoading(false);
      return;
    }
    let rows = (data ?? []) as ChecklistItem[];

    // First-run hydration: if this job has no checklist rows yet, seed them.
    if (rows.length === 0) {
      const seeds = buildChecklistRowsForJob(jobId);
      const { data: inserted, error: insErr } = await supabase
        .from('job_checklists')
        .insert(seeds)
        .select('*');
      if (insErr) {
        console.error('[useChecklist] seed insert failed:', insErr);
      } else {
        rows = (inserted ?? []) as ChecklistItem[];
      }
    }

    // Merge any offline-saved checkbox state from localStorage.
    try {
      const raw = localStorage.getItem(lsKey(jobId));
      if (raw) {
        const cached = JSON.parse(raw) as Record<string, { checked: boolean }>;
        rows = rows.map((r) =>
          cached[r.item_id] !== undefined ? { ...r, checked: cached[r.item_id].checked } : r
        );
      }
    } catch (e) {
      console.warn('[useChecklist] localStorage parse failed:', e);
    }

    setItems(rows);
    setLoading(false);
  }, [jobId]);

  useEffect(() => { load(); }, [load]);

  const persistLocal = useCallback((next: ChecklistItem[]) => {
    if (!jobId) return;
    const map: Record<string, { checked: boolean }> = {};
    for (const i of next) map[i.item_id] = { checked: i.checked };
    localStorage.setItem(lsKey(jobId), JSON.stringify(map));
  }, [jobId]);

  const toggle = useCallback(async (itemId: string, checked: boolean) => {
    if (!jobId) return;
    const optimistic = items.map((i) => i.item_id === itemId ? { ...i, checked, checked_at: checked ? new Date().toISOString() : null } : i);
    setItems(optimistic);
    persistLocal(optimistic);
    const { error } = await supabase
      .from('job_checklists')
      .update({ checked, checked_at: checked ? new Date().toISOString() : null })
      .eq('job_id', jobId)
      .eq('item_id', itemId);
    if (error) {
      console.error('[useChecklist] toggle failed:', error);
      return;
    }
    const target = items.find((i) => i.item_id === itemId);
    await append({
      job_id: jobId,
      type: checked ? 'checklist_item_checked' : 'checklist_item_unchecked',
      payload: { item_id: itemId, section: target?.section, label: target?.label },
    });
  }, [jobId, items, append, persistLocal]);

  const skip = useCallback(async (itemId: string, reason: string) => {
    if (!jobId) return;
    const optimistic = items.map((i) => i.item_id === itemId ? { ...i, skipped: true, skip_reason: reason } : i);
    setItems(optimistic);
    persistLocal(optimistic);
    const { error } = await supabase
      .from('job_checklists')
      .update({ skipped: true, skip_reason: reason })
      .eq('job_id', jobId)
      .eq('item_id', itemId);
    if (error) {
      console.error('[useChecklist] skip failed:', error);
      return;
    }
    await append({ job_id: jobId, type: 'checklist_item_skipped', payload: { item_id: itemId, reason } });
  }, [jobId, items, append, persistLocal]);

  const allDone = items.length > 0 && items.every((i) => i.checked || i.skipped);
  const sectionDone = useCallback((section: ChecklistSectionKey) =>
    items.filter((i) => i.section === section).every((i) => i.checked || i.skipped)
  , [items]);

  return { items, loading, toggle, skip, allDone, sectionDone, reload: load };
}

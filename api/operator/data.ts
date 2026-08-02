/* eslint-disable @typescript-eslint/no-explicit-any */
import { canOperator, requireOperator, secureJson } from '../_lib/operator-auth';
import { supabaseRequest } from '../_lib/server-data';

export const config = { runtime: 'edge' };
const TABLES: Record<string, { read: string[]; write: string[]; filters: string[] }> = {
  jobs: { read: ['job_id','job_number','contact_id','proposal_id','stage','status','install_date','scheduled_start_window','deposit_status','deposit_paid_at','signed_at','final_payment_status','final_payment_paid_at','blocked_reason','blocked_note','blocked_at','needs_review_reason','access_notes','last_activity_at','last_activity_by','completed_at','archived_at','last_ghl_sync','ghl_stage','last_blocked_notification_at','created_at'], write: ['stage','status','blocked_reason','blocked_note','blocked_at','last_activity_at','last_blocked_notification_at'], filters: ['job_id','archived_at','deposit_status'] },
  job_fence_specs: { read: ['spec_id','job_id','fence_lines','gates','addons','total_sections','total_lf','proposal_total'], write: [], filters: ['job_id'] },
  job_checklists: { read: ['checklist_id','job_id','section','item_id','label','checked','checked_at','skippable','skipped','skip_reason','photo_required','photo_uploaded'], write: ['checked','checked_at','skipped','skip_reason','job_id','section','item_id','label','skippable','photo_required'], filters: ['job_id','item_id'] },
  job_photos: { read: ['photo_id','job_id','phase','url','uploaded_at','uploaded_by','synced'], write: ['photo_id','job_id','phase','url','synced'], filters: ['photo_id','job_id'] },
  job_issues: { read: ['issue_id','job_id','contact_id','type','severity','customer_visible','note','photos','section','created_by','created_at','resolved','resolved_at','resolution_note'], write: ['job_id','contact_id','type','severity','customer_visible','note','photos','section','created_by','resolved','resolved_at','resolution_note'], filters: ['job_id','issue_id','resolved'] },
  job_activity_log: { read: ['activity_id','job_id','contact_id','type','actor','source','payload','created_at'], write: ['job_id','contact_id','type','actor','source','payload'], filters: ['job_id'] },
};

function tableConfig(table: unknown) {
  return typeof table === 'string' && Object.hasOwn(TABLES, table) ? TABLES[table] : null;
}

function allowedSelect(requested: unknown, columns: string[]): string | null {
  if (requested === undefined || requested === '*') return columns.join(',');
  if (typeof requested !== 'string') return null;
  const fields = requested.split(',').map((field) => field.trim());
  return fields.length > 0 && fields.every((field) => columns.includes(field)) ? fields.join(',') : null;
}

function allowedValues(values: unknown, columns: string[]): boolean {
  const rows = Array.isArray(values) ? values : [values];
  return rows.every((row) => row && typeof row === 'object' && Object.keys(row as object).every((key) => columns.includes(key)));
}

export default async function handler(req: Request) {
  const operator = await requireOperator(req);
  if (!operator) return secureJson({ error: 'unauthorized' }, { status: 401 });
  if (!canOperator(operator, 'operator:data')) return secureJson({ error: 'forbidden' }, { status: 403 });
  if (req.method !== 'POST') return secureJson({ error: 'method not allowed' }, { status: 405 });
  let body: any; try { body = await req.json(); } catch { return secureJson({ error: 'invalid JSON' }, { status: 400 }); }
  const config = tableConfig(body.table);
  if (!config) return secureJson({ error: 'resource not allowed' }, { status: 400 });
  const operation = body.operation ?? 'select';
  if (!['select','insert','update'].includes(operation)) return secureJson({ error: 'operation not allowed' }, { status: 400 });
  if (operation !== 'select' && !allowedValues(body.values, config.write)) return secureJson({ error: 'field not allowed' }, { status: 400 });
  if (operation === 'insert') {
    const wasArray = Array.isArray(body.values);
    const rows = Array.isArray(body.values) ? body.values : [body.values];
    const normalized = rows.map((row: Record<string, unknown>) => body.table === 'job_activity_log'
      ? { ...row, actor: operator.sub }
      : body.table === 'job_issues' ? { ...row, created_by: operator.sub } : row);
    body.values = wasArray ? normalized : normalized[0];
  }
  if (operation === 'update' && (!body.filters?.length)) return secureJson({ error: 'update filter required' }, { status: 400 });
  let query = '';
  for (const filter of body.filters ?? []) {
    if (!filter || typeof filter !== 'object' || !config.filters.includes(filter.column) || !['eq','is','in'].includes(filter.type)) return secureJson({ error: 'filter not allowed' }, { status: 400 });
    if (filter.type === 'in' && !Array.isArray(filter.value)) return secureJson({ error: 'filter not allowed' }, { status: 400 });
    const value = filter.type === 'in' ? `(${filter.value.map((v: unknown) => encodeURIComponent(String(v))).join(',')})` : encodeURIComponent(String(filter.value));
    query += `${query ? '&' : ''}${filter.column}=${filter.type}.${value}`;
  }
  if (body.order) {
    if (!['install_date','created_at'].includes(body.order.column)) return secureJson({ error: 'order not allowed' }, { status: 400 });
    query += `${query ? '&' : ''}order=${body.order.column}.${body.order.options?.ascending === false ? 'desc' : 'asc'}`;
  }
  const select = allowedSelect(body.select, config.read);
  if (!select) return secureJson({ error: 'select field not allowed' }, { status: 400 });
  const init: RequestInit = operation === 'select' ? {} : { method: operation === 'insert' ? 'POST' : 'PATCH', body: JSON.stringify(body.values) };
  const db = await supabaseRequest(`${body.table}?${query}${query ? '&' : ''}select=${encodeURIComponent(select)}`, init);
  if (!db.ok) return secureJson({ error: 'data operation failed' }, { status: 502 });
  let data = await db.json();
  if (body.single === 'required') { if (!Array.isArray(data) || data.length !== 1) return secureJson({ error: 'expected one row' }, { status: 404 }); data = data[0]; }
  if (body.single === 'maybe') data = Array.isArray(data) ? data[0] ?? null : data;
  return secureJson({ data });
}

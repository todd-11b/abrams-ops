/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { operatorFetch } from '../utils/actor';

type Result = { data: any; error: { message: string } | null };

class Query implements PromiseLike<Result> {
  private request: Record<string, unknown>;
  constructor(table: string) { this.request = { table, filters: [] }; }
  select(columns = '*') { this.request.select = columns; return this; }
  insert(values: unknown) { this.request.operation = 'insert'; this.request.values = values; return this; }
  update(values: unknown) { this.request.operation = 'update'; this.request.values = values; return this; }
  eq(column: string, value: unknown) { (this.request.filters as any[]).push({ type: 'eq', column, value }); return this; }
  is(column: string, value: unknown) { (this.request.filters as any[]).push({ type: 'is', column, value }); return this; }
  in(column: string, values: unknown[]) { (this.request.filters as any[]).push({ type: 'in', column, value: values }); return this; }
  order(column: string, options?: unknown) { this.request.order = { column, options }; return this; }
  maybeSingle() { this.request.single = 'maybe'; return this; }
  single() { this.request.single = 'required'; return this; }
  async execute(): Promise<Result> {
    try {
      const res = await operatorFetch('/api/operator/data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this.request) });
      const body = await res.json().catch(() => ({}));
      return res.ok ? { data: body.data, error: null } : { data: null, error: { message: body.error ?? `request failed (${res.status})` } };
    } catch (error) { return { data: null, error: { message: error instanceof Error ? error.message : 'request failed' } }; }
  }
  then<TResult1 = Result, TResult2 = never>(onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null) { return this.execute().then(onfulfilled, onrejected); }
}

export const supabase = {
  from: (table: string) => new Query(table),
  storage: { from: (_bucket: string) => ({
    async upload(path: string, file: File, _options?: unknown) { const fd = new FormData(); fd.append('path', path); fd.append('file', file); const res = await operatorFetch('/api/operator/photos', { method: 'POST', body: fd }); const body = await res.json().catch(() => ({})); return res.ok ? { data: body, error: null } : { data: null, error: { message: body.error ?? 'upload failed' } }; },
    getPublicUrl(path: string) { return { data: { publicUrl: `/storage/v1/object/job-photos/${path}` } }; },
    async createSignedUrls(paths: string[], _expiresIn?: number): Promise<{ data: Array<{ signedUrl: string }> | null; error: { message: string } | null }> { const res = await operatorFetch('/api/operator/photos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths }) }); const body = await res.json().catch(() => ({})); return res.ok ? { data: body.data, error: null } : { data: null, error: { message: body.error ?? 'signed URL failed' } }; },
  }) },
};

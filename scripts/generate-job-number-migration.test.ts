// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// This guards the committed migration contract; it does not prove live application.
const migrationPath = fileURLToPath(
  new URL(
    '../supabase/migrations/20260810170636_harden_generate_job_number_search_path.sql',
    import.meta.url,
  ),
);
const migration = readFileSync(migrationPath, 'utf8');

describe('generate_job_number search-path hardening migration', () => {
  it('preserves the invoker trigger contract while removing mutable name resolution', () => {
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.generate_job_number\(\)/);
    expect(migration).toMatch(/RETURNS TRIGGER/);
    expect(migration).toMatch(/SECURITY INVOKER/);
    expect(migration).toMatch(/SET search_path = ''/);
    expect(migration).toContain("nextval('public.job_number_seq'::regclass)");
    expect(migration).toContain("'AF-' || EXTRACT(YEAR FROM NOW())::TEXT || '-' || LPAD(");
    expect(migration).not.toMatch(/CREATE\s+TRIGGER/i);
  });
});

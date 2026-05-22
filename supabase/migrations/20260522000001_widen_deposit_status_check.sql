-- 20260522000001_widen_deposit_status_check.sql
-- The initial schema's CHECK constraint on jobs.deposit_status was IN ('unpaid','paid').
-- The invoice-driven flow needs 'pending_invoice' as a valid state too.
-- The 20260522000000 migration assumed the column was freeform (the spec said so) but it wasn't.

ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_deposit_status_check;

ALTER TABLE jobs
  ADD CONSTRAINT jobs_deposit_status_check
  CHECK (deposit_status IN ('unpaid', 'paid', 'pending_invoice'));

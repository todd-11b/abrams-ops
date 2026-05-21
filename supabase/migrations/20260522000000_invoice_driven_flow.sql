-- 20260522000000_invoice_driven_flow.sql
-- Add signed_at to jobs and document the new pending_invoice deposit_status value.
-- deposit_status is freeform TEXT today; no constraint change required.

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ;

COMMENT ON COLUMN jobs.deposit_status IS
  'pending_invoice = signed, awaiting deposit; paid = deposit received; (other states reserved). Dashboard filters on deposit_status=paid for production visibility.';

COMMENT ON COLUMN jobs.signed_at IS
  'Set when the customer signs the proposal in SignPayView. Job exists in pending_invoice state until the GHL invoice-paid webhook flips it to paid.';

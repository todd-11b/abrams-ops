-- 20260522000002_final_payment_state.sql
-- Add final_payment_status + final_payment_paid_at to mirror the deposit pair.
-- Webhook routes paymentType='final_balance' invoices to these columns.

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS final_payment_status TEXT NOT NULL DEFAULT 'unpaid'
    CHECK (final_payment_status IN ('unpaid', 'pending_invoice', 'paid'));

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS final_payment_paid_at TIMESTAMPTZ;

COMMENT ON COLUMN jobs.final_payment_status IS
  'Mirrors deposit_status but for the final-balance invoice. Webhook flips unpaid→paid when GHL fires invoice.paid with paymentType=final_balance.';
COMMENT ON COLUMN jobs.final_payment_paid_at IS
  'Set when the GHL invoice-paid webhook flips final_payment_status to paid.';

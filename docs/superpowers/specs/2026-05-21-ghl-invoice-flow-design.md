# GHL-Invoice-Driven Deposit Flow — Design

**Date:** 2026-05-21
**Updated:** 2026-08-01
**Version:** 1.3
**Status:** Approved; Task 8 and containment integrated source-only, pending independent review
**Supersedes:** Stripe-in-SignPayView portion of `2026-05-21-production-module-design.md`

## Changelog

- **1.3 — 2026-08-01:** Standardizes activation: additive non-restrictive prerequisites; separately approved rotated credentials/secrets before compatible-build activation; non-customer proof; restrictive cutover last.
- **1.2 — 2026-08-01:** Integrates Task 8 final-balance behavior with opaque proposal tokens, exactly-once job creation, protected operator APIs, and the staged containment activation sequence.
- **1.1 — 2026-08-01:** Records the approved single-endpoint final-balance path, schema-valid state handling, race verification, and fail-soft GHL HTTP observability.
- **1.0 — 2026-05-21:** Approved invoice-driven deposit flow.

## Why

The current `SignPayView.tsx` renders a Stripe `CardElement` but the payment is **simulated** — there is no `PaymentIntent`, no `confirmCardPayment`, and no Stripe secret key in the environment. Deposit collection actually happens (and will continue to happen) via GHL invoices sent to the customer outside the app. The simulated Stripe path is misleading and must be removed.

Job creation must move off the signature event and onto the actual money-received event so that `/production` only shows jobs whose deposits have cleared.

Activation is separately gated: additive database prerequisites alone do not activate the new authentication boundary. Todd must approve and configure rotated operator credentials and required server-only secrets before the compatible server/API/UI build becomes active. Non-customer login, signing, webhook, and rollback proof follows; restrictive table/storage cutover is last, and rollback never restores exposed credentials.

## Flow (target state)

```
┌──────────────────────┐
│ SignPayView          │  Customer signs proposal (signature only, no payment UI)
│ /consult … Sign step │
└──────────┬───────────┘
           │ POST /api/proposal/create-job
           ▼
┌──────────────────────────────────────────────────────────────┐
│ create-job.ts (signature-time)                              │
│  1. INSERT jobs (deposit_status='pending_invoice',           │
│     signed_at=NOW())                                         │
│  2. INSERT job_fence_specs                                   │
│  3. INSERT job_activity_log (type='proposal_signed')         │
│  4. PUT  GHL opportunity status='won'                        │
│  5. POST GHL contact note "Proposal signed — invoice pending"│
│  Returns { job_id, job_number }                              │
└──────────────────────────────────────────────────────────────┘
           │
           │  (Todd or a GHL workflow sends the invoice;
           │   not driven by this app.)
           ▼
┌──────────────────────┐
│ Customer pays GHL    │
│ invoice via link     │
└──────────┬───────────┘
           │ GHL webhook → invoice.paid
           ▼
┌──────────────────────────────────────────────────────────────┐
│ /api/webhooks/ghl-invoice-paid.ts                            │
│  Auth: X-Abrams-Webhook-Secret == GHL_WEBHOOK_SECRET         │
│  Idempotency guard (see below)                               │
│  1. UPDATE jobs SET deposit_status='paid',                   │
│     deposit_paid_at=NOW()                                    │
│     WHERE proposal_id=? AND deposit_status='pending_invoice' │
│  2. INSERT job_activity_log (type='deposit_paid_via_invoice')│
│  3. PUT  GHL opportunity → 'Job Created' stage in Fence      │
│     Production pipeline                                      │
│  4. POST GHL contact note "Deposit received — job {n} moving │
│     to production"                                           │
│  Job becomes visible on /production dashboard.               │
└──────────────────────────────────────────────────────────────┘
```

## Architectural decisions (locked in brainstorming)

### D1 — Single source of truth: `jobs` table reused across states

The `jobs` row is created at signature time with `deposit_status='pending_invoice'`. The invoice-paid webhook **flips state** rather than creating a new row.

Why: one table, one lifecycle. Gives operational visibility into "signed but unpaid" in the same place as paid jobs.

### D2 — Webhook-to-job matching: `proposal_id` (GHL opportunity id)

The invoice-paid webhook identifies the target job via the GHL opportunity ID in the payload, matched against `jobs.proposal_id`.

Lookup: `WHERE proposal_id = <payload.opportunity_id> AND deposit_status = 'pending_invoice'`.

No-match path: return 422, log the full payload, and fire an SMS to Todd (see §SMS-on-failure).

Why: clean and deterministic. Coupling to invoice-from-opportunity flow in GHL is acceptable because that's how the operations team sends invoices today. Ad-hoc invoice support can be added later via a fallback chain.

### D3 — Webhook auth: shared-secret header + soft IP allowlist

- `GHL_WEBHOOK_SECRET` env var (32-char random string, Vercel server-only).
- GHL workflow configures the webhook action to send header `X-Abrams-Webhook-Secret: <secret>`.
- Endpoint compares constant-time. Mismatch → 401 + log + SMS to Todd with source IP.
- Source IP outside GHL's published outbound range → log only; do not reject. The agent looks up GHL's current IP range before hardcoding any value.

Why: matches the threat model (one GHL sub-account talking to one Vercel endpoint, internal ops app, low traffic). HMAC payload signing is overkill for a workflow-driven webhook config.

## Idempotency (explicit requirement, not just test coverage)

The webhook handler MUST guard against duplicate fires at the implementation level, before any side effects:

1. Read the job row by `proposal_id`.
2. If `deposit_status = 'paid'` already, return `200 OK` with body `{ already_processed: true, job_id }` and **exit silently**. Do not re-fire the activity log, GHL stage move, GHL note, or any SMS.
3. If `deposit_status = 'pending_invoice'`, proceed with the state flip (atomic UPDATE with `WHERE deposit_status='pending_invoice'` to prevent races).
4. If no row matches `proposal_id`, return 422 + log + SMS (see below). This is "no match ever," not "already processed."

Why: GHL retries webhooks on non-2xx responses. A noisy retry must not double-post notes, double-log activity, or send phantom SMS alerts.

## SMS-on-failure path

When the webhook handler hits either of these conditions, it fires an SMS to Todd via the existing GHL conversations message API to `VITE_GHL_TODD_CONTACT_ID` = `ExampleContactId12345`:

**No-match (422):**
```
🚨 ABRAMS ALERT
Invoice paid but no matching job found.
Contact ID: {contactId}
Invoice ID: {invoiceId}
Check Supabase — manual intervention required.
```

**Bad webhook secret (401):**
```
🚨 ABRAMS ALERT
Unauthorized invoice webhook attempt.
Source IP: {ip}
Header value: {header || 'missing'}
```

Reuses the same GHL conversations POST pattern used today by the block-notification path. No new infra.

## Schema changes

Migration: `supabase/migrations/20260522000000_invoice_driven_flow.sql`

```sql
ALTER TABLE jobs ADD COLUMN signed_at timestamptz;

COMMENT ON COLUMN jobs.deposit_status IS
  'pending_invoice = signed, awaiting deposit; paid = deposit received; (other states reserved)';
```

`deposit_status` is freeform text today, so no constraint or enum change is required. New valid value: `'pending_invoice'`. Existing value `'paid'` is unchanged.

No new column for `ghl_invoice_id` — matching is by `proposal_id` (D2).

## File-level changes

### `src/components/consult/SignPayView.tsx` — strip Stripe entirely

Remove:
- `loadStripe`, `Elements`, `CardElement`, `useStripe`, `useElements` imports
- `stripePromise` constant
- The `PaymentForm` inner component's Stripe hooks (`useStripe()`, `useElements()`)
- The `<Elements stripe={stripePromise}>` wrapper in the exported `SignPayView`
- The simulated `await new Promise(res => setTimeout(res, 1500))`
- The "Deposit Payment" section (`<CardElement>` block, lines ~215-231)
- The `Sign & Pay Deposit ({cur(totals.deposit)})` CTA text

Change:
- Component file no longer imports from `@stripe/*`. Verify `package.json` — Stripe packages can stay (no harm) but they're no longer used by this view.
- CTA text → "Sign Proposal"
- Subtitle under header → "Review your investment, then sign to lock it in."
- Success card heading → "Proposal Signed!"
- Success card body → "Thanks, {first}! You'll receive your deposit invoice shortly via text and email. Your project moves to production as soon as the deposit clears."
- "Deposit Paid" line on the success summary → "Deposit Due" (still shown, still informational)
- The signature canvas, the investment recap card, the back button: unchanged

The `handlePayAndSign` handler (rename → `handleSign`) keeps the call to `/api/proposal/create-job` but no longer fires the legacy GHL `opportunities/{id}` status=won PUT or the legacy contact note from the browser. Those move server-side into `create-job.ts` so they're authoritative and survive client-tab-close.

### `api/proposal/create-job.ts` — signature-time job creation

Repurposed responsibilities (called from the signature handler):

1. INSERT `jobs` with `deposit_status='pending_invoice'`, `signed_at=NOW()`, `stage='job_created'`. The `stage` column tracks the internal job lifecycle (job_created → scheduled → in_install → job_complete); it stays `job_created` from signature onward because the row exists in our system. **`deposit_status` is the gate for production visibility**, not `stage`. Any dashboard query that filters on `stage='job_created'` alone must also filter on `deposit_status='paid'`.

2. INSERT `job_fence_specs` (unchanged from today).

3. INSERT `job_activity_log` with `type='proposal_signed'` (new type; today it's `type='job_created'`).

4. PUT GHL opportunity status='won' (moved from SignPayView client).

5. POST GHL contact note: `[AUTO] Proposal signed — invoice pending\nProposal {id}\nDeposit due: {amount}`.

The GHL stage move to `Job Created` in the Fence Production pipeline is **removed from this function** — it now happens in the webhook (step 3 of the invoice-paid handler) when the deposit actually clears.

Returns `{ job_id, job_number }` (unchanged shape).

### `api/webhooks/ghl-invoice-paid.ts` — NEW endpoint

```
POST /api/webhooks/ghl-invoice-paid
Headers:
  X-Abrams-Webhook-Secret: <GHL_WEBHOOK_SECRET>
  Content-Type: application/json
Body (GHL invoice.paid payload, fields used):
  {
    contactId: string,
    opportunityId: string,   // mapped to jobs.proposal_id
    invoiceId: string,
    amountPaid: number,
    paidAt: string (ISO),
    ...
  }
```

Handler flow:

1. Auth check: constant-time compare header against `GHL_WEBHOOK_SECRET`. Mismatch → 401 + log + SMS Todd. Return early.
2. IP check (soft): if source IP outside GHL's published outbound range, log a warning. Do not reject.
3. Parse + validate body. Missing `opportunityId` → 400 with `{ error: 'opportunityId required' }`.
4. SELECT job by `proposal_id = opportunityId`.
   - No row → 422 + log + SMS Todd ("no matching job found"). Return.
   - `deposit_status = 'paid'` already → return 200 with `{ already_processed: true, job_id }`. **No further side effects.**
5. UPDATE `jobs SET deposit_status='paid', deposit_paid_at=NOW() WHERE proposal_id=? AND deposit_status='pending_invoice'`. (The status guard in the WHERE clause prevents a race between two simultaneous webhook deliveries.)
6. INSERT `job_activity_log` with `type='deposit_paid_via_invoice'`, payload `{ invoice_id, amount_paid }`.
7. PUT GHL opportunity → `pipelineStageId: GHL_STAGE_JOB_CREATED` in the Fence Production pipeline. Fail-soft (log, don't roll back).
8. POST GHL contact note: `[AUTO] Deposit received — job {number} moving to production`. Fail-soft.
9. Return 201 with `{ job_id, job_number, status: 'paid' }`.

Env vars required (server-only, no `VITE_` prefix):
- `GHL_WEBHOOK_SECRET` — new
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — existing
- `GHL_API_KEY`, `GHL_STAGE_JOB_CREATED` — existing
- `GHL_TODD_CONTACT_ID` — NEW server-only copy of the existing `VITE_GHL_TODD_CONTACT_ID` (value: `ExampleContactId12345`). Required because edge functions must not read `VITE_*` env vars (those are client-bundled).

### `src/components/production/*` — dashboard filter

The dashboard query that powers `/production` (office view) must filter on `deposit_status = 'paid'` in addition to the existing `archived_at IS NULL`. Jobs in `pending_invoice` state are invisible to the crew — they're not real production work until money has moved.

The "Signed, awaiting deposit" panel is **out of scope** for this iteration. Future work if Todd wants visibility.

## Activity log additions

Two new `type` values used in `job_activity_log` inserts:

- `proposal_signed` — written by `create-job.ts` at signature.
- `deposit_paid_via_invoice` — written by the webhook on state flip.

The existing `job_created` type is retired from this flow (signature is now the creation event, but its semantic name is `proposal_signed`). Any historical rows with `type='job_created'` remain untouched.

## Tests

### `api/webhooks/ghl-invoice-paid.test.ts` (new)

- Happy path: valid secret, valid payload, pending_invoice job → 201, state flips, activity log appended once, GHL stage moved.
- Bad secret: 401, SMS fired with source IP, no DB writes.
- Missing secret header: 401, SMS fired.
- No matching job: 422, SMS fired with contact + invoice IDs, no DB writes.
- Duplicate fire (job already `paid`): 200 with `{ already_processed: true }`, **no** activity log row, **no** GHL stage move, **no** SMS, **no** new note.
- IP outside GHL range with valid secret: succeeds (no reject), warning logged.
- Missing `opportunityId` in payload: 400.

### `api/proposal/create-job.test.ts` (update existing)

- Inserts job with `deposit_status='pending_invoice'` and `signed_at` set.
- Inserts fence_spec, activity_log with `type='proposal_signed'`.
- Calls GHL opp status=won and posts the signature note.
- Does NOT call the GHL stage-move endpoint.

### `src/components/consult/SignPayView.test.tsx` (update existing)

- Renders without any Stripe components.
- Sign button is disabled until signature canvas has strokes.
- On sign, POSTs to `/api/proposal/create-job` and shows the new success copy.

## Out of scope (V2)

- Signature image persistence (drawn but not uploaded anywhere — same as today).
- "Signed, awaiting deposit" dashboard panel.
- Ad-hoc invoice support (invoice not tied to an opportunity).
- GHL invoice creation via API from the signature handler (deferred to a GHL workflow Todd configures in GHL UI).
- HMAC payload-signature verification on the webhook.

## Task 8 addendum — final-balance invoice path

The same authenticated endpoint handles final-balance payment notifications when
`paymentType='final_balance'`. Missing `paymentType` remains deposit behavior for
backwards compatibility; unknown values return 400.

The final-balance path:

1. Reads the job by `proposal_id` and returns idempotent success only when
   `final_payment_status='paid'`.
2. Atomically updates either schema-valid non-paid state (`unpaid` or
   `pending_invoice`) to `paid` and sets `final_payment_paid_at`.
3. If the guarded PATCH changes zero rows, re-reads the job. It returns
   `already_processed` only when that read confirms `paid`; otherwise it returns
   an error without activity or GHL side effects.
4. Appends `final_payment_via_invoice` with `source='workflow'`.
5. Fail-soft moves the GHL opportunity to `GHL_STAGE_JOB_COMPLETE` and posts the
   final-payment note. Network exceptions and HTTP non-2xx responses are logged;
   neither rolls back authoritative Supabase state.

This addendum supersedes the production-module V1 deferral that described final
payment as internal-only. It does not authorize deployment, environment changes,
or live end-to-end testing.

## Settled decisions — do not re-litigate

- `jobs` table is the single source of truth (D1).
- Matching is by `proposal_id` / opportunity ID (D2).
- Auth is shared-secret header + soft IP log (D3).
- GHL "won" status fires on **signature**, not on invoice paid.
- GHL Fence Production stage move fires on **invoice paid**, not on signature.
- Idempotency is enforced in code, not only in tests.

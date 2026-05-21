# GHL-Invoice-Driven Deposit Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the simulated Stripe path from `SignPayView`, persist signed proposals as `pending_invoice` jobs, and route deposit confirmation through a new GHL `invoice.paid` webhook that flips the job to `paid` and reveals it on the `/production` dashboard.

**Architecture:** Single source of truth on `jobs` (D1). Webhook-to-job matching by GHL opportunity id stored in `jobs.proposal_id` (D2). Shared-secret header auth with soft IP allowlist (D3). Idempotency enforced in the handler before any side effects, not just in tests. Activity log gets two new types: `proposal_signed`, `deposit_paid_via_invoice`. The `jobs` row exists from signature onward; the webhook flips state and triggers the GHL stage move.

**Tech Stack:** Vite + React + TypeScript frontend; Vercel edge functions in `/api`; Supabase Postgres (`illrhpijyhldxadjiwkw`); GoHighLevel v2 (`bH5Evh3TnMG92y3HiS0n`); vitest + happy-dom for tests.

**Spec:** `docs/superpowers/specs/2026-05-21-ghl-invoice-flow-design.md` — read it before any task that's ambiguous.

---

## File map

**Create:**
- `supabase/migrations/20260522000000_invoice_driven_flow.sql`
- `api/webhooks/ghl-invoice-paid.ts`
- `api/webhooks/ghl-invoice-paid.test.ts`
- `api/proposal/create-job.test.ts`
- `src/components/consult/SignPayView.test.tsx`

**Modify:**
- `src/components/consult/SignPayView.tsx` — strip Stripe, signature-only UX
- `api/proposal/create-job.ts` — signature-time creation + GHL won + signed note (no more stage move)
- `src/hooks/useJobs.ts` — add `deposit_status='paid'` filter
- `.env.example` — add `GHL_WEBHOOK_SECRET`, `GHL_TODD_CONTACT_ID`
- (`.env.local` on disk — operator step, see Task 6)

---

## Task 1: Schema migration — add `signed_at`, accept `pending_invoice` deposit status

**Files:**
- Create: `supabase/migrations/20260522000000_invoice_driven_flow.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260522000000_invoice_driven_flow.sql`:

```sql
-- 20260522000000_invoice_driven_flow.sql
-- Add signed_at to jobs and document the new pending_invoice deposit_status value.
-- deposit_status is freeform TEXT today; no constraint change required.

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ;

COMMENT ON COLUMN jobs.deposit_status IS
  'pending_invoice = signed, awaiting deposit; paid = deposit received; (other states reserved). Dashboard filters on deposit_status=paid for production visibility.';

COMMENT ON COLUMN jobs.signed_at IS
  'Set when the customer signs the proposal in SignPayView. Job exists in pending_invoice state until the GHL invoice-paid webhook flips it to paid.';
```

- [ ] **Step 2: Apply the migration to Supabase**

Run the migration via the Supabase CLI or directly through the dashboard SQL editor. The expected method matches existing migrations in `supabase/migrations/` — push using the same workflow Todd used for `20260521000000_production_module_additions.sql` (Supabase dashboard → SQL editor → paste and run, or `supabase db push` if the local link is configured).

Expected outcome: `\d jobs` shows the new `signed_at` column.

- [ ] **Step 3: Verify the column exists**

In the Supabase SQL editor:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'jobs' AND column_name = 'signed_at';
```

Expected: one row, `data_type = 'timestamp with time zone'`, `is_nullable = 'YES'`.

- [ ] **Step 4: Update the `Job` TypeScript type**

Open `src/types/production.ts`. Find the `Job` interface (it contains `last_blocked_notification_at`). Add `signed_at`:

```typescript
signed_at: string | null;
```

Add it next to `deposit_paid_at` for logical grouping.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260522000000_invoice_driven_flow.sql src/types/production.ts
git commit -m "feat(db): add jobs.signed_at and document pending_invoice deposit_status"
```

---

## Task 2: Refactor `create-job.ts` for signature-time creation

**Files:**
- Modify: `api/proposal/create-job.ts`
- Create: `api/proposal/create-job.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `api/proposal/create-job.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import handler from './create-job';

const SUPABASE_URL = 'https://test.supabase.co';
const GHL_BASE = 'https://services.leadconnectorhq.com';

beforeEach(() => {
  process.env.SUPABASE_URL = SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  process.env.GHL_API_KEY = 'test-ghl-key';
  process.env.GHL_LOCATION_ID = 'test-loc';
  vi.restoreAllMocks();
});

function mockFetch(routes: Record<string, { status: number; body: unknown }>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    for (const [match, resp] of Object.entries(routes)) {
      if (url.includes(match)) {
        return new Response(JSON.stringify(resp.body), { status: resp.status });
      }
    }
    return new Response('{}', { status: 200 });
  });
}

function makeReq(body: unknown): Request {
  return new Request('http://test/api/proposal/create-job', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('create-job (signature-time)', () => {
  it('inserts job with deposit_status=pending_invoice and signed_at set', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push({ url, init: init || {} });
      if (url.includes('/rest/v1/jobs') && (init?.method || 'GET') === 'POST') {
        return new Response(JSON.stringify([{ job_id: 'job-uuid', job_number: 'AF-2026-0002' }]), { status: 201 });
      }
      return new Response('[]', { status: 201 });
    }));

    const res = await handler(makeReq({
      contact_id: 'contact-1',
      proposal_opportunity_id: 'opp-1',
      fence_spec: { fence_lines: [], gates: [], addons: [], total_sections: 0, total_lf: 0, proposal_total: 1000 },
    }));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.job_id).toBe('job-uuid');

    const jobInsert = calls.find(c => c.url.includes('/rest/v1/jobs') && (c.init.method || 'GET') === 'POST');
    expect(jobInsert).toBeDefined();
    const body = JSON.parse(jobInsert!.init.body as string);
    expect(body.deposit_status).toBe('pending_invoice');
    expect(body.signed_at).toBeTruthy();
    expect(body.deposit_paid_at).toBeUndefined();
    expect(body.stage).toBe('job_created');
  });

  it('inserts activity log with type=proposal_signed', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push({ url, init: init || {} });
      if (url.includes('/rest/v1/jobs') && (init?.method || 'GET') === 'POST') {
        return new Response(JSON.stringify([{ job_id: 'j1', job_number: 'AF-2026-0003' }]), { status: 201 });
      }
      return new Response('[]', { status: 201 });
    }));

    await handler(makeReq({ contact_id: 'c1', proposal_opportunity_id: 'opp-1' }));

    const activityInsert = calls.find(c => c.url.includes('/rest/v1/job_activity_log'));
    expect(activityInsert).toBeDefined();
    const body = JSON.parse(activityInsert!.init.body as string);
    expect(body.type).toBe('proposal_signed');
  });

  it('PUTs GHL opportunity status=won', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push({ url, init: init || {} });
      if (url.includes('/rest/v1/jobs') && (init?.method || 'GET') === 'POST') {
        return new Response(JSON.stringify([{ job_id: 'j1', job_number: 'AF-2026-0004' }]), { status: 201 });
      }
      return new Response('{}', { status: 200 });
    }));

    await handler(makeReq({ contact_id: 'c1', proposal_opportunity_id: 'opp-xyz' }));

    const wonPut = calls.find(c =>
      c.url.includes('/opportunities/opp-xyz') && c.init.method === 'PUT'
    );
    expect(wonPut).toBeDefined();
    const body = JSON.parse(wonPut!.init.body as string);
    expect(body.status).toBe('won');
    // It must NOT set a pipelineStageId — stage move is deferred to invoice-paid.
    expect(body.pipelineStageId).toBeUndefined();
  });

  it('POSTs the signature note to the GHL contact', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push({ url, init: init || {} });
      if (url.includes('/rest/v1/jobs') && (init?.method || 'GET') === 'POST') {
        return new Response(JSON.stringify([{ job_id: 'j1', job_number: 'AF-2026-0005' }]), { status: 201 });
      }
      return new Response('{}', { status: 200 });
    }));

    await handler(makeReq({
      contact_id: 'contact-abc',
      proposal_opportunity_id: 'opp-1',
      proposal_display_id: 'P-1234',
      deposit_due: 5000,
    }));

    const note = calls.find(c => c.url.includes('/contacts/contact-abc/notes'));
    expect(note).toBeDefined();
    const body = JSON.parse(note!.init.body as string);
    expect(body.body).toContain('Proposal signed');
    expect(body.body).toContain('invoice pending');
    expect(body.body).toContain('P-1234');
  });

  it('does NOT move the GHL pipeline stage', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      calls.push({ url, init: init || {} });
      if (url.includes('/rest/v1/jobs') && (init?.method || 'GET') === 'POST') {
        return new Response(JSON.stringify([{ job_id: 'j1', job_number: 'AF-2026-0006' }]), { status: 201 });
      }
      return new Response('{}', { status: 200 });
    }));

    await handler(makeReq({ contact_id: 'c1', proposal_opportunity_id: 'opp-1' }));

    const stageMove = calls.find(c => {
      if (!c.url.includes('/opportunities/')) return false;
      if (c.init.method !== 'PUT') return false;
      const body = c.init.body ? JSON.parse(c.init.body as string) : {};
      return 'pipelineStageId' in body;
    });
    expect(stageMove).toBeUndefined();
  });

  it('returns 502 when the job insert fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/rest/v1/jobs') && (init?.method || 'GET') === 'POST') {
        return new Response('insert failed', { status: 500 });
      }
      return new Response('{}', { status: 200 });
    }));

    const res = await handler(makeReq({ contact_id: 'c1', proposal_opportunity_id: 'opp-1' }));
    expect(res.status).toBe(502);
  });

  it('rejects non-POST', async () => {
    const res = await handler(new Request('http://test/api/proposal/create-job', { method: 'GET' }));
    expect(res.status).toBe(405);
  });

  it('rejects missing contact_id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    const res = await handler(makeReq({ proposal_opportunity_id: 'opp-1' }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `bun run test -- create-job`

Expected: tests fail because the current `create-job.ts` sets `deposit_status='paid'` and `deposit_paid_at`, doesn't set `signed_at`, doesn't fire the GHL won PUT or the signature note, and DOES move the pipeline stage.

- [ ] **Step 3: Rewrite `api/proposal/create-job.ts`**

Replace the entire file with:

```typescript
// api/proposal/create-job.ts
// Vercel edge function — called by SignPayView when the customer signs the
// proposal. Creates the job row in Supabase with deposit_status='pending_invoice'
// and signed_at=NOW(), appends the activity log, marks the GHL opportunity as
// 'won', and posts a signature note. The deposit itself clears via a separate
// GHL invoice; the invoice-paid webhook flips the job to 'paid' and moves the
// GHL pipeline stage.
//
// Required env (server-only):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   GHL_API_KEY
//   GHL_LOCATION_ID

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const GHL_API_KEY = process.env.GHL_API_KEY ?? '';
const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(init.headers || {}) },
  });
}

interface RequestBody {
  contact_id: string;
  proposal_opportunity_id: string | null;
  proposal_display_id?: string;
  deposit_due?: number;
  fence_spec?: {
    fence_lines: unknown[];
    gates: unknown[];
    addons: unknown[];
    total_sections: number;
    total_lf: number;
    proposal_total: number;
  };
}

async function sb(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(init.headers || {}),
    },
  });
}

function ghlHeaders() {
  return {
    Authorization: `Bearer ${GHL_API_KEY}`,
    'Content-Type': 'application/json',
    Version: GHL_VERSION,
  };
}

function fmtCurrency(n: number | undefined): string {
  if (typeof n !== 'number') return '—';
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export default async function handler(req: Request) {
  if (req.method !== 'POST') return json({ error: 'POST only' }, { status: 405 });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return json({ error: 'Server misconfigured: Supabase env missing' }, { status: 500 });
  }

  let body: RequestBody;
  try { body = await req.json(); }
  catch { return json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (!body.contact_id) return json({ error: 'contact_id required' }, { status: 400 });

  const nowIso = new Date().toISOString();

  // 1) Insert job (mutation ordering step 1).
  const jobRes = await sb('jobs', {
    method: 'POST',
    body: JSON.stringify({
      contact_id: body.contact_id,
      proposal_id: body.proposal_opportunity_id,
      stage: 'job_created',
      status: 'active',
      deposit_status: 'pending_invoice',
      signed_at: nowIso,
    }),
  });
  if (!jobRes.ok) {
    const t = await jobRes.text().catch(() => '');
    return json({ error: 'jobs insert failed', detail: t }, { status: 502 });
  }
  const [job] = (await jobRes.json()) as { job_id: string; job_number: string }[];

  // 1b) Insert fence spec if provided (best-effort).
  if (body.fence_spec) {
    await sb('job_fence_specs', {
      method: 'POST',
      body: JSON.stringify({ job_id: job.job_id, ...body.fence_spec }),
    });
  }

  // 2) Append activity log (step 2). If this fails, the job still exists.
  await sb('job_activity_log', {
    method: 'POST',
    body: JSON.stringify({
      job_id: job.job_id,
      contact_id: body.contact_id,
      type: 'proposal_signed',
      actor: 'system',
      source: 'system',
      payload: { proposal_opportunity_id: body.proposal_opportunity_id ?? null },
    }),
  });

  // 3a) Mark GHL opportunity as won (fail-soft).
  if (body.proposal_opportunity_id && GHL_API_KEY) {
    try {
      await fetch(`${GHL_BASE}/opportunities/${body.proposal_opportunity_id}`, {
        method: 'PUT',
        headers: ghlHeaders(),
        body: JSON.stringify({ status: 'won' }),
      });
    } catch (err) {
      console.error('[create-job] GHL status=won failed:', err);
    }
  }

  // 3b) Post the signature note (fail-soft).
  if (GHL_API_KEY) {
    try {
      const noteBody = [
        '[AUTO] Proposal signed — invoice pending',
        body.proposal_display_id ? `Proposal ${body.proposal_display_id}` : null,
        typeof body.deposit_due === 'number' ? `Deposit due: ${fmtCurrency(body.deposit_due)}` : null,
      ].filter(Boolean).join('\n');
      await fetch(`${GHL_BASE}/contacts/${body.contact_id}/notes`, {
        method: 'POST',
        headers: ghlHeaders(),
        body: JSON.stringify({ body: noteBody }),
      });
    } catch (err) {
      console.error('[create-job] GHL signature note failed:', err);
    }
  }

  return json({ job_id: job.job_id, job_number: job.job_number }, { status: 201 });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test -- create-job`

Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add api/proposal/create-job.ts api/proposal/create-job.test.ts
git commit -m "feat(create-job): signature-time job creation with pending_invoice state"
```

---

## Task 3: Strip Stripe from `SignPayView.tsx`

**Files:**
- Modify: `src/components/consult/SignPayView.tsx`
- Create: `src/components/consult/SignPayView.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/consult/SignPayView.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SignPayView } from './SignPayView';
import type { ConsultFormData } from './consultTypes';

const baseForm: ConsultFormData = {
  contactId: 'contact-1',
  contactName: 'Test Customer',
  contactPhone: '5551234567',
  contactEmail: 'test@example.com',
  pipelineStage: '',
  opportunityId: 'opp-1',
  propertyAddress: '',
  hoaApproval: '',
  sprinklers: '',
  lotNotes: '',
  yardSensitivity: '',
  cleanSiteRisks: '',
  petConsiderations: '',
  fenceType: '',
  fenceLines: [],
  gates: { walk: { qty: 0, price: 0 }, double: { qty: 0, price: 0 } },
  gateInstances: [],
  obstructions: [],
  addOns: {
    demo: { enabled: false, lf: 0, pricePerLf: 0 },
    stain: { enabled: false, sf: 0, pricePerSf: 0 },
    poolLatch: { enabled: false, qty: 0, priceEach: 0 },
  },
  purposes: [],
  timeline: '',
  photos: [],
  // Any remaining required fields from consultTypes.ts default to empty/zero.
  // If TypeScript complains about missing fields, copy them from the type
  // definition with neutral defaults.
} as ConsultFormData;

describe('SignPayView (signature-only)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders without any Stripe CardElement', () => {
    render(<SignPayView form={baseForm} onBack={() => {}} proposalId="P-1" />);
    // CardElement renders an iframe; assert none present.
    expect(document.querySelectorAll('iframe').length).toBe(0);
    expect(screen.queryByText(/card number/i)).toBeNull();
  });

  it('shows the "Sign Proposal" CTA, not "Sign & Pay Deposit"', () => {
    render(<SignPayView form={baseForm} onBack={() => {}} proposalId="P-1" />);
    expect(screen.getByRole('button', { name: /sign proposal/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /sign & pay/i })).toBeNull();
  });

  it('POSTs to /api/proposal/create-job on sign and shows the new success copy', async () => {
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      const u = typeof url === 'string' ? url : url.toString();
      if (u.endsWith('/api/proposal/create-job')) {
        return new Response(JSON.stringify({ job_id: 'j1', job_number: 'AF-2026-0007' }), { status: 201 });
      }
      return new Response('{}', { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<SignPayView form={baseForm} onBack={() => {}} proposalId="P-1" />);

    // Simulate that the signature pad is non-empty by triggering at least one stroke.
    // SignatureCanvas exposes an internal API but for this test we just bypass the
    // empty check by drawing onto its underlying canvas via PointerEvents.
    const canvas = document.querySelector('canvas')!;
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(canvas, { clientX: 20, clientY: 20 });
    fireEvent.pointerUp(canvas);

    fireEvent.click(screen.getByRole('button', { name: /sign proposal/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/proposal/create-job',
        expect.objectContaining({ method: 'POST' })
      );
    });

    await waitFor(() => {
      expect(screen.getByText(/proposal signed/i)).toBeTruthy();
    });
    expect(screen.getByText(/invoice/i)).toBeTruthy();
  });

  it('blocks submission when signature pad is empty', () => {
    render(<SignPayView form={baseForm} onBack={() => {}} proposalId="P-1" />);
    fireEvent.click(screen.getByRole('button', { name: /sign proposal/i }));
    expect(screen.getByText(/provide a signature/i)).toBeTruthy();
  });
});
```

Notes for the implementer:
- The `proposalId` prop is added in this task — `SignPayView` previously read it from `form.proposalId`, but `ConsultFormData` doesn't have that field today. Pass it down explicitly from the caller (see the consult flow's parent component).
- If `@testing-library/react` is not yet installed, add it as a dev dep: `bun add -D @testing-library/react @testing-library/jest-dom`.

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `bun run test -- SignPayView`

Expected: tests fail — CardElement iframe is present, CTA text mismatches, fetch URL is wrong, etc.

- [ ] **Step 3: Rewrite `src/components/consult/SignPayView.tsx`**

Replace the entire file with:

```tsx
import { useState, useRef } from "react";
import { ArrowLeft, Loader2, CheckCircle } from "lucide-react";
import SignatureCanvas from "react-signature-canvas";
import { ConsultFormData, calcTotals } from "./consultTypes";

interface Props {
  form: ConsultFormData;
  onBack: () => void;
  proposalId: string;
}

function cur(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

export const SignPayView = ({ form, onBack, proposalId }: Props) => {
  const totals = calcTotals(form);
  const sigPad = useRef<SignatureCanvas>(null);
  const [processing, setProcessing] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSign = async () => {
    if (sigPad.current?.isEmpty()) {
      setError("Please provide a signature before proceeding.");
      return;
    }
    setProcessing(true);
    setError(null);

    try {
      const totalLf = form.fenceLines.reduce((sum, l) => sum + (l.linearFeet || 0), 0);
      const resp = await fetch('/api/proposal/create-job', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: form.contactId,
          proposal_opportunity_id: form.opportunityId || null,
          proposal_display_id: proposalId,
          deposit_due: totals.deposit,
          fence_spec: {
            fence_lines: form.fenceLines,
            gates: form.gateInstances,
            addons: [
              ...(form.addOns.demo.enabled ? [{ type: 'demo', ...form.addOns.demo }] : []),
              ...(form.addOns.stain.enabled ? [{ type: 'stain', ...form.addOns.stain }] : []),
              ...(form.addOns.poolLatch.enabled ? [{ type: 'poolLatch', ...form.addOns.poolLatch }] : []),
            ],
            total_sections: totals.totalSections,
            total_lf: totalLf,
            proposal_total: totals.grandTotal,
          },
        }),
      });

      if (!resp.ok) {
        const t = await resp.text().catch(() => '');
        console.error('[SignPayView] create-job failed:', resp.status, t);
        setError("We couldn't record your signature. Please try again or call us.");
        return;
      }

      setSuccess(true);
    } catch (err) {
      console.error('[SignPayView] create-job network failure:', err);
      setError("Network error. Please try again.");
    } finally {
      setProcessing(false);
    }
  };

  if (success) {
    const first = form.contactName ? form.contactName.split(" ")[0] : "there";
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6" style={{ background: "#f4f6f9" }}>
        <div style={{ textAlign: "center", maxWidth: 400, width: "100%" }}>
          <div style={{ width: 72, height: 72, borderRadius: "50%", background: "#e0f2eb", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
            <CheckCircle size={36} color="#1d9e75" />
          </div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: "#0a1f3d", margin: "0 0 12px" }}>Proposal Signed!</h2>
          <p style={{ fontSize: 15, color: "#5f6a7d", lineHeight: 1.6, margin: "0 0 24px" }}>
            Thanks, {first}! You'll receive your deposit invoice shortly via text and email. Your project moves to production as soon as the deposit clears.
          </p>
          <div style={{ background: "white", borderRadius: 12, padding: "16px 20px", border: "1px solid #e5e9ef", marginBottom: 24 }}>
            {([
              ["Proposal", proposalId],
              ["Total Investment", cur(totals.grandTotal)],
              ["Deposit Due", cur(totals.deposit)],
              ["Balance on Finish", cur(totals.balance)],
            ] as [string, string][]).map(([label, val]) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 13, color: "#5f6a7d" }}>{label}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: "#0a1f3d", fontVariantNumeric: "tabular-nums" }}>{val}</span>
              </div>
            ))}
          </div>
          <button
            onClick={onBack}
            style={{ background: "#0a1f3d", color: "white", border: "none", borderRadius: 12, padding: "14px 32px", fontSize: 14, fontWeight: 700, cursor: "pointer", width: "100%" }}
          >
            Back to Proposal
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: "#f4f6f9" }}>
      <div style={{ background: "#0a1f3d", padding: "16px 20px" }} className="flex items-center gap-3">
        <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.6)", padding: 0 }}>
          <ArrowLeft size={18} />
        </button>
        <div>
          <p style={{ color: "white", fontWeight: 700, fontSize: 15, margin: 0 }}>Sign Proposal</p>
          <p style={{ color: "rgba(255,255,255,0.5)", fontSize: 11, margin: 0 }}>{proposalId}</p>
        </div>
      </div>

      <div className="flex-1 px-5 py-6" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ textAlign: "center", paddingBottom: 8 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: "#0a1f3d", margin: "0 0 8px" }}>
            Finalize your project
          </h1>
          <p style={{ fontSize: 14, color: "#5f6a7d", margin: 0 }}>
            Review your investment, then sign to lock it in. Your deposit invoice will follow.
          </p>
        </div>

        {/* Investment recap */}
        <div style={{ background: "white", borderRadius: 14, border: "1px solid #e5e9ef", overflow: "hidden" }}>
          <div style={{ background: "#0a1f3d", padding: "14px 20px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: "rgba(255,255,255,0.7)", fontSize: 13, fontWeight: 600 }}>Total Investment</span>
            <span style={{ color: "white", fontSize: 22, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{cur(totals.grandTotal)}</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr" }}>
            <div style={{ padding: "16px 20px", borderRight: "1px solid #e5e9ef" }}>
              <p style={{ fontSize: 10, color: "#5f6a7d", margin: "0 0 4px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>Deposit Due</p>
              <p style={{ fontSize: 20, fontWeight: 800, margin: 0, color: "#1d9e75", fontVariantNumeric: "tabular-nums" }}>{cur(totals.deposit)}</p>
            </div>
            <div style={{ padding: "16px 20px" }}>
              <p style={{ fontSize: 10, color: "#5f6a7d", margin: "0 0 4px", fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase" }}>Balance on Finish</p>
              <p style={{ fontSize: 20, fontWeight: 800, margin: 0, color: "#0a1f3d", fontVariantNumeric: "tabular-nums" }}>{cur(totals.balance)}</p>
            </div>
          </div>
        </div>

        {/* Signature */}
        <div style={{ background: "white", borderRadius: 14, border: "1px solid #e5e9ef", padding: "20px" }}>
          <div className="flex justify-between items-center mb-3">
            <p style={{ fontSize: 12, fontWeight: 700, color: "#5f6a7d", margin: 0, letterSpacing: "0.08em", textTransform: "uppercase" }}>Customer Signature</p>
            <button
              onClick={() => sigPad.current?.clear()}
              style={{ fontSize: 12, color: "#1d9e75", background: "none", border: "none", cursor: "pointer", fontWeight: 600, padding: 0 }}
            >
              Clear
            </button>
          </div>
          <div style={{ borderRadius: 10, background: "#f8faff", border: "1px solid #e5e9ef", overflow: "hidden" }}>
            <SignatureCanvas
              ref={sigPad}
              penColor="#0a1f3d"
              canvasProps={{ className: "w-full h-32 cursor-crosshair" }}
            />
          </div>
        </div>

        {error && (
          <div style={{ background: "#fef2f2", color: "#ef4444", padding: "12px", borderRadius: 8, fontSize: 13, fontWeight: 500, textAlign: "center" }}>
            {error}
          </div>
        )}

        <button
          onClick={handleSign}
          disabled={processing}
          style={{
            width: "100%", background: "#1d9e75", color: "white", border: "none", borderRadius: 14,
            padding: "20px 16px", fontSize: 15, fontWeight: 800, cursor: processing ? "default" : "pointer",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 4, opacity: processing ? 0.7 : 1,
            marginTop: 8
          }}
        >
          {processing
            ? <Loader2 size={20} className="animate-spin" />
            : <>
                <span>Sign Proposal</span>
                <span style={{ fontSize: 12, fontWeight: 500, opacity: 0.85 }}>Your deposit invoice will follow</span>
              </>
          }
        </button>
      </div>
    </div>
  );
};
```

- [ ] **Step 4: Update the caller**

Find the parent component that renders `SignPayView`. Run:

```bash
grep -rn "SignPayView" src/ --include="*.tsx" --include="*.ts"
```

In each caller, pass `proposalId` as a prop. If the caller previously used `form.proposalId`, replace with whatever local state holds the proposal display id. Typical pattern: the parent already computes/stores it for the proposal step, so wire that value through.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun run test -- SignPayView`

Expected: all 4 tests pass.

- [ ] **Step 6: Run typecheck and build**

Run: `bun run build`

Expected: clean build, no TS errors.

If TS complains that `@stripe/*` is unused, that's fine — leave the dep in `package.json` for now (no security implication, removal is YAGNI follow-up).

- [ ] **Step 7: Commit**

```bash
git add src/components/consult/SignPayView.tsx src/components/consult/SignPayView.test.tsx
# Also stage whichever caller files were touched in Step 4.
git commit -m "feat(SignPayView): strip Stripe, signature-only flow"
```

---

## Task 4: Build the GHL invoice-paid webhook

**Files:**
- Create: `api/webhooks/ghl-invoice-paid.ts`
- Create: `api/webhooks/ghl-invoice-paid.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `api/webhooks/ghl-invoice-paid.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import handler from './ghl-invoice-paid';

const SUPABASE_URL = 'https://test.supabase.co';
const GHL_BASE = 'https://services.leadconnectorhq.com';

beforeEach(() => {
  process.env.SUPABASE_URL = SUPABASE_URL;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  process.env.GHL_API_KEY = 'test-ghl-key';
  process.env.GHL_LOCATION_ID = 'test-loc';
  process.env.GHL_STAGE_JOB_CREATED = 'stage-jc';
  process.env.GHL_WEBHOOK_SECRET = 'top-secret-32-char-string-AAAAAAA';
  process.env.GHL_TODD_CONTACT_ID = 'TestContactId12345678';
  vi.restoreAllMocks();
});

function makeReq(opts: {
  body: unknown;
  secret?: string;
  ip?: string;
}): Request {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.secret !== undefined) headers['X-Abrams-Webhook-Secret'] = opts.secret;
  if (opts.ip !== undefined) headers['X-Forwarded-For'] = opts.ip;
  return new Request('http://test/api/webhooks/ghl-invoice-paid', {
    method: 'POST',
    headers,
    body: JSON.stringify(opts.body),
  });
}

interface FetchCall { url: string; init: RequestInit }

function mockSupabaseAndGhl(jobLookupRows: unknown[]): {
  fetchMock: ReturnType<typeof vi.fn>;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    calls.push({ url, init: init || {} });
    if (url.includes('/rest/v1/jobs?proposal_id=eq.')) {
      return new Response(JSON.stringify(jobLookupRows), { status: 200 });
    }
    if (url.includes('/rest/v1/jobs?')) {
      // UPDATE returns the updated row
      return new Response(JSON.stringify([{ job_id: 'job-1', job_number: 'AF-2026-0010', deposit_status: 'paid' }]), { status: 200 });
    }
    if (url.includes('/rest/v1/job_activity_log')) return new Response('[]', { status: 201 });
    return new Response('{}', { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, calls };
}

describe('ghl-invoice-paid webhook', () => {
  it('flips a pending_invoice job to paid, logs activity, moves GHL stage, posts note', async () => {
    const { calls } = mockSupabaseAndGhl([{
      job_id: 'job-1', job_number: 'AF-2026-0010', proposal_id: 'opp-1', deposit_status: 'pending_invoice',
    }]);

    const res = await handler(makeReq({
      secret: 'top-secret-32-char-string-AAAAAAA',
      body: { contactId: 'c1', opportunityId: 'opp-1', invoiceId: 'inv-1', amountPaid: 5000, paidAt: '2026-05-22T00:00:00Z' },
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.status).toBe('paid');
    expect(body.job_number).toBe('AF-2026-0010');

    // The UPDATE call must include the pending_invoice guard in the WHERE.
    const update = calls.find(c => c.url.includes('/rest/v1/jobs?') && c.init.method === 'PATCH');
    expect(update).toBeDefined();
    expect(update!.url).toContain('proposal_id=eq.opp-1');
    expect(update!.url).toContain('deposit_status=eq.pending_invoice');
    const updateBody = JSON.parse(update!.init.body as string);
    expect(updateBody.deposit_status).toBe('paid');
    expect(updateBody.deposit_paid_at).toBeTruthy();

    // Activity log
    const activity = calls.find(c => c.url.includes('/rest/v1/job_activity_log'));
    expect(activity).toBeDefined();
    const activityBody = JSON.parse(activity!.init.body as string);
    expect(activityBody.type).toBe('deposit_paid_via_invoice');
    expect(activityBody.payload).toMatchObject({ invoice_id: 'inv-1', amount_paid: 5000 });

    // GHL stage move
    const stageMove = calls.find(c =>
      c.url.includes('/opportunities/opp-1') && c.init.method === 'PUT'
    );
    expect(stageMove).toBeDefined();
    const stageBody = JSON.parse(stageMove!.init.body as string);
    expect(stageBody.pipelineStageId).toBe('stage-jc');

    // Paid note
    const note = calls.find(c => c.url.includes('/contacts/c1/notes'));
    expect(note).toBeDefined();
    const noteBody = JSON.parse(note!.init.body as string);
    expect(noteBody.body).toContain('Deposit received');
    expect(noteBody.body).toContain('AF-2026-0010');
  });

  it('returns 401 + sends SMS on bad secret', async () => {
    const { calls } = mockSupabaseAndGhl([]);

    const res = await handler(makeReq({
      secret: 'wrong-secret',
      ip: '1.2.3.4',
      body: { contactId: 'c1', opportunityId: 'opp-1', invoiceId: 'inv-1', amountPaid: 5000 },
    }));
    expect(res.status).toBe(401);

    // SMS fires to Todd's contact via GHL conversations/messages
    const sms = calls.find(c =>
      c.url.endsWith('/conversations/messages') && c.init.method === 'POST'
    );
    expect(sms).toBeDefined();
    const smsBody = JSON.parse(sms!.init.body as string);
    expect(smsBody.contactId).toBe('TestContactId12345678');
    expect(smsBody.message).toContain('Unauthorized');
    expect(smsBody.message).toContain('1.2.3.4');

    // No DB writes occurred
    expect(calls.some(c => c.url.includes('/rest/v1/jobs'))).toBe(false);
    expect(calls.some(c => c.url.includes('/rest/v1/job_activity_log'))).toBe(false);
  });

  it('returns 401 + SMS when secret header is missing entirely', async () => {
    const { calls } = mockSupabaseAndGhl([]);

    const res = await handler(makeReq({
      body: { contactId: 'c1', opportunityId: 'opp-1', invoiceId: 'inv-1', amountPaid: 5000 },
    }));
    expect(res.status).toBe(401);
    const sms = calls.find(c => c.url.endsWith('/conversations/messages'));
    expect(sms).toBeDefined();
  });

  it('returns 422 + SMS when no matching job exists', async () => {
    const { calls } = mockSupabaseAndGhl([]); // empty lookup

    const res = await handler(makeReq({
      secret: 'top-secret-32-char-string-AAAAAAA',
      body: { contactId: 'c1', opportunityId: 'opp-nonexistent', invoiceId: 'inv-xyz', amountPaid: 5000 },
    }));
    expect(res.status).toBe(422);

    const sms = calls.find(c => c.url.endsWith('/conversations/messages'));
    expect(sms).toBeDefined();
    const smsBody = JSON.parse(sms!.init.body as string);
    expect(smsBody.message).toContain('no matching job');
    expect(smsBody.message).toContain('c1');
    expect(smsBody.message).toContain('inv-xyz');

    // No UPDATE attempted
    const update = calls.find(c => c.url.includes('/rest/v1/jobs?') && c.init.method === 'PATCH');
    expect(update).toBeUndefined();
  });

  it('returns 200 with already_processed=true when job is already paid (idempotent)', async () => {
    const { calls } = mockSupabaseAndGhl([{
      job_id: 'job-1', job_number: 'AF-2026-0010', proposal_id: 'opp-1', deposit_status: 'paid',
    }]);

    const res = await handler(makeReq({
      secret: 'top-secret-32-char-string-AAAAAAA',
      body: { contactId: 'c1', opportunityId: 'opp-1', invoiceId: 'inv-1', amountPaid: 5000 },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.already_processed).toBe(true);
    expect(body.job_id).toBe('job-1');

    // No UPDATE, no activity log, no GHL stage move, no note, no SMS.
    expect(calls.some(c => c.url.includes('/rest/v1/jobs?') && c.init.method === 'PATCH')).toBe(false);
    expect(calls.some(c => c.url.includes('/rest/v1/job_activity_log'))).toBe(false);
    expect(calls.some(c => c.url.includes('/opportunities/opp-1') && c.init.method === 'PUT')).toBe(false);
    expect(calls.some(c => c.url.includes('/contacts/c1/notes'))).toBe(false);
    expect(calls.some(c => c.url.endsWith('/conversations/messages'))).toBe(false);
  });

  it('returns 400 when opportunityId is missing from payload', async () => {
    mockSupabaseAndGhl([]);
    const res = await handler(makeReq({
      secret: 'top-secret-32-char-string-AAAAAAA',
      body: { contactId: 'c1', invoiceId: 'inv-1', amountPaid: 5000 },
    }));
    expect(res.status).toBe(400);
  });

  it('processes successfully even with IP outside GHL range (soft check)', async () => {
    const { calls } = mockSupabaseAndGhl([{
      job_id: 'job-1', job_number: 'AF-2026-0010', proposal_id: 'opp-1', deposit_status: 'pending_invoice',
    }]);

    const res = await handler(makeReq({
      secret: 'top-secret-32-char-string-AAAAAAA',
      ip: '203.0.113.99', // RFC5737 documentation IP, not in any GHL range
      body: { contactId: 'c1', opportunityId: 'opp-1', invoiceId: 'inv-1', amountPaid: 5000 },
    }));
    expect(res.status).toBe(201); // still processes
  });

  it('rejects non-POST', async () => {
    const res = await handler(new Request('http://test/api/webhooks/ghl-invoice-paid', { method: 'GET' }));
    expect(res.status).toBe(405);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `bun run test -- ghl-invoice-paid`

Expected: all tests fail — the file doesn't exist yet.

- [ ] **Step 3: Implement the webhook handler**

Create `api/webhooks/ghl-invoice-paid.ts`:

```typescript
// api/webhooks/ghl-invoice-paid.ts
// Vercel edge function — receives GHL invoice.paid events and flips the
// matching job from deposit_status='pending_invoice' to 'paid'. Job lookup
// keys off the GHL opportunityId in the payload, matched against jobs.proposal_id.
//
// Auth model:
//   - Required header X-Abrams-Webhook-Secret, constant-time compared against
//     GHL_WEBHOOK_SECRET. Mismatch -> 401 + SMS to Todd. No DB side effects.
//   - Soft IP check: if X-Forwarded-For is outside GHL's published outbound
//     range, log a warning but still process. Do not hardcode IPs in source;
//     read GHL_OUTBOUND_IP_PREFIXES env var (comma-separated CIDRs) and treat
//     unset/empty as "skip check".
//
// Idempotency: before any side effect, the handler reads the job. If
// deposit_status is already 'paid', it returns 200 { already_processed: true }
// and exits without writing anything, moving any GHL state, or sending any SMS.
//
// Required env (server-only):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   GHL_API_KEY, GHL_LOCATION_ID, GHL_STAGE_JOB_CREATED
//   GHL_WEBHOOK_SECRET
//   GHL_TODD_CONTACT_ID
//   GHL_OUTBOUND_IP_PREFIXES (optional, comma-separated CIDR or prefix strings)

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const GHL_API_KEY = process.env.GHL_API_KEY ?? '';
const GHL_STAGE_JOB_CREATED = process.env.GHL_STAGE_JOB_CREATED ?? '';
const GHL_WEBHOOK_SECRET = process.env.GHL_WEBHOOK_SECRET ?? '';
const GHL_TODD_CONTACT_ID = process.env.GHL_TODD_CONTACT_ID ?? '';
const GHL_OUTBOUND_IP_PREFIXES = (process.env.GHL_OUTBOUND_IP_PREFIXES ?? '').split(',').map(s => s.trim()).filter(Boolean);

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(init.headers || {}) },
  });
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function ipMatchesAnyPrefix(ip: string, prefixes: string[]): boolean {
  if (!prefixes.length) return true; // unset = skip check
  // Simple prefix match (e.g. "44.234." matches "44.234.5.6"). Real CIDR
  // matching is overkill for the soft-log threat model.
  return prefixes.some(p => ip.startsWith(p));
}

async function sb(path: string, init: RequestInit = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(init.headers || {}),
    },
  });
}

function ghlHeaders() {
  return {
    Authorization: `Bearer ${GHL_API_KEY}`,
    'Content-Type': 'application/json',
    Version: GHL_VERSION,
  };
}

async function sendToddSms(message: string): Promise<void> {
  if (!GHL_API_KEY || !GHL_TODD_CONTACT_ID) {
    console.error('[ghl-invoice-paid] SMS env not configured; would have sent:', message);
    return;
  }
  try {
    await fetch(`${GHL_BASE}/conversations/messages`, {
      method: 'POST',
      headers: ghlHeaders(),
      body: JSON.stringify({ type: 'SMS', contactId: GHL_TODD_CONTACT_ID, message }),
    });
  } catch (err) {
    console.error('[ghl-invoice-paid] Todd SMS send failed:', err);
  }
}

interface InvoicePaidPayload {
  contactId?: string;
  opportunityId?: string;
  invoiceId?: string;
  amountPaid?: number;
  paidAt?: string;
}

export default async function handler(req: Request) {
  if (req.method !== 'POST') return json({ error: 'POST only' }, { status: 405 });

  // --- Auth ---
  const providedSecret = req.headers.get('X-Abrams-Webhook-Secret') || '';
  if (!GHL_WEBHOOK_SECRET || !constantTimeEqual(providedSecret, GHL_WEBHOOK_SECRET)) {
    const ip = req.headers.get('X-Forwarded-For') || req.headers.get('CF-Connecting-IP') || 'unknown';
    const masked = providedSecret ? `${providedSecret.slice(0, 3)}…(${providedSecret.length} chars)` : 'missing';
    console.warn('[ghl-invoice-paid] AUTH FAIL', { ip, masked });
    await sendToddSms(
      '🚨 ABRAMS ALERT\nUnauthorized invoice webhook attempt.\n' +
      `Source IP: ${ip}\n` +
      `Header value: ${masked}`
    );
    return json({ error: 'unauthorized' }, { status: 401 });
  }

  // --- Soft IP check ---
  const ip = req.headers.get('X-Forwarded-For') || req.headers.get('CF-Connecting-IP') || 'unknown';
  if (ip !== 'unknown' && !ipMatchesAnyPrefix(ip, GHL_OUTBOUND_IP_PREFIXES)) {
    console.warn('[ghl-invoice-paid] source IP outside GHL range', { ip });
  }

  // --- Parse ---
  let body: InvoicePaidPayload;
  try { body = await req.json(); }
  catch { return json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { contactId, opportunityId, invoiceId, amountPaid, paidAt } = body;
  if (!opportunityId) return json({ error: 'opportunityId required' }, { status: 400 });

  // --- Lookup job by proposal_id ---
  const lookupRes = await sb(`jobs?proposal_id=eq.${encodeURIComponent(opportunityId)}&select=job_id,job_number,deposit_status`, {
    method: 'GET',
  });
  if (!lookupRes.ok) {
    const t = await lookupRes.text().catch(() => '');
    console.error('[ghl-invoice-paid] job lookup failed', t);
    return json({ error: 'job lookup failed' }, { status: 502 });
  }
  const rows = (await lookupRes.json()) as { job_id: string; job_number: string; deposit_status: string }[];

  if (rows.length === 0) {
    console.warn('[ghl-invoice-paid] no matching job', { opportunityId, contactId, invoiceId });
    await sendToddSms(
      '🚨 ABRAMS ALERT\nInvoice paid but no matching job found.\n' +
      `Contact ID: ${contactId ?? '(missing)'}\n` +
      `Invoice ID: ${invoiceId ?? '(missing)'}\n` +
      `Opportunity ID: ${opportunityId}\n` +
      'Check Supabase — manual intervention required.'
    );
    return json({ error: 'no matching job', opportunityId }, { status: 422 });
  }

  const job = rows[0];

  // --- Idempotency guard (before any side effect) ---
  if (job.deposit_status === 'paid') {
    return json({ already_processed: true, job_id: job.job_id, job_number: job.job_number }, { status: 200 });
  }

  // --- 1) UPDATE: flip state. Status guard in WHERE protects against races. ---
  const nowIso = new Date().toISOString();
  const updateRes = await sb(
    `jobs?proposal_id=eq.${encodeURIComponent(opportunityId)}&deposit_status=eq.pending_invoice`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        deposit_status: 'paid',
        deposit_paid_at: paidAt || nowIso,
      }),
    }
  );
  if (!updateRes.ok) {
    const t = await updateRes.text().catch(() => '');
    console.error('[ghl-invoice-paid] UPDATE failed', t);
    return json({ error: 'update failed', detail: t }, { status: 502 });
  }
  const updated = (await updateRes.json()) as { job_id: string; job_number: string; deposit_status: string }[];
  if (updated.length === 0) {
    // Race: another concurrent webhook fired and won. Treat as already-processed.
    return json({ already_processed: true, job_id: job.job_id, job_number: job.job_number }, { status: 200 });
  }

  // --- 2) Activity log ---
  await sb('job_activity_log', {
    method: 'POST',
    body: JSON.stringify({
      job_id: job.job_id,
      contact_id: contactId ?? null,
      type: 'deposit_paid_via_invoice',
      actor: 'system',
      source: 'ghl_webhook',
      payload: { invoice_id: invoiceId ?? null, amount_paid: amountPaid ?? null, opportunity_id: opportunityId },
    }),
  });

  // --- 3) GHL stage move (fail-soft) ---
  if (GHL_API_KEY && GHL_STAGE_JOB_CREATED) {
    try {
      await fetch(`${GHL_BASE}/opportunities/${opportunityId}`, {
        method: 'PUT',
        headers: ghlHeaders(),
        body: JSON.stringify({ pipelineStageId: GHL_STAGE_JOB_CREATED }),
      });
    } catch (err) {
      console.error('[ghl-invoice-paid] GHL stage move failed:', err);
    }
  }

  // --- 4) Paid note (fail-soft) ---
  if (GHL_API_KEY && contactId) {
    try {
      const note = `[AUTO] Deposit received — job ${job.job_number} moving to production`;
      await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, {
        method: 'POST',
        headers: ghlHeaders(),
        body: JSON.stringify({ body: note }),
      });
    } catch (err) {
      console.error('[ghl-invoice-paid] paid note failed:', err);
    }
  }

  return json({ job_id: job.job_id, job_number: job.job_number, status: 'paid' }, { status: 201 });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test -- ghl-invoice-paid`

Expected: all 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add api/webhooks/ghl-invoice-paid.ts api/webhooks/ghl-invoice-paid.test.ts
git commit -m "feat(webhook): ghl-invoice-paid endpoint with idempotency + auth"
```

---

## Task 5: Dashboard filter — only show paid jobs on `/production`

**Files:**
- Modify: `src/hooks/useJobs.ts`

- [ ] **Step 1: Update the query**

Open `src/hooks/useJobs.ts`. Find lines 13-17:

```typescript
    const { data, error } = await supabase
      .from('jobs')
      .select('*')
      .is('archived_at', null)
      .order('install_date', { ascending: true, nullsFirst: false });
```

Add `.eq('deposit_status', 'paid')` between the archived filter and the order:

```typescript
    const { data, error } = await supabase
      .from('jobs')
      .select('*')
      .is('archived_at', null)
      .eq('deposit_status', 'paid')
      .order('install_date', { ascending: true, nullsFirst: false });
```

- [ ] **Step 2: Verify the build is clean**

Run: `bun run build`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useJobs.ts
git commit -m "feat(dashboard): /production only shows jobs with deposit_status=paid"
```

---

## Task 6: Env wiring

**Files:**
- Modify: `.env.example`
- Modify (operator step): `.env.local`, Vercel project env, Supabase secrets (if needed)

- [ ] **Step 1: Update `.env.example`**

Open `.env.example`. In the server-only section (below the `GHL_LOCATION_ID` line), add:

```
# Used by /api/webhooks/ghl-invoice-paid. Required.
# GHL workflow sends this in the X-Abrams-Webhook-Secret header. Constant-time
# compared on receipt. Generate with: openssl rand -hex 16
GHL_WEBHOOK_SECRET=

# Server-side copy of VITE_GHL_TODD_CONTACT_ID. Required because edge
# functions cannot read VITE_* env vars. Value is the same contact id
# (currently Z3OW0NMGj3sk93ofJuVq).
GHL_TODD_CONTACT_ID=

# Pipeline + stage IDs the invoice-paid webhook moves the GHL opportunity to.
# Reuses the Fence Production / Job Created stage.
GHL_STAGE_JOB_CREATED=

# Optional. Comma-separated IP prefixes that GHL outbound webhooks should
# arrive from. Used for soft logging only — non-matching IPs are warned about
# but still processed. Leave empty to skip the check.
GHL_OUTBOUND_IP_PREFIXES=
```

- [ ] **Step 2: Operator step — generate the secret**

Run on the operator's machine:

```bash
openssl rand -hex 16
```

Copy the output. This is the value for `GHL_WEBHOOK_SECRET`.

- [ ] **Step 3: Operator step — write `.env.local`**

Add the four new vars to `~/abrams-ops/.env.local`. The file already has `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GHL_API_KEY`, `GHL_LOCATION_ID`. Append:

```
GHL_WEBHOOK_SECRET=<output of openssl rand -hex 16>
GHL_TODD_CONTACT_ID=Z3OW0NMGj3sk93ofJuVq
GHL_STAGE_JOB_CREATED=ecf63d46-164d-4db0-b6ca-4eb870070b2d
GHL_OUTBOUND_IP_PREFIXES=
```

(`GHL_STAGE_JOB_CREATED` value is from the spec's settled decisions / `project_abrams_ops` memory.)

- [ ] **Step 4: Operator step — write Vercel env**

For the `abrams-ops-app` Vercel project, add the same four vars to **Production** and **Preview** environments. The secret value MUST match what the GHL workflow will send.

```bash
vercel env add GHL_WEBHOOK_SECRET production
vercel env add GHL_WEBHOOK_SECRET preview
vercel env add GHL_TODD_CONTACT_ID production
vercel env add GHL_TODD_CONTACT_ID preview
vercel env add GHL_STAGE_JOB_CREATED production
vercel env add GHL_STAGE_JOB_CREATED preview
```

Skip `GHL_OUTBOUND_IP_PREFIXES` unless/until you want soft IP logging.

- [ ] **Step 5: Operator step — configure the GHL workflow**

In GHL → Automations → Workflows, create or update a workflow that fires on **Invoice → Paid**. Add a **Webhook** action:

- URL: `https://<your-vercel-prod-domain>/api/webhooks/ghl-invoice-paid`
- Method: POST
- Headers:
  - `Content-Type: application/json`
  - `X-Abrams-Webhook-Secret: <the secret from openssl rand -hex 16>`
- Body (JSON):
  ```json
  {
    "contactId": "{{contact.id}}",
    "opportunityId": "{{opportunity.id}}",
    "invoiceId": "{{invoice.id}}",
    "amountPaid": "{{invoice.amount_paid}}",
    "paidAt": "{{invoice.paid_at}}"
  }
  ```

The exact merge-field names depend on GHL's workflow trigger payload; the implementer should verify against GHL's "Test" feature in the workflow builder before going live. If `opportunity.id` is not available from the invoice context, the workflow must look it up via a preceding "Find Opportunity by Contact" step.

- [ ] **Step 6: Commit the `.env.example` change**

```bash
git add .env.example
git commit -m "feat(env): document GHL_WEBHOOK_SECRET, GHL_TODD_CONTACT_ID, GHL_STAGE_JOB_CREATED, GHL_OUTBOUND_IP_PREFIXES"
```

---

## Task 7: End-to-end smoke test

**Files:** none (operator/manual verification)

- [ ] **Step 1: Deploy preview**

```bash
cd ~/abrams-ops && vercel deploy --yes
```

Capture the preview URL.

- [ ] **Step 2: Sign a real proposal end-to-end**

On the preview URL, walk through `/consult` (PIN `8633`) against a real GHL contact (use a personal test contact, NOT a real customer). Reach the Sign step. Confirm:

- No Stripe `CardElement` appears anywhere.
- The CTA says "Sign Proposal," not "Sign & Pay Deposit."
- Signing creates a job in Supabase with `deposit_status='pending_invoice'` and `signed_at` populated.
- The GHL opportunity moves to `status='won'`.
- A note is posted on the GHL contact: `[AUTO] Proposal signed — invoice pending`.
- The new job does NOT appear on the `/production` dashboard yet.

Verify via the Supabase dashboard SQL editor:

```sql
SELECT job_id, job_number, deposit_status, signed_at, deposit_paid_at
FROM jobs
WHERE contact_id = '<test contact id>'
ORDER BY signed_at DESC NULLS LAST
LIMIT 1;
```

- [ ] **Step 3: Fire the webhook by hand**

Without going through GHL, simulate the invoice-paid payload to confirm the webhook works end-to-end:

```bash
curl -i -X POST https://<preview-url>/api/webhooks/ghl-invoice-paid \
  -H 'Content-Type: application/json' \
  -H "X-Abrams-Webhook-Secret: $(grep ^GHL_WEBHOOK_SECRET ~/abrams-ops/.env.local | cut -d= -f2)" \
  -d '{
    "contactId": "<test contact id>",
    "opportunityId": "<test opportunity id>",
    "invoiceId": "test-invoice-1",
    "amountPaid": 5000,
    "paidAt": "2026-05-22T00:00:00Z"
  }'
```

Expected: HTTP 201, body `{ "job_id": "...", "job_number": "AF-2026-XXXX", "status": "paid" }`.

Verify in Supabase:
```sql
SELECT job_number, deposit_status, deposit_paid_at FROM jobs WHERE job_id = '<from response>';
```
Expected: `deposit_status='paid'`, `deposit_paid_at` set.

Verify in GHL: opportunity should now show stage `Job Created` in the Fence Production pipeline, and the contact should have a new note `[AUTO] Deposit received — job AF-2026-XXXX moving to production`.

Reload `/production` on the preview. The new job appears.

- [ ] **Step 4: Re-fire the webhook to confirm idempotency**

Run the same `curl` command from Step 3 a second time.

Expected: HTTP 200, body `{ "already_processed": true, "job_id": "...", "job_number": "..." }`.

Verify in Supabase: no new `job_activity_log` row for `deposit_paid_via_invoice` (still exactly one). Verify in GHL: no duplicate note.

- [ ] **Step 5: Fire with a bad secret to confirm 401 + SMS**

```bash
curl -i -X POST https://<preview-url>/api/webhooks/ghl-invoice-paid \
  -H 'Content-Type: application/json' \
  -H 'X-Abrams-Webhook-Secret: WRONG-SECRET' \
  -d '{"contactId":"x","opportunityId":"y","invoiceId":"z","amountPaid":1}'
```

Expected: HTTP 401. Confirm Todd's phone receives the unauthorized SMS within a minute.

- [ ] **Step 6: Fire with a valid secret but a bogus opportunityId to confirm 422 + SMS**

```bash
curl -i -X POST https://<preview-url>/api/webhooks/ghl-invoice-paid \
  -H 'Content-Type: application/json' \
  -H "X-Abrams-Webhook-Secret: $(grep ^GHL_WEBHOOK_SECRET ~/abrams-ops/.env.local | cut -d= -f2)" \
  -d '{"contactId":"x","opportunityId":"opp-nonexistent-12345","invoiceId":"inv-z","amountPaid":1}'
```

Expected: HTTP 422. Confirm Todd's phone receives the no-matching-job SMS.

- [ ] **Step 7: Configure and test the GHL workflow**

Trigger the real GHL workflow by sending a small real invoice (or use GHL's workflow "Test Run" feature with a synthetic payload) to a test contact. Confirm the webhook fires from GHL and the job flips through the same path as the manual curl.

- [ ] **Step 8: Final clean-up commit (if anything drifted)**

If env vars or workflow URLs needed any tweaks discovered during smoke testing, commit them now.

```bash
git status
# stage and commit any final adjustments
```

---

## Out of scope (V2 — do NOT implement)

- Signature image persistence (still captured visually, still not uploaded anywhere).
- "Signed, awaiting deposit" dashboard panel.
- Ad-hoc invoice support (invoice not tied to an opportunity).
- GHL invoice creation via API from the signature handler.
- HMAC payload-signature verification.
- Removing `@stripe/*` packages from `package.json` (no harm in leaving for now).

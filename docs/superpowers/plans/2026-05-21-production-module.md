# `/production` Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the internal `/production` module that tracks fence jobs from deposit confirmation through final payment, with an office dashboard for Todd and a field checklist for Ty.

**Architecture:** React + Vite + TypeScript SPA. Supabase is the operational source of truth. Every mutation follows the rule: Supabase write → `job_activity_log` append → optional GHL mirror. GHL sync failures never roll back Supabase. View toggle (office/field) is independent of PIN-derived actor.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind, react-router-dom v7, `@supabase/supabase-js`, Vercel edge functions, Vitest (added in Task 1 for pure-logic tests only — UI tests skipped to match existing repo conventions).

**Source spec:** `docs/superpowers/specs/2026-05-21-production-module-design.md`

---

## File Structure

### New files

```
api/proposal/create-job.ts           Edge function: deposit-confirmed → insert job, log, GHL move
src/lib/env.ts                       Boot-time env-var validation; throws on missing keys
src/types/production.ts              All types: Job, JobFenceSpec, ChecklistItem, JobPhoto, JobIssue, ActivityLogEntry, enums
src/utils/actor.ts                   Resolves actor from PIN, persists to sessionStorage
src/utils/actor.test.ts              Vitest unit tests
src/utils/jobNumber.ts               Display formatting only (generation is DB trigger)
src/utils/ghlSync.ts                 Stage-move + SMS helpers used by hooks
src/utils/checklistTemplate.ts       Static list of all 30 checklist items per section
src/utils/checklistTemplate.test.ts  Vitest unit tests
src/utils/notificationThrottle.ts    Rate-limit math for block SMSs
src/utils/notificationThrottle.test.ts Vitest unit tests
src/hooks/useActivityLog.ts          Append-only activity log writes
src/hooks/useJobs.ts                 List query for dashboard
src/hooks/useJob.ts                  Single-job query with realtime channel
src/hooks/useChecklist.ts            Checklist state + localStorage autosave + Supabase sync
src/hooks/usePhotoQueue.ts           Supabase Storage upload + GHL mirror + retry
src/hooks/useIssue.ts                Issue create/resolve with auto-rules
src/hooks/useNotifications.ts        Throttled SMS dispatcher
src/components/production/PinGate.tsx           Multi-PIN gate (Todd 1122, Ty 8633), returns actor
src/components/production/ViewToggle.tsx        Office/Field switcher, persists choice
src/components/production/StatusBadge.tsx       Active/blocked/needs_review/complete pill
src/components/production/StagePill.tsx         Stage label pill
src/components/production/JobCard.tsx           Dashboard row card
src/components/production/JobHeader.tsx         Sticky header for field view
src/components/production/ChecklistSection.tsx  Expandable section card
src/components/production/ChecklistItem.tsx     Single checkable row
src/components/production/PhotoUpload.tsx       Upload + queue UI
src/components/production/FlagIssueModal.tsx    Issue-creation modal, auto-captures section
src/components/production/BlockedModal.tsx      Block-job modal
src/components/production/CompleteConfirmModal.tsx  Final completion confirmation
supabase/migrations/20260521000000_production_module_additions.sql
```

### Modified files

```
package.json                          Add vitest + @testing-library/jest-dom (devDeps)
vite.config.ts                        Vitest config block
src/lib/crm-api.ts                    Add moveOpportunityToStage(), sendSms()
src/pages/production/ProductionDashboard.tsx  Replace stub with real dashboard
src/pages/production/ProductionJob.tsx        Replace stub with real field view
src/components/consult/SignPayView.tsx        After deposit clears, POST to /api/proposal/create-job
src/App.tsx                           Wrap /production routes in PinGate
```

### Manual pre-deploy steps (documented in Task 28)

```
1. Create Supabase Storage bucket `job-photos` (public read off, authenticated write on)
2. Pull GHL pipeline + 4 stage IDs and set 5 GHL env vars in Vercel
3. Set VITE_GHL_TODD_PHONE in Vercel
4. Run new migration on Supabase via dashboard SQL editor
```

---

## Task 1: Add Vitest for unit testing

**Files:**
- Modify: `package.json`
- Modify: `vite.config.ts`
- Create: `vitest.setup.ts`

- [ ] **Step 1: Install vitest and testing utilities**

```bash
cd /Users/toddabrams/abrams-ops
bun add -d vitest @vitest/ui happy-dom
```

- [ ] **Step 2: Add test script to package.json**

In `package.json`, add to `scripts`:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Configure vitest in vite.config.ts**

Replace the existing `vite.config.ts` content. Read the current file first to preserve react-plugin config, then add:

```ts
/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
  },
});
```

- [ ] **Step 4: Create empty setup file**

```ts
// vitest.setup.ts
// Empty for now — kept as a hook for future global mocks.
```

- [ ] **Step 5: Verify install**

Run: `bun run test --reporter=verbose`
Expected: exits 0 with "No test files found, exiting with code 0" or similar.

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock vite.config.ts vitest.setup.ts
git commit -m "chore: add vitest for unit tests"
```

---

## Task 2: Apply Supabase schema additions

**Files:**
- Create: `supabase/migrations/20260521000000_production_module_additions.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- Production module additions on top of 20260520000000_initial_schema.sql

-- Issue context (from spec section 3.6): which phase the issue was flagged in.
-- Nullable: null when flagged via the persistent top-right button outside any section.
ALTER TABLE job_issues
  ADD COLUMN section TEXT
  CHECK (section IS NULL OR section IN ('loadout', 'onsite', 'install', 'clean', 'walkthrough'));

-- Block-notification rate-limit state (from spec section 3.5):
-- Stores the timestamp of the last "Job blocked" SMS so the next fire respects the 48h throttle.
ALTER TABLE jobs
  ADD COLUMN last_blocked_notification_at TIMESTAMPTZ;

CREATE INDEX idx_jobs_blocked_active
  ON jobs(blocked_at)
  WHERE status = 'blocked' AND archived_at IS NULL;
```

- [ ] **Step 2: Run the migration in Supabase**

Manual step: open Supabase dashboard → SQL Editor → paste the migration contents → run.

Verify by running this verification query in the SQL editor:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'job_issues' AND column_name = 'section';
SELECT column_name FROM information_schema.columns
WHERE table_name = 'jobs' AND column_name = 'last_blocked_notification_at';
```

Expected: both queries return one row.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260521000000_production_module_additions.sql
git commit -m "feat(db): add job_issues.section and jobs.last_blocked_notification_at"
```

---

## Task 3: Add env-var validation library

**Files:**
- Create: `src/lib/env.ts`
- Create: `src/lib/env.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/lib/env.test.ts
import { describe, it, expect } from 'vitest';
import { validateProductionEnv } from './env';

describe('validateProductionEnv', () => {
  it('throws when pipeline id is missing', () => {
    expect(() =>
      validateProductionEnv({
        VITE_GHL_FENCE_PRODUCTION_PIPELINE_ID: '',
        VITE_GHL_STAGE_JOB_CREATED: 's1',
        VITE_GHL_STAGE_SCHEDULED: 's2',
        VITE_GHL_STAGE_IN_INSTALL: 's3',
        VITE_GHL_STAGE_JOB_COMPLETE: 's4',
        VITE_GHL_TODD_PHONE: '+18168256198',
      })
    ).toThrow(/VITE_GHL_FENCE_PRODUCTION_PIPELINE_ID/);
  });

  it('throws when phone is not in E.164 format', () => {
    expect(() =>
      validateProductionEnv({
        VITE_GHL_FENCE_PRODUCTION_PIPELINE_ID: 'p1',
        VITE_GHL_STAGE_JOB_CREATED: 's1',
        VITE_GHL_STAGE_SCHEDULED: 's2',
        VITE_GHL_STAGE_IN_INSTALL: 's3',
        VITE_GHL_STAGE_JOB_COMPLETE: 's4',
        VITE_GHL_TODD_PHONE: '8168256198',
      })
    ).toThrow(/E\.164/);
  });

  it('returns config object when all vars present and valid', () => {
    const cfg = validateProductionEnv({
      VITE_GHL_FENCE_PRODUCTION_PIPELINE_ID: 'p1',
      VITE_GHL_STAGE_JOB_CREATED: 's1',
      VITE_GHL_STAGE_SCHEDULED: 's2',
      VITE_GHL_STAGE_IN_INSTALL: 's3',
      VITE_GHL_STAGE_JOB_COMPLETE: 's4',
      VITE_GHL_TODD_PHONE: '+18168256198',
    });
    expect(cfg.pipelineId).toBe('p1');
    expect(cfg.stages.job_created).toBe('s1');
    expect(cfg.toddPhone).toBe('+18168256198');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/lib/env.test.ts`
Expected: FAIL — "Cannot find module './env'"

- [ ] **Step 3: Implement env.ts**

```ts
// src/lib/env.ts
export interface ProductionEnvConfig {
  pipelineId: string;
  stages: {
    job_created: string;
    scheduled: string;
    in_install: string;
    job_complete: string;
  };
  toddPhone: string;
}

interface RawEnv {
  VITE_GHL_FENCE_PRODUCTION_PIPELINE_ID?: string;
  VITE_GHL_STAGE_JOB_CREATED?: string;
  VITE_GHL_STAGE_SCHEDULED?: string;
  VITE_GHL_STAGE_IN_INSTALL?: string;
  VITE_GHL_STAGE_JOB_COMPLETE?: string;
  VITE_GHL_TODD_PHONE?: string;
}

const REQUIRED_KEYS: Array<keyof RawEnv> = [
  'VITE_GHL_FENCE_PRODUCTION_PIPELINE_ID',
  'VITE_GHL_STAGE_JOB_CREATED',
  'VITE_GHL_STAGE_SCHEDULED',
  'VITE_GHL_STAGE_IN_INSTALL',
  'VITE_GHL_STAGE_JOB_COMPLETE',
  'VITE_GHL_TODD_PHONE',
];

export function validateProductionEnv(env: RawEnv): ProductionEnvConfig {
  const missing = REQUIRED_KEYS.filter((k) => !env[k] || !env[k]?.trim());
  if (missing.length > 0) {
    throw new Error(
      `Missing required production env vars: ${missing.join(', ')}. ` +
        `Run \`vercel env pull .env.local\` and restart the dev server.`
    );
  }
  if (!/^\+\d{8,15}$/.test(env.VITE_GHL_TODD_PHONE!)) {
    throw new Error(
      `VITE_GHL_TODD_PHONE must be E.164 format (e.g. +18168256198). Got: ${env.VITE_GHL_TODD_PHONE}`
    );
  }
  return {
    pipelineId: env.VITE_GHL_FENCE_PRODUCTION_PIPELINE_ID!,
    stages: {
      job_created: env.VITE_GHL_STAGE_JOB_CREATED!,
      scheduled: env.VITE_GHL_STAGE_SCHEDULED!,
      in_install: env.VITE_GHL_STAGE_IN_INSTALL!,
      job_complete: env.VITE_GHL_STAGE_JOB_COMPLETE!,
    },
    toddPhone: env.VITE_GHL_TODD_PHONE!,
  };
}

export const productionEnv = validateProductionEnv(
  import.meta.env as unknown as RawEnv
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/lib/env.test.ts`
Expected: PASS — 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/env.ts src/lib/env.test.ts
git commit -m "feat(env): add production env validation with E.164 check"
```

---

## Task 4: Define production types

**Files:**
- Create: `src/types/production.ts`

- [ ] **Step 1: Write the types file**

```ts
// src/types/production.ts

export type JobStage =
  | 'job_created'
  | 'hoa_811'
  | 'materials_ordered'
  | 'scheduled'
  | 'in_install'
  | 'job_complete'
  | 'final_payment';

export type JobStatus = 'active' | 'blocked' | 'needs_office_review' | 'complete';

export type ScheduledStartWindow = 'morning' | 'afternoon' | 'all_day';

export type DepositStatus = 'unpaid' | 'paid';

export type ChecklistSectionKey = 'loadout' | 'onsite' | 'install' | 'clean' | 'walkthrough';

export type PhotoPhase = 'loadout' | 'onsite' | 'install' | 'clean' | 'issue';

export type IssueType =
  | 'sprinkler_hit'
  | 'material_shortage'
  | 'weather_delay'
  | 'customer_concern'
  | 'gate_issue'
  | 'grade_issue'
  | 'utility_conflict'
  | 'other';

export type IssueSeverity = 'low' | 'medium' | 'high';

export type ActivitySource = 'manual' | 'workflow' | 'system';

export type Actor = 'todd' | 'ty';

export interface Job {
  job_id: string;
  job_number: string;
  contact_id: string;
  proposal_id: string | null;
  stage: JobStage;
  status: JobStatus;
  install_date: string | null;
  scheduled_start_window: ScheduledStartWindow | null;
  deposit_status: DepositStatus;
  deposit_paid_at: string | null;
  blocked_reason: string | null;
  blocked_note: string | null;
  blocked_at: string | null;
  needs_review_reason: string | null;
  access_notes: Record<string, unknown>;
  last_activity_at: string;
  last_activity_by: string | null;
  completed_at: string | null;
  archived_at: string | null;
  last_ghl_sync: string | null;
  ghl_stage: string | null;
  last_blocked_notification_at: string | null;
  created_at: string;
}

export interface JobFenceSpec {
  spec_id: string;
  job_id: string;
  fence_lines: Array<Record<string, unknown>>;
  gates: Array<Record<string, unknown>>;
  addons: Array<Record<string, unknown>>;
  total_sections: number;
  total_lf: number;
  proposal_total: number;
}

export interface ChecklistItem {
  checklist_id: string;
  job_id: string;
  section: ChecklistSectionKey;
  item_id: string;
  label: string;
  checked: boolean;
  checked_at: string | null;
  skippable: boolean;
  skipped: boolean;
  skip_reason: string | null;
  photo_required: boolean;
  photo_uploaded: boolean;
}

export interface JobPhoto {
  photo_id: string;
  job_id: string;
  phase: PhotoPhase;
  url: string;
  uploaded_at: string;
  uploaded_by: string | null;
  synced: boolean;
}

export interface JobIssue {
  issue_id: string;
  job_id: string;
  contact_id: string | null;
  type: IssueType;
  severity: IssueSeverity;
  customer_visible: boolean;
  note: string | null;
  photos: string[];
  section: ChecklistSectionKey | null;
  created_by: string | null;
  created_at: string;
  resolved: boolean;
  resolved_at: string | null;
  resolution_note: string | null;
}

export interface ActivityLogEntry {
  activity_id: string;
  job_id: string | null;
  contact_id: string | null;
  type: string;
  actor: string | null;
  source: ActivitySource;
  payload: Record<string, unknown>;
  created_at: string;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `bunx tsc --noEmit`
Expected: no errors related to `src/types/production.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/types/production.ts
git commit -m "feat(types): add production module types"
```

---

## Task 5: Add GHL helpers (stage move + SMS)

**Files:**
- Modify: `src/lib/crm-api.ts`

- [ ] **Step 1: Read existing crm-api.ts**

Confirm the current `crmApi` object includes `updateOpportunityStatus` but does not yet include `moveOpportunityToStage` or `sendSms`.

- [ ] **Step 2: Add helpers at the bottom of crmApi**

Inside the `export const crmApi = { ... }` object, add these two methods before the closing brace (right after `getPipelines`):

```ts
  async moveOpportunityToStage(opportunityId: string, pipelineStageId: string) {
    const res = await fetch(`${GHL_BASE}/opportunities/${opportunityId}`, {
      method: 'PUT',
      headers: jsonHeaders(),
      body: JSON.stringify({ pipelineStageId }),
    });
    return jsonOrThrow(res, 'moveOpportunityToStage');
  },

  async sendSms(toNumber: string, body: string) {
    if (!locationId) throw new Error('VITE_GHL_LOCATION_ID required for sendSms');
    const res = await fetch(`${GHL_BASE}/conversations/messages`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        type: 'SMS',
        locationId,
        toNumber,
        message: body,
      }),
    });
    return jsonOrThrow(res, 'sendSms');
  },
```

- [ ] **Step 3: Verify TypeScript**

Run: `bunx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/crm-api.ts
git commit -m "feat(crm): add moveOpportunityToStage and sendSms helpers"
```

---

## Task 6: Actor utility

**Files:**
- Create: `src/utils/actor.ts`
- Create: `src/utils/actor.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/utils/actor.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { resolveActorFromPin, getStoredActor, storeActor, clearStoredActor } from './actor';

describe('resolveActorFromPin', () => {
  it('returns todd for 1122', () => {
    expect(resolveActorFromPin('1122')).toBe('todd');
  });
  it('returns ty for 8633', () => {
    expect(resolveActorFromPin('8633')).toBe('ty');
  });
  it('returns null for unknown PIN', () => {
    expect(resolveActorFromPin('0000')).toBeNull();
    expect(resolveActorFromPin('')).toBeNull();
  });
});

describe('actor sessionStorage helpers', () => {
  beforeEach(() => sessionStorage.clear());

  it('round-trips an actor', () => {
    storeActor('todd');
    expect(getStoredActor()).toBe('todd');
  });
  it('clearStoredActor removes the value', () => {
    storeActor('ty');
    clearStoredActor();
    expect(getStoredActor()).toBeNull();
  });
  it('ignores junk values in storage', () => {
    sessionStorage.setItem('abrams_production_actor', 'eve');
    expect(getStoredActor()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/utils/actor.test.ts`
Expected: FAIL — "Cannot find module './actor'"

- [ ] **Step 3: Implement actor.ts**

```ts
// src/utils/actor.ts
import type { Actor } from '../types/production';

const SESSION_KEY = 'abrams_production_actor';

const PIN_TO_ACTOR: Record<string, Actor> = {
  '1122': 'todd',
  '8633': 'ty',
};

export function resolveActorFromPin(pin: string): Actor | null {
  return PIN_TO_ACTOR[pin] ?? null;
}

export function storeActor(actor: Actor): void {
  sessionStorage.setItem(SESSION_KEY, actor);
}

export function getStoredActor(): Actor | null {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (raw === 'todd' || raw === 'ty') return raw;
  return null;
}

export function clearStoredActor(): void {
  sessionStorage.removeItem(SESSION_KEY);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/utils/actor.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/utils/actor.ts src/utils/actor.test.ts
git commit -m "feat(actor): PIN→actor resolver with session persistence"
```

---

## Task 7: Job-number display formatter

**Files:**
- Create: `src/utils/jobNumber.ts`

- [ ] **Step 1: Implement formatter**

```ts
// src/utils/jobNumber.ts
// DB trigger generates the job_number string. This is display-only formatting.

export function formatJobNumberShort(jobNumber: string): string {
  // 'AF-2026-0007' → '#0007'
  const parts = jobNumber.split('-');
  return parts.length === 3 ? `#${parts[2]}` : jobNumber;
}

export function formatJobNumberFull(jobNumber: string): string {
  // Pass-through; placeholder for future formatting if needed.
  return jobNumber;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/utils/jobNumber.ts
git commit -m "feat(util): job-number display formatters"
```

---

## Task 8: Checklist template

**Files:**
- Create: `src/utils/checklistTemplate.ts`
- Create: `src/utils/checklistTemplate.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/utils/checklistTemplate.test.ts
import { describe, it, expect } from 'vitest';
import { CHECKLIST_TEMPLATE, buildChecklistRowsForJob } from './checklistTemplate';

describe('CHECKLIST_TEMPLATE', () => {
  it('has all 5 sections in order', () => {
    expect(CHECKLIST_TEMPLATE.map((s) => s.section)).toEqual([
      'loadout', 'onsite', 'install', 'clean', 'walkthrough',
    ]);
  });

  it('has 30 items total across all sections', () => {
    const total = CHECKLIST_TEMPLATE.reduce((n, s) => n + s.items.length, 0);
    expect(total).toBe(30);
  });

  it('marks Phase 5 install as skippable', () => {
    const install = CHECKLIST_TEMPLATE.find((s) => s.section === 'install')!;
    const phase5 = install.items.find((i) => i.item_id === 'install_phase_5')!;
    expect(phase5.skippable).toBe(true);
  });

  it('marks walkthrough non-gate items skippable', () => {
    const walk = CHECKLIST_TEMPLATE.find((s) => s.section === 'walkthrough')!;
    const ids = walk.items.filter((i) => i.skippable).map((i) => i.item_id);
    expect(ids).toContain('walk_gate_hardware_tight');
    expect(ids).toContain('walk_gates_swing');
    expect(ids).toContain('walk_gate_video');
    expect(ids).toContain('walk_customer_walkthrough');
  });
});

describe('buildChecklistRowsForJob', () => {
  it('returns 30 rows tagged with job_id', () => {
    const rows = buildChecklistRowsForJob('job-uuid-123');
    expect(rows).toHaveLength(30);
    expect(rows.every((r) => r.job_id === 'job-uuid-123')).toBe(true);
  });

  it('rows include section and item_id', () => {
    const rows = buildChecklistRowsForJob('j');
    expect(rows[0]).toHaveProperty('section');
    expect(rows[0]).toHaveProperty('item_id');
    expect(rows[0]).toHaveProperty('label');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/utils/checklistTemplate.test.ts`
Expected: FAIL — "Cannot find module './checklistTemplate'"

- [ ] **Step 3: Implement checklistTemplate.ts**

```ts
// src/utils/checklistTemplate.ts
import type { ChecklistSectionKey } from '../types/production';

interface TemplateItem {
  item_id: string;
  label: string;
  skippable: boolean;
  photo_required: boolean;
}

interface TemplateSection {
  section: ChecklistSectionKey;
  title: string;
  photo_description: string | null;
  items: TemplateItem[];
}

export const CHECKLIST_TEMPLATE: TemplateSection[] = [
  {
    section: 'loadout',
    title: 'Morning Loadout',
    photo_description: 'Loaded truck',
    items: [
      { item_id: 'load_job_details_reviewed', label: 'Job details reviewed with crew', skippable: false, photo_required: false },
      { item_id: 'load_cc_video_watched', label: 'CC video watched', skippable: false, photo_required: false },
      { item_id: 'load_811_confirmed', label: '811 confirmed valid', skippable: false, photo_required: false },
      { item_id: 'load_materials_verified', label: 'Materials verified and loaded', skippable: false, photo_required: false },
      { item_id: 'load_vehicle_checks', label: 'Vehicle checks complete', skippable: false, photo_required: false },
      { item_id: 'load_specialty_tools', label: 'Specialty tools loaded', skippable: false, photo_required: false },
      { item_id: 'load_fuel_card', label: 'Fuel card confirmed', skippable: false, photo_required: false },
      { item_id: 'load_clocked_in', label: 'Everyone clocked in', skippable: false, photo_required: false },
    ],
  },
  {
    section: 'onsite',
    title: 'On Site',
    photo_description: 'Before photo, full yard',
    items: [
      { item_id: 'onsite_customer_notified', label: 'Customer notified of arrival', skippable: false, photo_required: false },
      { item_id: 'onsite_site_walk', label: 'Site walk completed', skippable: false, photo_required: false },
      { item_id: 'onsite_ends_corners_verified', label: 'Ends, corners, gates, utilities verified', skippable: false, photo_required: false },
      { item_id: 'onsite_sprinklers_confirmed', label: 'Sprinkler locations confirmed', skippable: true, photo_required: false },
      { item_id: 'onsite_tarps_set', label: 'Tarps and yard protection set', skippable: false, photo_required: false },
      { item_id: 'onsite_layout_method', label: 'Layout method identified', skippable: false, photo_required: false },
      { item_id: 'onsite_key_posts_located', label: 'Key posts located', skippable: false, photo_required: false },
    ],
  },
  {
    section: 'install',
    title: 'Install',
    photo_description: 'Mid-install progress',
    items: [
      { item_id: 'install_phase_1', label: 'Phase 1 complete — holes dug / posts driven, key posts set', skippable: false, photo_required: false },
      { item_id: 'install_phase_2', label: 'Phase 2 complete — posts set, gate posts set, dirt work done', skippable: false, photo_required: false },
      { item_id: 'install_phase_3', label: 'Phase 3 complete — rails attached, balancing done', skippable: false, photo_required: false },
      { item_id: 'install_phase_4', label: 'Phase 4 complete — pickets/panels installed', skippable: false, photo_required: false },
      { item_id: 'install_phase_5', label: 'Phase 5 complete — gates hung, ins and outs done', skippable: true, photo_required: false },
    ],
  },
  {
    section: 'clean',
    title: 'Clean Site',
    photo_description: 'After photo, full yard',
    items: [
      { item_id: 'clean_magnet_sweep', label: 'Magnet sweep — full perimeter', skippable: false, photo_required: false },
      { item_id: 'clean_debris_removed', label: 'All debris and scrap removed', skippable: false, photo_required: false },
      { item_id: 'clean_soil_raked', label: 'Disturbed soil raked and leveled', skippable: false, photo_required: false },
      { item_id: 'clean_hard_surfaces', label: 'Hard surfaces blown off', skippable: false, photo_required: false },
      { item_id: 'clean_staging_cleared', label: 'Staging area cleared', skippable: false, photo_required: false },
      { item_id: 'clean_sprinkler_inspection', label: 'Sprinkler inspection — no damage confirmed', skippable: true, photo_required: false },
    ],
  },
  {
    section: 'walkthrough',
    title: 'Final Walkthrough',
    photo_description: null,
    items: [
      { item_id: 'walk_post_plumb', label: 'Post plumb verified', skippable: false, photo_required: false },
      { item_id: 'walk_straight_line', label: 'Straight line confirmed', skippable: false, photo_required: false },
      { item_id: 'walk_gate_hardware_tight', label: 'All gate hardware tight', skippable: true, photo_required: false },
      { item_id: 'walk_gates_swing', label: 'Gates swing and latch correctly', skippable: true, photo_required: false },
      { item_id: 'walk_gate_video', label: 'Gate video recorded', skippable: true, photo_required: false },
      { item_id: 'walk_customer_walkthrough', label: 'Final walkthrough completed with customer', skippable: true, photo_required: false },
    ],
  },
];

export interface ChecklistRowSeed {
  job_id: string;
  section: ChecklistSectionKey;
  item_id: string;
  label: string;
  skippable: boolean;
  photo_required: boolean;
}

export function buildChecklistRowsForJob(jobId: string): ChecklistRowSeed[] {
  const rows: ChecklistRowSeed[] = [];
  for (const sec of CHECKLIST_TEMPLATE) {
    for (const item of sec.items) {
      rows.push({
        job_id: jobId,
        section: sec.section,
        item_id: item.item_id,
        label: item.label,
        skippable: item.skippable,
        photo_required: item.photo_required,
      });
    }
  }
  return rows;
}

export function getSectionTemplate(section: ChecklistSectionKey): TemplateSection | undefined {
  return CHECKLIST_TEMPLATE.find((s) => s.section === section);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/utils/checklistTemplate.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/utils/checklistTemplate.ts src/utils/checklistTemplate.test.ts
git commit -m "feat(checklist): static template for all 30 items"
```

---

## Task 9: Notification rate-limit math

**Files:**
- Create: `src/utils/notificationThrottle.ts`
- Create: `src/utils/notificationThrottle.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/utils/notificationThrottle.test.ts
import { describe, it, expect } from 'vitest';
import { shouldFireBlockNotification } from './notificationThrottle';

const now = new Date('2026-05-21T12:00:00Z').getTime();

describe('shouldFireBlockNotification', () => {
  it('does not fire before day 3', () => {
    const blockedAt = new Date(now - 2 * 86400_000).toISOString();
    expect(shouldFireBlockNotification(blockedAt, null, now)).toBe(false);
  });

  it('fires on day 3 if never notified', () => {
    const blockedAt = new Date(now - 3 * 86400_000).toISOString();
    expect(shouldFireBlockNotification(blockedAt, null, now)).toBe(true);
  });

  it('does not re-fire within 48h of last notification', () => {
    const blockedAt = new Date(now - 5 * 86400_000).toISOString();
    const lastNotif = new Date(now - 24 * 3600_000).toISOString();
    expect(shouldFireBlockNotification(blockedAt, lastNotif, now)).toBe(false);
  });

  it('re-fires after 48h since last notification', () => {
    const blockedAt = new Date(now - 5 * 86400_000).toISOString();
    const lastNotif = new Date(now - 49 * 3600_000).toISOString();
    expect(shouldFireBlockNotification(blockedAt, lastNotif, now)).toBe(true);
  });

  it('does not fire if blocked_at is null', () => {
    expect(shouldFireBlockNotification(null, null, now)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/utils/notificationThrottle.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement throttle**

```ts
// src/utils/notificationThrottle.ts

const INITIAL_DELAY_MS = 3 * 86400_000;    // 3 days
const REPEAT_INTERVAL_MS = 48 * 3600_000;  // 48 hours

export function shouldFireBlockNotification(
  blockedAt: string | null,
  lastNotificationAt: string | null,
  nowMs: number = Date.now()
): boolean {
  if (!blockedAt) return false;
  const blockedMs = new Date(blockedAt).getTime();
  if (nowMs - blockedMs < INITIAL_DELAY_MS) return false;
  if (!lastNotificationAt) return true;
  const lastMs = new Date(lastNotificationAt).getTime();
  return nowMs - lastMs >= REPEAT_INTERVAL_MS;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/utils/notificationThrottle.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/utils/notificationThrottle.ts src/utils/notificationThrottle.test.ts
git commit -m "feat(notify): 3-day initial + 48h repeat throttle for block SMS"
```

---

## Task 10: GHL sync helpers

**Files:**
- Create: `src/utils/ghlSync.ts`

- [ ] **Step 1: Implement ghlSync.ts**

```ts
// src/utils/ghlSync.ts
import { crmApi } from '../lib/crm-api';
import { productionEnv } from '../lib/env';
import type { Job } from '../types/production';

interface JobWithOpp { proposal_id: string | null; contact_id: string; }

async function moveStage(opportunityId: string | null, stageId: string, label: string) {
  if (!opportunityId) {
    console.warn(`[ghlSync] ${label}: no opportunityId, skipping stage move`);
    return;
  }
  try {
    await crmApi.moveOpportunityToStage(opportunityId, stageId);
  } catch (err) {
    console.error(`[ghlSync] ${label} failed:`, err);
    // Swallow — never roll back Supabase. Hooks may schedule retry.
  }
}

export async function syncStageJobCreated(job: JobWithOpp) {
  await moveStage(job.proposal_id, productionEnv.stages.job_created, 'syncStageJobCreated');
}
export async function syncStageScheduled(job: JobWithOpp) {
  await moveStage(job.proposal_id, productionEnv.stages.scheduled, 'syncStageScheduled');
}
export async function syncStageInInstall(job: JobWithOpp) {
  await moveStage(job.proposal_id, productionEnv.stages.in_install, 'syncStageInInstall');
}
export async function syncStageJobComplete(job: JobWithOpp) {
  await moveStage(job.proposal_id, productionEnv.stages.job_complete, 'syncStageJobComplete');
}

export interface BlockSmsContext {
  jobNumber: string;
  customerName: string;
  reason: string;
  address: string;
  jobId: string;
}

export async function sendBlockSms(ctx: BlockSmsContext) {
  const body =
    `🚨 ABRAMS ALERT\n` +
    `Job: ${ctx.jobNumber} — ${ctx.customerName}\n` +
    `Reason: ${ctx.reason}\n` +
    `Address: ${ctx.address}\n` +
    `Open: abramsfence.com/production/job/${ctx.jobId}`;
  try {
    await crmApi.sendSms(productionEnv.toddPhone, body);
  } catch (err) {
    console.error('[ghlSync] sendBlockSms failed:', err);
  }
}

export interface IssueSmsContext {
  jobNumber: string;
  customerName: string;
  issueType: string;
  address: string;
  jobId: string;
}

export async function sendHighSeverityIssueSms(ctx: IssueSmsContext) {
  const body =
    `🚨 ABRAMS ALERT\n` +
    `Job: ${ctx.jobNumber} — ${ctx.customerName}\n` +
    `Reason: ${ctx.issueType}\n` +
    `Address: ${ctx.address}\n` +
    `Open: abramsfence.com/production/job/${ctx.jobId}`;
  try {
    await crmApi.sendSms(productionEnv.toddPhone, body);
  } catch (err) {
    console.error('[ghlSync] sendHighSeverityIssueSms failed:', err);
  }
}

// Re-export Job type so callers don't need a second import.
export type { Job };
```

- [ ] **Step 2: Verify TypeScript**

Run: `bunx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/utils/ghlSync.ts
git commit -m "feat(sync): GHL stage-move + SMS helpers, fail-soft"
```

---

## Task 11: useActivityLog hook

**Files:**
- Create: `src/hooks/useActivityLog.ts`

- [ ] **Step 1: Implement hook**

```ts
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
```

- [ ] **Step 2: Verify TypeScript**

Run: `bunx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useActivityLog.ts
git commit -m "feat(hook): useActivityLog append-only writer"
```

---

## Task 12: useJobs (list hook for dashboard)

**Files:**
- Create: `src/hooks/useJobs.ts`

- [ ] **Step 1: Implement hook**

```ts
// src/hooks/useJobs.ts
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Job } from '../types/production';

export function useJobs() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('jobs')
      .select('*')
      .is('archived_at', null)
      .order('install_date', { ascending: true, nullsFirst: false });
    if (error) {
      setError(error.message);
      setJobs([]);
    } else {
      setJobs((data ?? []) as Job[]);
      setError(null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel('jobs-list')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, load)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [load]);

  return { jobs, loading, error, reload: load };
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `bunx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useJobs.ts
git commit -m "feat(hook): useJobs list query with realtime channel"
```

---

## Task 13: useJob (single-job hook)

**Files:**
- Create: `src/hooks/useJob.ts`

- [ ] **Step 1: Implement hook**

```ts
// src/hooks/useJob.ts
import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useActivityLog } from './useActivityLog';
import {
  syncStageScheduled,
  syncStageInInstall,
  syncStageJobComplete,
  sendBlockSms,
} from '../utils/ghlSync';
import { shouldFireBlockNotification } from '../utils/notificationThrottle';
import type { Job, JobFenceSpec, JobStage, JobStatus } from '../types/production';

export function useJob(jobId: string | undefined) {
  const [job, setJob] = useState<Job | null>(null);
  const [spec, setSpec] = useState<JobFenceSpec | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { append } = useActivityLog();

  const load = useCallback(async () => {
    if (!jobId) return;
    setLoading(true);
    const [j, s] = await Promise.all([
      supabase.from('jobs').select('*').eq('job_id', jobId).maybeSingle(),
      supabase.from('job_fence_specs').select('*').eq('job_id', jobId).maybeSingle(),
    ]);
    if (j.error) { setError(j.error.message); setLoading(false); return; }
    setJob((j.data ?? null) as Job | null);
    setSpec((s.data ?? null) as JobFenceSpec | null);
    setError(null);
    setLoading(false);
  }, [jobId]);

  useEffect(() => {
    load();
    if (!jobId) return;
    const channel = supabase
      .channel(`job-${jobId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs', filter: `job_id=eq.${jobId}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [jobId, load]);

  const setStage = useCallback(async (stage: JobStage) => {
    if (!job) return;
    const { error } = await supabase
      .from('jobs')
      .update({ stage, last_activity_at: new Date().toISOString() })
      .eq('job_id', job.job_id);
    if (error) throw error;
    await append({ job_id: job.job_id, contact_id: job.contact_id, type: 'stage_change', payload: { to: stage, from: job.stage } });
    if (stage === 'scheduled') await syncStageScheduled(job);
    if (stage === 'in_install') await syncStageInInstall(job);
    if (stage === 'job_complete') await syncStageJobComplete(job);
  }, [job, append]);

  const block = useCallback(async (reason: string, note: string) => {
    if (!job) return;
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('jobs')
      .update({
        status: 'blocked' as JobStatus,
        blocked_reason: reason,
        blocked_note: note,
        blocked_at: now,
        last_activity_at: now,
      })
      .eq('job_id', job.job_id);
    if (error) throw error;
    await append({ job_id: job.job_id, contact_id: job.contact_id, type: 'job_blocked', payload: { reason, note } });
  }, [job, append]);

  const unblock = useCallback(async () => {
    if (!job) return;
    const { error } = await supabase
      .from('jobs')
      .update({ status: 'active', blocked_reason: null, blocked_note: null, blocked_at: null })
      .eq('job_id', job.job_id);
    if (error) throw error;
    await append({ job_id: job.job_id, contact_id: job.contact_id, type: 'job_unblocked' });
  }, [job, append]);

  const checkBlockNotification = useCallback(async () => {
    if (!job || job.status !== 'blocked') return;
    if (!shouldFireBlockNotification(job.blocked_at, job.last_blocked_notification_at)) return;
    await sendBlockSms({
      jobNumber: job.job_number,
      customerName: '(see GHL)',
      reason: job.blocked_reason ?? 'unspecified',
      address: '(see GHL)',
      jobId: job.job_id,
    });
    await supabase
      .from('jobs')
      .update({ last_blocked_notification_at: new Date().toISOString() })
      .eq('job_id', job.job_id);
  }, [job]);

  return { job, spec, loading, error, reload: load, setStage, block, unblock, checkBlockNotification };
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `bunx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useJob.ts
git commit -m "feat(hook): useJob with stage/block/unblock mutations + GHL sync"
```

---

## Task 14: useChecklist hook (with localStorage autosave)

**Files:**
- Create: `src/hooks/useChecklist.ts`

- [ ] **Step 1: Implement hook**

```ts
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
```

- [ ] **Step 2: Verify TypeScript**

Run: `bunx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useChecklist.ts
git commit -m "feat(hook): useChecklist with seed-on-first-load and localStorage autosave"
```

---

## Task 15: usePhotoQueue hook

**Files:**
- Create: `src/hooks/usePhotoQueue.ts`

- [ ] **Step 1: Implement hook**

```ts
// src/hooks/usePhotoQueue.ts
import { useCallback, useState } from 'react';
import { supabase } from '../lib/supabase';
import { crmApi } from '../lib/crm-api';
import { useActivityLog } from './useActivityLog';
import type { PhotoPhase } from '../types/production';

interface PendingUpload {
  file: File;
  phase: PhotoPhase;
  attempts: number;
}

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 30_000;
const BUCKET = 'job-photos';

function lsKey(jobId: string) {
  return `abrams_job_${jobId}_photos_queue`;
}

export function usePhotoQueue(jobId: string, contactId: string) {
  const { append } = useActivityLog();
  const [pendingCount, setPendingCount] = useState(0);

  const uploadToSupabase = useCallback(async (file: File, phase: PhotoPhase) => {
    const ts = Date.now();
    const photoId = crypto.randomUUID();
    const path = `${jobId}/${phase}/${ts}_${photoId}.jpg`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
      contentType: file.type || 'image/jpeg',
      upsert: false,
    });
    if (error) throw error;
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    const url = data.publicUrl;
    const { error: rowErr } = await supabase.from('job_photos').insert({
      photo_id: photoId,
      job_id: jobId,
      phase,
      url,
      synced: false,
    });
    if (rowErr) throw rowErr;
    return { photoId, url };
  }, [jobId]);

  const mirrorToGhl = useCallback(async (file: File, photoId: string) => {
    try {
      await crmApi.uploadPhoto(contactId, file);
      await supabase.from('job_photos').update({ synced: true }).eq('photo_id', photoId);
    } catch (err) {
      console.error('[usePhotoQueue] GHL mirror failed (will retry in field):', err);
    }
  }, [contactId]);

  const enqueueRetry = useCallback((up: PendingUpload) => {
    const raw = localStorage.getItem(lsKey(jobId));
    const queue: PendingUpload[] = raw ? JSON.parse(raw) : [];
    queue.push(up);
    localStorage.setItem(lsKey(jobId), JSON.stringify(queue));
    setPendingCount(queue.length);
  }, [jobId]);

  const upload = useCallback(async (file: File, phase: PhotoPhase) => {
    let attempts = 0;
    while (attempts < MAX_ATTEMPTS) {
      try {
        const { photoId } = await uploadToSupabase(file, phase);
        await append({ job_id: jobId, contact_id: contactId, type: 'photo_uploaded', payload: { phase, photo_id: photoId } });
        if (phase !== 'issue') {
          // Fire-and-forget mirror — never block the UI.
          void mirrorToGhl(file, photoId);
        }
        return { ok: true as const, photoId };
      } catch (err) {
        attempts++;
        console.error(`[usePhotoQueue] attempt ${attempts} failed:`, err);
        if (attempts >= MAX_ATTEMPTS) {
          enqueueRetry({ file, phase, attempts });
          return { ok: false as const, error: err };
        }
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }
    return { ok: false as const, error: new Error('exhausted retries') };
  }, [uploadToSupabase, mirrorToGhl, enqueueRetry, append, jobId, contactId]);

  return { upload, pendingCount };
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `bunx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/usePhotoQueue.ts
git commit -m "feat(hook): usePhotoQueue with 3-retry queue + async GHL mirror"
```

---

## Task 16: useIssue hook

**Files:**
- Create: `src/hooks/useIssue.ts`

- [ ] **Step 1: Implement hook**

```ts
// src/hooks/useIssue.ts
import { useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useActivityLog } from './useActivityLog';
import { sendHighSeverityIssueSms } from '../utils/ghlSync';
import { getStoredActor } from '../utils/actor';
import type {
  IssueType,
  IssueSeverity,
  ChecklistSectionKey,
  JobIssue,
} from '../types/production';

interface CreateIssueInput {
  job_id: string;
  contact_id: string;
  type: IssueType;
  severity: IssueSeverity;
  note: string;
  photos: string[];
  section: ChecklistSectionKey | null;
  jobNumber: string;
}

export function useIssue() {
  const { append } = useActivityLog();

  const create = useCallback(async (input: CreateIssueInput) => {
    let severity = input.severity;
    let customer_visible = false;
    if (input.type === 'customer_concern') {
      if (severity === 'low') severity = 'medium';
      customer_visible = true;
    }
    if ((input.type === 'sprinkler_hit' || input.type === 'utility_conflict') && input.photos.length === 0) {
      throw new Error('Photo required for sprinkler hits and utility conflicts');
    }

    const { data, error } = await supabase
      .from('job_issues')
      .insert({
        job_id: input.job_id,
        contact_id: input.contact_id,
        type: input.type,
        severity,
        customer_visible,
        note: input.note,
        photos: input.photos,
        section: input.section,
        created_by: getStoredActor(),
      })
      .select('*')
      .single();
    if (error) throw error;
    await append({
      job_id: input.job_id,
      contact_id: input.contact_id,
      type: 'issue_flagged',
      payload: { issue_id: (data as JobIssue).issue_id, type: input.type, severity, section: input.section },
    });
    if (severity === 'high') {
      await sendHighSeverityIssueSms({
        jobNumber: input.jobNumber,
        customerName: '(see GHL)',
        issueType: input.type,
        address: '(see GHL)',
        jobId: input.job_id,
      });
    }
    return data as JobIssue;
  }, [append]);

  const resolve = useCallback(async (issueId: string, resolutionNote: string) => {
    const { error } = await supabase
      .from('job_issues')
      .update({
        resolved: true,
        resolved_at: new Date().toISOString(),
        resolution_note: resolutionNote,
      })
      .eq('issue_id', issueId);
    if (error) throw error;
    await append({ type: 'issue_resolved', payload: { issue_id: issueId } });
  }, [append]);

  return { create, resolve };
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `bunx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useIssue.ts
git commit -m "feat(hook): useIssue with auto-rules + high-severity SMS"
```

---

## Task 17: StatusBadge + StagePill

**Files:**
- Create: `src/components/production/StatusBadge.tsx`
- Create: `src/components/production/StagePill.tsx`

- [ ] **Step 1: Implement StatusBadge**

```tsx
// src/components/production/StatusBadge.tsx
import type { JobStatus } from '../../types/production';

interface Props { status: JobStatus; }

const STYLES: Record<JobStatus, string> = {
  active: 'bg-emerald-100 text-emerald-700',
  blocked: 'bg-amber-100 text-amber-800 border border-amber-400',
  needs_office_review: 'bg-rose-100 text-rose-800',
  complete: 'bg-slate-200 text-slate-700',
};

const LABELS: Record<JobStatus, string> = {
  active: 'Active',
  blocked: 'Blocked',
  needs_office_review: 'Needs Review',
  complete: 'Complete',
};

export function StatusBadge({ status }: Props) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${STYLES[status]}`}>
      {LABELS[status]}
    </span>
  );
}
```

- [ ] **Step 2: Implement StagePill**

```tsx
// src/components/production/StagePill.tsx
import type { JobStage } from '../../types/production';

interface Props { stage: JobStage; }

const LABELS: Record<JobStage, string> = {
  job_created: 'Job Created',
  hoa_811: 'HOA / 811',
  materials_ordered: 'Materials Ordered',
  scheduled: 'Scheduled',
  in_install: 'In Install',
  job_complete: 'Job Complete',
  final_payment: 'Final Payment',
};

export function StagePill({ stage }: Props) {
  return (
    <span className="inline-block rounded-md bg-[#0a1f3d] text-white px-2 py-0.5 text-xs font-medium">
      {LABELS[stage]}
    </span>
  );
}
```

- [ ] **Step 3: Verify TypeScript**

Run: `bunx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/production/StatusBadge.tsx src/components/production/StagePill.tsx
git commit -m "feat(ui): StatusBadge and StagePill"
```

---

## Task 18: Production PinGate (multi-PIN)

**Files:**
- Create: `src/components/production/PinGate.tsx`

- [ ] **Step 1: Implement PinGate**

```tsx
// src/components/production/PinGate.tsx
import { useState } from 'react';
import { resolveActorFromPin, storeActor } from '../../utils/actor';
import type { Actor } from '../../types/production';

interface Props {
  onUnlock: (actor: Actor) => void;
}

export function ProductionPinGate({ onUnlock }: Props) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [shake, setShake] = useState(false);

  const submit = (next: string) => {
    const actor = resolveActorFromPin(next);
    if (actor) {
      storeActor(actor);
      onUnlock(actor);
    } else {
      setShake(true);
      setError(true);
      setTimeout(() => { setPin(''); setShake(false); }, 600);
    }
  };

  const handleDigit = (d: string) => {
    if (pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    setError(false);
    if (next.length === 4) submit(next);
  };

  const handleDelete = () => { setPin((p) => p.slice(0, -1)); setError(false); };
  const dots = Array.from({ length: 4 }, (_, i) => i < pin.length);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#0a1f3d] px-6">
      <img
        src="https://vibe.filesafe.space/1778961049274125424/assets/7a08ba12-4d80-4131-ad78-bd01283acbf1.png"
        alt="Abrams Fence Co."
        className="h-14 mb-8 object-contain"
      />
      <p className="text-white/60 text-sm font-sans mb-8 tracking-widest uppercase">Production — Enter PIN</p>
      <div className={`flex gap-4 mb-10 ${shake ? 'animate-[wiggle_0.4s_ease-in-out]' : ''}`}>
        {dots.map((filled, i) => (
          <div key={i} className={`w-4 h-4 rounded-full border-2 transition-all duration-150 ${
            filled ? (error ? 'bg-red-400 border-red-400' : 'bg-white border-white') : 'border-white/30 bg-transparent'
          }`} />
        ))}
      </div>
      {error && <p className="text-red-400 text-sm mb-6">Incorrect PIN. Try again.</p>}
      <div className="grid grid-cols-3 gap-4 w-full max-w-[260px]">
        {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((key, idx) => {
          if (key === '') return <div key={idx} />;
          return (
            <button
              key={idx}
              onClick={() => key === '⌫' ? handleDelete() : handleDigit(key)}
              className="h-16 rounded-2xl bg-white/10 text-white text-xl font-semibold active:bg-white/25 transition-colors select-none"
            >
              {key}
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `bunx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/production/PinGate.tsx
git commit -m "feat(ui): production PinGate with multi-PIN (Todd 1122, Ty 8633)"
```

---

## Task 19: ViewToggle

**Files:**
- Create: `src/components/production/ViewToggle.tsx`

- [ ] **Step 1: Implement ViewToggle**

```tsx
// src/components/production/ViewToggle.tsx
import { useEffect, useState } from 'react';

const STORAGE_KEY = 'abrams_production_view';
export type ProductionView = 'office' | 'field';

function detectDefault(): ProductionView {
  if (typeof window === 'undefined') return 'office';
  return window.innerWidth > 768 ? 'office' : 'field';
}

export function useProductionView(): [ProductionView, (v: ProductionView) => void] {
  const [view, setView] = useState<ProductionView>('office');
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'office' || stored === 'field') setView(stored);
    else setView(detectDefault());
  }, []);
  const update = (next: ProductionView) => {
    setView(next);
    localStorage.setItem(STORAGE_KEY, next);
  };
  return [view, update];
}

interface Props {
  view: ProductionView;
  onChange: (v: ProductionView) => void;
}

export function ViewToggle({ view, onChange }: Props) {
  return (
    <div className="inline-flex rounded-lg border border-slate-300 overflow-hidden text-sm">
      <button
        onClick={() => onChange('office')}
        className={`px-3 py-1.5 ${view === 'office' ? 'bg-[#0a1f3d] text-white' : 'bg-white text-slate-700'}`}
      >🖥 Office</button>
      <button
        onClick={() => onChange('field')}
        className={`px-3 py-1.5 ${view === 'field' ? 'bg-[#0a1f3d] text-white' : 'bg-white text-slate-700'}`}
      >📱 Field</button>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `bunx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/production/ViewToggle.tsx
git commit -m "feat(ui): ViewToggle with localStorage persistence"
```

---

## Task 20: JobCard

**Files:**
- Create: `src/components/production/JobCard.tsx`

- [ ] **Step 1: Implement JobCard**

```tsx
// src/components/production/JobCard.tsx
import { Link } from 'react-router-dom';
import { StatusBadge } from './StatusBadge';
import { StagePill } from './StagePill';
import type { Job } from '../../types/production';

interface Props { job: Job; daysBlocked?: number; }

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000);
}

export function JobCard({ job }: Props) {
  const daysBlocked = job.blocked_at ? daysSince(job.blocked_at) ?? 0 : 0;
  const depositOverdue = job.deposit_status === 'unpaid'
    && (daysSince(job.created_at) ?? 0) >= 3;
  const unscheduledOverdue = !job.install_date
    && (daysSince(job.created_at) ?? 0) >= 5;

  const borderClass = job.status === 'blocked'
    ? 'border-amber-400 animate-pulse'
    : 'border-slate-200';

  return (
    <Link
      to={`/production/job/${job.job_id}`}
      className={`block rounded-lg border-2 ${borderClass} bg-white p-4 hover:shadow-md transition`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="font-semibold text-slate-900">{job.job_number}</span>
            <StatusBadge status={job.status} />
            <StagePill stage={job.stage} />
          </div>
          <div className="text-sm text-slate-600">
            {job.install_date ? `Install: ${job.install_date}` : 'Unscheduled'}
            {job.scheduled_start_window && ` · ${job.scheduled_start_window.replace('_', ' ')}`}
          </div>
        </div>
        <div className="text-right text-xs text-slate-500">
          {job.status === 'blocked' && daysBlocked >= 3 && (
            <div className="text-amber-700 font-semibold">⚠ Blocked {daysBlocked}d</div>
          )}
          {depositOverdue && <div className="text-rose-700">Deposit unpaid</div>}
          {unscheduledOverdue && <div className="text-rose-700">No install date</div>}
          <div>Deposit: {job.deposit_status}</div>
        </div>
      </div>
    </Link>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `bunx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/production/JobCard.tsx
git commit -m "feat(ui): JobCard with overdue/blocked flags"
```

---

## Task 21: ChecklistItem + ChecklistSection

**Files:**
- Create: `src/components/production/ChecklistItem.tsx`
- Create: `src/components/production/ChecklistSection.tsx`

- [ ] **Step 1: Implement ChecklistItem**

```tsx
// src/components/production/ChecklistItem.tsx
import { useState } from 'react';
import type { ChecklistItem as Item } from '../../types/production';

interface Props {
  item: Item;
  onToggle: (id: string, checked: boolean) => Promise<void>;
  onSkip: (id: string, reason: string) => Promise<void>;
}

export function ChecklistItem({ item, onToggle, onSkip }: Props) {
  const [showSkip, setShowSkip] = useState(false);
  const [reason, setReason] = useState('');

  if (item.skipped) {
    return (
      <div className="flex items-start gap-2 py-2 text-slate-500 line-through">
        <span>⏭</span>
        <div>
          <div>{item.label}</div>
          {item.skip_reason && <div className="text-xs">Skipped: {item.skip_reason}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="py-2">
      <label className="flex items-start gap-3 cursor-pointer">
        <input
          type="checkbox"
          checked={item.checked}
          onChange={(e) => onToggle(item.item_id, e.target.checked)}
          className="mt-1 h-5 w-5 rounded border-slate-400"
        />
        <span className={item.checked ? 'text-slate-400 line-through' : 'text-slate-800'}>
          {item.label}
        </span>
      </label>
      {item.skippable && !item.checked && (
        <div className="ml-8 mt-1">
          {!showSkip ? (
            <button onClick={() => setShowSkip(true)} className="text-xs text-slate-500 underline">
              Skip
            </button>
          ) : (
            <div className="flex gap-2 mt-1">
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason"
                className="border rounded px-2 py-1 text-sm flex-1"
              />
              <button
                disabled={!reason.trim()}
                onClick={() => onSkip(item.item_id, reason.trim())}
                className="px-3 py-1 bg-[#0a1f3d] text-white rounded text-sm disabled:opacity-40"
              >Save</button>
              <button onClick={() => { setShowSkip(false); setReason(''); }} className="text-sm text-slate-500">Cancel</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Implement ChecklistSection**

```tsx
// src/components/production/ChecklistSection.tsx
import { useState, type ReactNode } from 'react';
import { ChecklistItem as Row } from './ChecklistItem';
import type { ChecklistItem } from '../../types/production';

interface Props {
  title: string;
  photoDescription: string | null;
  items: ChecklistItem[];
  photoUploaded: boolean;
  onToggle: (id: string, checked: boolean) => Promise<void>;
  onSkip: (id: string, reason: string) => Promise<void>;
  photoUploadSlot?: ReactNode;
}

export function ChecklistSection({ title, photoDescription, items, photoUploaded, onToggle, onSkip, photoUploadSlot }: Props) {
  const [open, setOpen] = useState(true);
  const done = items.length > 0 && items.every((i) => i.checked || i.skipped);
  const photoOk = !photoDescription || photoUploaded;
  return (
    <div className="border rounded-lg overflow-hidden bg-white">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100"
      >
        <span className="font-semibold text-slate-800 text-left">
          {done && photoOk ? '✅ ' : ''}{title}
        </span>
        <span className="text-slate-400">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="px-4 py-2">
          {items.map((it) => (
            <Row key={it.item_id} item={it} onToggle={onToggle} onSkip={onSkip} />
          ))}
          {photoDescription && (
            <div className="mt-3 pt-3 border-t">
              <div className="text-xs text-slate-500 mb-2">Photo: {photoDescription}</div>
              {photoUploaded ? (
                <div className="text-emerald-700 text-sm">✅ Photo uploaded</div>
              ) : (
                photoUploadSlot
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript**

Run: `bunx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/production/ChecklistItem.tsx src/components/production/ChecklistSection.tsx
git commit -m "feat(ui): ChecklistItem and ChecklistSection with skip flow"
```

---

## Task 22: PhotoUpload component

**Files:**
- Create: `src/components/production/PhotoUpload.tsx`

- [ ] **Step 1: Implement PhotoUpload**

```tsx
// src/components/production/PhotoUpload.tsx
import { useRef, useState } from 'react';
import { usePhotoQueue } from '../../hooks/usePhotoQueue';
import type { PhotoPhase } from '../../types/production';

interface Props {
  jobId: string;
  contactId: string;
  phase: PhotoPhase;
  onUploaded?: (photoId: string) => void;
  label?: string;
}

export function PhotoUpload({ jobId, contactId, phase, onUploaded, label }: Props) {
  const { upload, pendingCount } = usePhotoQueue(jobId, contactId);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  const pick = () => inputRef.current?.click();

  const onChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setWarning(null);
    const result = await upload(file, phase);
    setBusy(false);
    if (result.ok) {
      onUploaded?.(result.photoId);
    } else {
      setWarning('⚠️ Upload pending');
    }
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div>
      <button
        onClick={pick}
        disabled={busy}
        className="px-4 py-2 bg-[#0a1f3d] text-white rounded text-sm disabled:opacity-50"
      >
        {busy ? 'Uploading…' : (label ?? '📷 Upload photo')}
      </button>
      <input ref={inputRef} type="file" accept="image/*" capture="environment" hidden onChange={onChange} />
      {warning && <div className="text-xs text-amber-700 mt-1">{warning}</div>}
      {pendingCount > 0 && <div className="text-xs text-slate-500 mt-1">{pendingCount} queued</div>}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `bunx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/production/PhotoUpload.tsx
git commit -m "feat(ui): PhotoUpload with pending indicator"
```

---

## Task 23: FlagIssueModal

**Files:**
- Create: `src/components/production/FlagIssueModal.tsx`

- [ ] **Step 1: Implement FlagIssueModal**

```tsx
// src/components/production/FlagIssueModal.tsx
import { useState } from 'react';
import { useIssue } from '../../hooks/useIssue';
import { PhotoUpload } from './PhotoUpload';
import type { IssueType, IssueSeverity, ChecklistSectionKey } from '../../types/production';

interface Props {
  jobId: string;
  contactId: string;
  jobNumber: string;
  section: ChecklistSectionKey | null;
  onClose: () => void;
}

const TYPES: { value: IssueType; label: string }[] = [
  { value: 'sprinkler_hit', label: 'Sprinkler hit' },
  { value: 'material_shortage', label: 'Material shortage' },
  { value: 'weather_delay', label: 'Weather delay' },
  { value: 'customer_concern', label: 'Customer concern' },
  { value: 'gate_issue', label: 'Gate issue' },
  { value: 'grade_issue', label: 'Grade issue' },
  { value: 'utility_conflict', label: 'Utility conflict' },
  { value: 'other', label: 'Other' },
];

export function FlagIssueModal({ jobId, contactId, jobNumber, section, onClose }: Props) {
  const { create } = useIssue();
  const [type, setType] = useState<IssueType>('other');
  const [severity, setSeverity] = useState<IssueSeverity>('low');
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await create({ job_id: jobId, contact_id: contactId, type, severity, note, photos, section, jobNumber });
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to create issue');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-md p-5 space-y-3">
        <h2 className="font-semibold text-lg">🚩 Flag Issue</h2>
        {section && <div className="text-xs text-slate-500">Section: {section}</div>}
        <label className="block text-sm">
          Type
          <select value={type} onChange={(e) => setType(e.target.value as IssueType)} className="w-full border rounded p-2 mt-1">
            {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </label>
        <label className="block text-sm">
          Severity
          <select value={severity} onChange={(e) => setSeverity(e.target.value as IssueSeverity)} className="w-full border rounded p-2 mt-1">
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High — texts Todd</option>
          </select>
        </label>
        <label className="block text-sm">
          Note
          <textarea value={note} onChange={(e) => setNote(e.target.value)} className="w-full border rounded p-2 mt-1" rows={3} />
        </label>
        <div>
          <div className="text-sm mb-1">Photo (required for sprinkler / utility)</div>
          <PhotoUpload
            jobId={jobId}
            contactId={contactId}
            phase="issue"
            onUploaded={(photoId) => setPhotos((p) => [...p, photoId])}
            label="📷 Attach photo"
          />
          {photos.length > 0 && <div className="text-xs text-slate-500 mt-1">{photos.length} attached</div>}
        </div>
        {error && <div className="text-rose-700 text-sm">{error}</div>}
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-2 text-slate-600">Cancel</button>
          <button
            onClick={submit}
            disabled={submitting}
            className="px-4 py-2 bg-[#0a1f3d] text-white rounded disabled:opacity-50"
          >{submitting ? 'Saving…' : 'Flag Issue'}</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `bunx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/components/production/FlagIssueModal.tsx
git commit -m "feat(ui): FlagIssueModal with auto-section capture"
```

---

## Task 24: BlockedModal + CompleteConfirmModal + JobHeader

**Files:**
- Create: `src/components/production/BlockedModal.tsx`
- Create: `src/components/production/CompleteConfirmModal.tsx`
- Create: `src/components/production/JobHeader.tsx`

- [ ] **Step 1: Implement BlockedModal**

```tsx
// src/components/production/BlockedModal.tsx
import { useState } from 'react';

interface Props {
  onClose: () => void;
  onBlock: (reason: string, note: string) => Promise<void>;
}

const REASONS = [
  'weather',
  'customer_unreachable',
  'materials_back_order',
  'permit_pending',
  'utility_marking_pending',
  'other',
];

export function BlockedModal({ onClose, onBlock }: Props) {
  const [reason, setReason] = useState(REASONS[0]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-md p-5 space-y-3">
        <h2 className="font-semibold text-lg">Block this job</h2>
        <label className="block text-sm">
          Reason
          <select value={reason} onChange={(e) => setReason(e.target.value)} className="w-full border rounded p-2 mt-1">
            {REASONS.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
          </select>
        </label>
        <label className="block text-sm">
          Note
          <textarea value={note} onChange={(e) => setNote(e.target.value)} className="w-full border rounded p-2 mt-1" rows={3} />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-2 text-slate-600">Cancel</button>
          <button
            onClick={async () => { setBusy(true); await onBlock(reason, note); setBusy(false); onClose(); }}
            disabled={busy}
            className="px-4 py-2 bg-amber-600 text-white rounded disabled:opacity-50"
          >{busy ? 'Saving…' : 'Block job'}</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Implement CompleteConfirmModal**

```tsx
// src/components/production/CompleteConfirmModal.tsx
interface Props { onCancel: () => void; onConfirm: () => Promise<void>; }

export function CompleteConfirmModal({ onCancel, onConfirm }: Props) {
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-md p-5 space-y-4">
        <h2 className="font-semibold text-lg">Mark this job complete?</h2>
        <p className="text-sm text-slate-600">
          This moves the GHL opportunity to <strong>Job Complete</strong> and triggers the review request workflow.
          You cannot undo this from the field view.
        </p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-3 py-2 text-slate-600">Cancel</button>
          <button onClick={onConfirm} className="px-4 py-2 bg-emerald-700 text-white rounded">Mark complete</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Implement JobHeader**

```tsx
// src/components/production/JobHeader.tsx
import type { Job, JobFenceSpec } from '../../types/production';
import { StatusBadge } from './StatusBadge';
import { StagePill } from './StagePill';

interface Props { job: Job; spec: JobFenceSpec | null; address: string; customerName: string; }

export function JobHeader({ job, spec, address, customerName }: Props) {
  const mapsHref = `https://maps.google.com/?q=${encodeURIComponent(address)}`;
  const accessLines = Object.entries(job.access_notes ?? {})
    .filter(([, v]) => v !== '' && v !== null && v !== undefined)
    .map(([k, v]) => `${k}: ${String(v)}`);
  return (
    <div className="sticky top-0 z-10 bg-white border-b border-slate-200 p-3 space-y-1">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold">{customerName}</span>
        <StatusBadge status={job.status} />
        <StagePill stage={job.stage} />
      </div>
      <div className="text-sm">
        <a href={mapsHref} target="_blank" rel="noreferrer" className="text-blue-700 underline">
          {address || '(no address)'}
        </a>
      </div>
      <div className="text-xs text-slate-600 flex gap-3 flex-wrap">
        <span>{job.job_number}</span>
        {job.install_date && <span>Install: {job.install_date}</span>}
        {spec && <span>{spec.total_sections} sections · {spec.total_lf} LF</span>}
      </div>
      {accessLines.length > 0 && (
        <div className="text-xs text-amber-800 bg-amber-50 rounded p-2">
          {accessLines.map((l) => <div key={l}>⚠ {l}</div>)}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verify TypeScript**

Run: `bunx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/production/BlockedModal.tsx src/components/production/CompleteConfirmModal.tsx src/components/production/JobHeader.tsx
git commit -m "feat(ui): BlockedModal, CompleteConfirmModal, JobHeader"
```

---

## Task 25: ProductionDashboard page

**Files:**
- Modify: `src/pages/production/ProductionDashboard.tsx`

- [ ] **Step 1: Replace the stub**

```tsx
// src/pages/production/ProductionDashboard.tsx
import { useMemo } from 'react';
import { useJobs } from '../../hooks/useJobs';
import { JobCard } from '../../components/production/JobCard';
import { ViewToggle, useProductionView } from '../../components/production/ViewToggle';
import type { Job } from '../../types/production';

export default function ProductionDashboard() {
  const { jobs, loading, error } = useJobs();
  const [view, setView] = useProductionView();

  const sorted = useMemo<Job[]>(() => {
    const blocked = jobs.filter((j) => j.status === 'blocked');
    const rest = jobs.filter((j) => j.status !== 'blocked');
    blocked.sort((a, b) => (a.blocked_at ?? '').localeCompare(b.blocked_at ?? ''));
    rest.sort((a, b) => {
      if (!a.install_date && !b.install_date) return 0;
      if (!a.install_date) return 1;
      if (!b.install_date) return -1;
      return a.install_date.localeCompare(b.install_date);
    });
    return [...blocked, ...rest];
  }, [jobs]);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#0a1f3d]">Production</h1>
          <div className="text-xs text-slate-500">{sorted.length} active jobs</div>
        </div>
        <ViewToggle view={view} onChange={setView} />
      </header>

      <main className="p-4 md:p-6 space-y-3 max-w-3xl mx-auto">
        {loading && <div className="text-slate-500">Loading…</div>}
        {error && <div className="text-rose-700">{error}</div>}
        {!loading && sorted.length === 0 && (
          <div className="text-slate-500 text-center py-12">No active jobs yet.</div>
        )}
        {sorted.map((j) => <JobCard key={j.job_id} job={j} />)}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `bunx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/pages/production/ProductionDashboard.tsx
git commit -m "feat(page): production dashboard list view with blocked-first sort"
```

---

## Task 26: ProductionJob (field) page

**Files:**
- Modify: `src/pages/production/ProductionJob.tsx`

- [ ] **Step 1: Implement the field page**

```tsx
// src/pages/production/ProductionJob.tsx
import { useMemo, useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useJob } from '../../hooks/useJob';
import { useChecklist } from '../../hooks/useChecklist';
import { JobHeader } from '../../components/production/JobHeader';
import { ChecklistSection } from '../../components/production/ChecklistSection';
import { FlagIssueModal } from '../../components/production/FlagIssueModal';
import { BlockedModal } from '../../components/production/BlockedModal';
import { CompleteConfirmModal } from '../../components/production/CompleteConfirmModal';
import { PhotoUpload } from '../../components/production/PhotoUpload';
import { CHECKLIST_TEMPLATE } from '../../utils/checklistTemplate';
import { supabase } from '../../lib/supabase';
import type {
  ChecklistSectionKey,
  PhotoPhase,
  JobPhoto,
} from '../../types/production';

export default function ProductionJob() {
  const { jobId } = useParams<{ jobId: string }>();
  const { job, spec, loading, setStage, block, checkBlockNotification } = useJob(jobId);
  const { items, allDone, toggle, skip } = useChecklist(jobId);

  const [issueOpen, setIssueOpen] = useState(false);
  const [issueSection, setIssueSection] = useState<ChecklistSectionKey | null>(null);
  const [blockOpen, setBlockOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [photosByPhase, setPhotosByPhase] = useState<Record<string, boolean>>({});

  useEffect(() => { if (job) void checkBlockNotification(); }, [job, checkBlockNotification]);

  useEffect(() => {
    if (!jobId) return;
    void supabase
      .from('job_photos')
      .select('phase')
      .eq('job_id', jobId)
      .then((res) => {
        const map: Record<string, boolean> = {};
        for (const r of (res.data ?? []) as Pick<JobPhoto, 'phase'>[]) map[r.phase] = true;
        setPhotosByPhase(map);
      });
  }, [jobId]);

  const sections = useMemo(() => {
    const out: Record<ChecklistSectionKey, typeof items> = {
      loadout: [], onsite: [], install: [], clean: [], walkthrough: [],
    };
    for (const it of items) out[it.section].push(it);
    return out;
  }, [items]);

  if (loading || !job || !jobId) return <div className="p-6">Loading…</div>;

  const customerName = '(name from GHL)';
  const address = '(address from GHL)';

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      <JobHeader job={job} spec={spec} customerName={customerName} address={address} />

      <button
        onClick={() => { setIssueSection(null); setIssueOpen(true); }}
        className="fixed top-3 right-3 z-20 bg-rose-600 text-white px-3 py-2 rounded-lg shadow-md text-sm"
      >🚩 Flag Issue</button>

      <main className="p-3 space-y-3">
        {CHECKLIST_TEMPLATE.map((sec) => (
          <ChecklistSection
            key={sec.section}
            title={sec.title}
            photoDescription={sec.photo_description}
            items={sections[sec.section]}
            photoUploaded={!!photosByPhase[sec.section]}
            onToggle={toggle}
            onSkip={skip}
            photoUploadSlot={
              sec.photo_description ? (
                <PhotoUpload
                  jobId={jobId}
                  contactId={job.contact_id}
                  phase={sec.section as PhotoPhase}
                  onUploaded={() => setPhotosByPhase((p) => ({ ...p, [sec.section]: true }))}
                />
              ) : null
            }
          />
        ))}

        <div className="grid grid-cols-2 gap-2 pt-2">
          <button
            onClick={() => setBlockOpen(true)}
            className="px-4 py-3 border border-amber-500 text-amber-700 rounded-lg"
          >Block Job</button>
          <button
            disabled={!allDone}
            onClick={() => setCompleteOpen(true)}
            className="px-4 py-3 bg-emerald-700 text-white rounded-lg disabled:opacity-50"
          >Mark Job Complete</button>
        </div>
      </main>

      {issueOpen && (
        <FlagIssueModal
          jobId={jobId}
          contactId={job.contact_id}
          jobNumber={job.job_number}
          section={issueSection}
          onClose={() => setIssueOpen(false)}
        />
      )}
      {blockOpen && (
        <BlockedModal
          onClose={() => setBlockOpen(false)}
          onBlock={(reason, note) => block(reason, note)}
        />
      )}
      {completeOpen && (
        <CompleteConfirmModal
          onCancel={() => setCompleteOpen(false)}
          onConfirm={async () => { await setStage('job_complete'); setCompleteOpen(false); }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `bunx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/pages/production/ProductionJob.tsx
git commit -m "feat(page): production field job view with checklist, photos, issue flag, block/complete"
```

---

## Task 27: Wire PinGate into /production routes

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add a ProductionShell wrapper**

Replace the contents of `src/App.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Link, Navigate, Outlet } from 'react-router-dom';
import ConsultPage from './pages/consult/ConsultPage';
import ProposalPage from './pages/proposal/ProposalPage';
import ProductionDashboard from './pages/production/ProductionDashboard';
import ProductionJob from './pages/production/ProductionJob';
import { ProductionPinGate } from './components/production/PinGate';
import { getStoredActor } from './utils/actor';

function ProductionShell() {
  const [unlocked, setUnlocked] = useState(false);
  useEffect(() => { if (getStoredActor()) setUnlocked(true); }, []);
  if (!unlocked) return <ProductionPinGate onUnlock={() => setUnlocked(true)} />;
  return <Outlet />;
}

function Home() {
  return (
    <div className="min-h-screen bg-white p-8">
      <h1 className="text-3xl font-semibold text-primary mb-2">Abrams Fence Ops</h1>
      <p className="text-gray-600 mb-8">Internal operations app</p>
      <nav className="flex flex-col gap-2">
        <Link to="/consult" className="text-primary underline">Consult</Link>
        <Link to="/production" className="text-primary underline">Production dashboard</Link>
      </nav>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/consult" element={<ConsultPage />} />
        <Route path="/proposal/:contactId" element={<ProposalPage />} />
        <Route element={<ProductionShell />}>
          <Route path="/production" element={<ProductionDashboard />} />
          <Route path="/production/job/:jobId" element={<ProductionJob />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

Run: `bunx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat(routes): gate /production behind PinGate via shell route"
```

---

## Task 28: Job-creation edge function (proposal handler hook)

**Files:**
- Create: `api/proposal/create-job.ts`

- [ ] **Step 1: Implement the edge function**

```ts
// api/proposal/create-job.ts
// Vercel edge function — called by the proposal sign+pay flow after the
// deposit clears. Creates the job row in Supabase, appends the activity log,
// then moves the GHL opportunity to the Job Created stage.
//
// Required env (server-only):
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   GHL_API_KEY
//   GHL_LOCATION_ID
//   GHL_FENCE_PRODUCTION_PIPELINE_ID
//   GHL_STAGE_JOB_CREATED

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL ?? '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const GHL_API_KEY = process.env.GHL_API_KEY ?? '';
const GHL_STAGE_JOB_CREATED = process.env.GHL_STAGE_JOB_CREATED ?? '';
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

export default async function handler(req: Request) {
  if (req.method !== 'POST') return json({ error: 'POST only' }, { status: 405 });
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return json({ error: 'Server misconfigured: Supabase env missing' }, { status: 500 });

  let body: RequestBody;
  try { body = await req.json(); }
  catch { return json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (!body.contact_id) return json({ error: 'contact_id required' }, { status: 400 });

  // 1) Insert job (mutation ordering step 1).
  const jobRes = await sb('jobs', {
    method: 'POST',
    body: JSON.stringify({
      contact_id: body.contact_id,
      proposal_id: body.proposal_opportunity_id,
      stage: 'job_created',
      status: 'active',
      deposit_status: 'paid',
      deposit_paid_at: new Date().toISOString(),
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
      type: 'job_created',
      actor: 'system',
      source: 'system',
      payload: { proposal_opportunity_id: body.proposal_opportunity_id ?? null },
    }),
  });

  // 3) Mirror to GHL (step 3, fail-soft).
  if (body.proposal_opportunity_id && GHL_API_KEY && GHL_STAGE_JOB_CREATED) {
    try {
      await fetch(`${GHL_BASE}/opportunities/${body.proposal_opportunity_id}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${GHL_API_KEY}`,
          'Content-Type': 'application/json',
          Version: GHL_VERSION,
        },
        body: JSON.stringify({ pipelineStageId: GHL_STAGE_JOB_CREATED }),
      });
    } catch (err) {
      // swallowed — Supabase row is authoritative
      console.error('[create-job] GHL stage move failed:', err);
    }
  }

  return json({ job_id: job.job_id, job_number: job.job_number }, { status: 201 });
}
```

- [ ] **Step 2: Commit**

```bash
git add api/proposal/create-job.ts
git commit -m "feat(api): create-job edge function with strict mutation ordering"
```

---

## Task 29: Wire SignPayView to call create-job after deposit

**Files:**
- Modify: `src/components/consult/SignPayView.tsx`

- [ ] **Step 1: Read the current SignPayView**

Open `src/components/consult/SignPayView.tsx` and identify the success path of the Stripe deposit charge — the code branch that runs once the payment intent confirms successfully.

- [ ] **Step 2: Add the create-job POST**

Inside that success branch, immediately after the existing post-payment side-effects, add:

```ts
try {
  const resp = await fetch('/api/proposal/create-job', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contact_id: contactId,
      proposal_opportunity_id: opportunityId ?? null,
      fence_spec: fenceSpecForCreate, // shape: { fence_lines, gates, addons, total_sections, total_lf, proposal_total }
    }),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    console.error('[SignPayView] create-job failed:', resp.status, t);
  } else {
    const created = await resp.json();
    console.log('[SignPayView] job created:', created.job_number);
  }
} catch (err) {
  console.error('[SignPayView] create-job network failure:', err);
}
```

If the existing code does not already expose `contactId`, `opportunityId`, or a `fenceSpecForCreate` object, derive them from the form state already available in the component. Do not change any other side-effect of the deposit flow.

- [ ] **Step 3: Verify TypeScript**

Run: `bunx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/consult/SignPayView.tsx
git commit -m "feat(consult): call /api/proposal/create-job after deposit clears"
```

---

## Task 30: Manual smoke test (no code)

This task is a verification checklist, not a code change. Do not commit anything here.

- [ ] **Step 1: Confirm Supabase bucket**

In Supabase dashboard → Storage, confirm the `job-photos` bucket exists. If not, create it (private, authenticated uploads only).

- [ ] **Step 2: Confirm env vars**

Run `vercel env pull .env.local` and verify these are present:
- `VITE_GHL_FENCE_PRODUCTION_PIPELINE_ID`
- `VITE_GHL_STAGE_JOB_CREATED`
- `VITE_GHL_STAGE_SCHEDULED`
- `VITE_GHL_STAGE_IN_INSTALL`
- `VITE_GHL_STAGE_JOB_COMPLETE`
- `VITE_GHL_TODD_PHONE` (E.164, e.g. `+18168256198`)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GHL_API_KEY`, `GHL_LOCATION_ID`, `GHL_FENCE_PRODUCTION_PIPELINE_ID`, `GHL_STAGE_JOB_CREATED` (server-side, no `VITE_` prefix)

- [ ] **Step 3: Start dev server**

Run: `bun run dev`
Open: `http://localhost:5173/production`

- [ ] **Step 4: PIN gate**

Verify gate appears. Try `0000` → fails with shake. Try `1122` → unlocks (actor=todd). Refresh → still unlocked (session persists). Open in a new private window, enter `8633` → unlocks (actor=ty).

- [ ] **Step 5: End-to-end job lifecycle**

In one private window (Todd, office): open dashboard, confirm empty list or existing jobs render.

Manually invoke create-job to seed a test job:

```bash
curl -X POST http://localhost:5173/api/proposal/create-job \
  -H "Content-Type: application/json" \
  -d '{"contact_id":"<real-contact-id>","proposal_opportunity_id":null}'
```

Confirm: response includes `job_id` and `job_number`. Dashboard shows the new job within 2 seconds (realtime channel). Supabase `job_activity_log` has a `job_created` row.

- [ ] **Step 6: Field checklist**

Click the job → field view loads with all 5 sections and 30 items. Check off "Job details reviewed with crew" → row updates → activity log appended → localStorage shows entry under `abrams_job_<id>_checklist`. Refresh → state persists.

- [ ] **Step 7: Photo upload**

In Loadout section → tap "Upload photo" → pick any image. Confirm: row appears in Supabase `job_photos` with phase=`loadout`. GHL contact media has the same file within 30 seconds.

- [ ] **Step 8: Flag high-severity issue**

Top-right `🚩 Flag Issue` → type `sprinkler_hit`, severity `high`, attach photo, note "test" → submit. Confirm: row in `job_issues` with severity=high. Todd's phone receives SMS within 1 minute.

- [ ] **Step 9: Block job + verify rate limit**

Tap Block Job → reason `weather`, note `test`. Confirm `jobs.status='blocked'`, `blocked_at` set. SMS does NOT fire yet (under 3-day threshold). Backdate `blocked_at` in Supabase to 4 days ago. Reload field view. Confirm SMS fires once. Reload again immediately. Confirm SMS does NOT re-fire (48h throttle, `last_blocked_notification_at` now set).

- [ ] **Step 10: Complete the job**

Check or skip all remaining items. `Mark Job Complete` button enables. Tap → confirm modal → confirm. `jobs.stage='job_complete'`, `last_activity_at` updates. GHL opportunity moves to Job Complete stage.

If any step fails, fix it in a new task before declaring the module shippable.

---

## Self-Review Notes

The plan was reviewed against the spec on completion. Spec coverage:
- **3.1 (job creation)** → Task 28 + Task 29
- **3.2 (actor/PIN)** → Tasks 6, 18, 27
- **3.3 (env vars)** → Tasks 3, 30
- **3.4 (photos)** → Tasks 15, 22, 26
- **3.5 (SMS)** → Tasks 9, 10, 13, 23 (high-severity), 30 (rate-limit verification)
- **3.6 (issue section)** → Tasks 2 (migration), 16 (hook), 23 (modal)
- **Schema additions (section 4)** → Task 2
- **Routes (section 5)** → Task 27
- **Stages/status (section 6)** → Tasks 4, 13
- **Offline tolerance (section 7)** → Tasks 14, 15
- **Checklist sections (section 8)** → Task 8
- **Issue types/auto-rules (section 9)** → Task 16
- **GHL sync map (section 10)** → Tasks 10, 13, 16
- **Office dashboard (section 11)** → Tasks 20, 25
- **Field view (section 12)** → Tasks 24, 26
- **Build order (section 13)** → Mapped 1:1 to Tasks 1–30

Known acceptable gaps:
- Customer name / address are sourced from GHL on display; the field view currently renders placeholders. A future task can fetch contact data via `crmApi.getContact` and cache it in component state. Not blocking V1 because dashboard shows job number / install date, which is enough to identify a job.
- The proposal-side `fence_spec` payload assumes the existing `SignPayView` already knows the line items in the shape required. Task 29 explicitly leaves the derivation to the implementer because we don't have a contract for the existing form state in this plan.

---

*Abrams Fence — `/production` implementation plan v1.0 — 2026-05-21*

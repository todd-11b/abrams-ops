# Abrams Fence — `/production` Module Design

**Status:** Approved design, ready for implementation plan
**Date:** 2026-05-21
**Repo:** `abrams-ops`
**Module:** Production (third module after `/consult` and `/proposal`)

---

## 1. Purpose

Internal operations module for tracking fence installation jobs from deposit confirmation through final payment. Two consumers:

- **Todd (office):** Desktop dashboard view of all active jobs, sorted by install date. Sees deposit status, scheduling gaps, blocked jobs, high-severity issues.
- **Ty (field):** Mobile-first per-job view with five-section checklist, photo capture, issue flagging.

Both views read/write the same Supabase tables. View is selectable via a toggle (default keyed off screen width).

---

## 2. Non-Negotiable Architecture Rules

Every operational mutation follows this order, no exceptions:

```
1. Update Supabase first
2. Append to job_activity_log second
3. Optionally mirror to GHL third
```

**GHL sync failure NEVER rolls back Supabase state.** Failed GHL syncs log silently and queue for retry. Field crew is never blocked by GHL outages.

### Engineering Guardrails

- No direct GHL reads for production state
- No operational state stored only in localStorage (localStorage is autosave cache, not source of truth)
- No UI-only checklist state — all state persists to Supabase
- No deletion of `job_issues` or `job_activity_log` records — ever (RLS enforces, app layer enforces too)
- No drag/drop kanban
- No additional production stages without spec update
- No second datastore
- No GHL writing back to app state
- No direct component-level Supabase writes — components call hooks/services only
- No utility-level or ad-hoc Supabase mutation calls

### Mutation Layer

```
UI Component
  → hook or service function only
    → Supabase write
    → job_activity_log append
    → GHL sync (optional, per event)
```

---

## 3. Resolved Design Decisions

These six decisions were made in brainstorming on 2026-05-21 and supersede any ambiguity in the original kickoff prompt.

### 3.1 Job Creation Trigger (Q1 → Option B)

Job records are created inside the existing proposal handler at `api/proposal/[contactId].ts`. When the customer signs and pays the deposit, the same handler that processes the deposit also creates the job, following mutation ordering:

```
1. INSERT into jobs + job_fence_specs (Supabase)
2. INSERT into job_activity_log (type: job_created)
3. Move GHL opportunity to Fence Production → Job Created stage
```

If step 1 fails, do not proceed. Do not create a GHL job-created event without a backing Supabase row.

### 3.2 Actor / Auth Model (Q2 → Option B)

PIN gate reuses the `/consult` pattern but with **distinct PINs per user**, scoped to the `/production` module only:

- Todd PIN: `1122`
- Ty PIN: `8633`

The existing `/consult` PIN is untouched — that's a separate gate for a separate system. PIN identity drives the `actor` field directly:

- PIN `1122` matched → `actor = 'todd'`
- PIN `8633` matched → `actor = 'ty'`

PIN is captured at gate entry and persisted to localStorage (`abrams_production_actor`) for the session. View toggle is independent of actor — Todd can open field view on his phone and his actions still log as `todd`.

### 3.3 GHL Pipeline + Stage ID Mapping (Q3 → Option A)

Pipeline and stage IDs live in environment variables. **Five vars total:**

```
VITE_GHL_FENCE_PRODUCTION_PIPELINE_ID
VITE_GHL_STAGE_JOB_CREATED
VITE_GHL_STAGE_SCHEDULED
VITE_GHL_STAGE_IN_INSTALL
VITE_GHL_STAGE_JOB_COMPLETE
```

`final_payment` is an internal-only stage with no GHL pipeline mirror (payment is handled by invoice/workflow logic outside the production pipeline).

**Boot-time validation:** App throws a loud error at startup if any of these vars is missing. Silent undefined → GHL sync fails on a job site with no explanation, which is unacceptable.

**Pulling the IDs (one-time, before deploy):**

```bash
curl -H "Authorization: Bearer $VITE_GHL_API_KEY" \
     -H "Version: 2021-07-28" \
     "https://services.leadconnectorhq.com/opportunities/pipelines?locationId=$VITE_GHL_LOCATION_ID"
```

Response includes all pipelines with stages array; copy IDs into Vercel env vars.

### 3.4 Photo Storage (Q4 → C for install photos, A for issue photos)

**Bucket:** `job-photos` (Supabase Storage)

**Path convention:**

```
{jobId}/{phase}/{timestamp}_{photoId}.jpg
phases: loadout | onsite | install | clean | issue
```

Phase keys match checklist section keys (see section 8). The `walkthrough` section uses a gate video, not a photo, so it has no phase here. The `issue` phase is for issue-flag photos only.

**Behavior by phase:**

- `loadout` / `onsite` / `install` / `clean` → upload to Supabase Storage primary, async mirror to GHL contact media on success. Mirror failure follows mutation ordering: log, retry, do not roll back.
- `issue` → Supabase Storage only. No GHL mirror. Internal audit records.

**Manual pre-deploy step:** the `job-photos` bucket must be created in the Supabase dashboard before the first photo upload. Flag this in the build order.

### 3.5 Internal Notifications (Q5 → Option C)

Direct SMS via GHL conversation API to Todd's mobile number. No GHL workflow middleman, no Twilio.

**Env var:**

```
VITE_GHL_TODD_PHONE=+18168256198
```

**Triggers:**

- Job blocked 3+ days → SMS
- High-severity issue flagged → SMS
- Won customer unscheduled 7 days → already handled by GHL workflow B3, do NOT fire from this module

**Message format (locked):**

```
🚨 ABRAMS ALERT
Job: {jobNumber} — {customerName}
Reason: {blockedReason or issueType}
Address: {address}
Open: abramsfence.com/production/job/{jobId}
```

**Rate-limit:** first SMS fires on day 3 of block. Subsequent SMSs throttled to every 48 hours until block clears. Requires persistent state — see schema additions below.

### 3.6 Issue Context (Q6 → Option B)

Issues carry phase context, captured automatically.

**Schema addition:**

```sql
ALTER TABLE job_issues ADD COLUMN section text;
-- nullable: loadout | onsite | install | clean | walkthrough | null
```

**Capture logic:**

- Flagged from inside a checklist section → auto-populate `section` with the current section key
- Flagged from persistent top-right button → `section = null`
- No UI picker. Fully automatic. Ty never touches this field.

---

## 4. Additional Schema Changes Required

Beyond what's already in `20260520000000_initial_schema.sql`, this module needs:

```sql
-- Issue context (Q6)
ALTER TABLE job_issues ADD COLUMN section text;

-- Block-notification rate-limit state (Q5)
ALTER TABLE jobs ADD COLUMN last_blocked_notification_at timestamptz;
```

A new migration file: `20260521000000_production_module_additions.sql`

---

## 5. Routes

```
/production                    → ProductionDashboard (office, Todd)
/production/job/:jobId         → ProductionJob (field, Ty)
```

PIN gate wraps both. View toggle (`abrams_production_view` in localStorage) selects layout independently of route, except `/production/job/:jobId` is always mobile-first.

**View toggle:**

- Default: office on desktop (>768px width), field on mobile
- Toggle UI: `[ 🖥 Office ] [ 📱 Field ]` always visible
- Driver of `actor` field in V1 (see 3.2)

---

## 6. Job Stages and Status

**Stages** (linear progression):

```
job_created → hoa_811 → materials_ordered → scheduled → in_install → job_complete → final_payment
```

**Status** (independent dimension):

```
active | blocked | needs_office_review | complete
```

A job can be `in_install` + `blocked` simultaneously (e.g., weather pause mid-install).

---

## 7. Offline Tolerance

- Checklist state autosaves to localStorage on every tap
- localStorage keys:
  - `abrams_job_{jobId}_checklist` — checklist state
  - `abrams_job_{jobId}_photos_queue` — pending photo uploads
- Photo uploads queue and retry silently (max 3 retries, 30s interval)
- Failed uploads show `⚠️ Upload pending` — do not block checklist progress
- App never loses state on reload

---

## 8. Checklist Sections

Five sections, in order. Section keys: `loadout | onsite | install | clean | walkthrough`. Items marked *(skippable)* require a skip reason if not checked.

### Morning Loadout (section: `loadout`)
Photo required: loaded truck

- Job details reviewed with crew
- CC video watched
- 811 confirmed valid
- Materials verified and loaded
- Vehicle checks complete
- Specialty tools loaded
- Fuel card confirmed
- Everyone clocked in

### On Site (section: `onsite`)
Photo required: before photo, full yard

- Customer notified of arrival
- Site walk completed
- Ends, corners, gates, utilities verified
- Sprinkler locations confirmed *(skippable)*
- Tarps and yard protection set
- Layout method identified
- Key posts located

### Install (section: `install`)
Photo required: mid-install progress

- Phase 1 complete — holes dug / posts driven, key posts set
- Phase 2 complete — posts set, gate posts set, dirt work done
- Phase 3 complete — rails attached, balancing done
- Phase 4 complete — pickets/panels installed
- Phase 5 complete — gates hung, ins and outs done *(skippable — no gates)*

### Clean Site (section: `clean`)
Photo required: after photo, full yard

- Magnet sweep — full perimeter
- All debris and scrap removed
- Disturbed soil raked and leveled
- Hard surfaces blown off
- Staging area cleared
- Sprinkler inspection — no damage confirmed *(skippable)*

### Final Walkthrough (section: `walkthrough`)
No additional photo (gate video serves)

- Post plumb verified
- Straight line confirmed
- All gate hardware tight *(skippable — no gates)*
- Gates swing and latch correctly *(skippable — no gates)*
- Gate video recorded *(skippable — no gates)*
- Final walkthrough completed with customer *(skippable — customer unavailable, note required)*

**Soft enforcement:** sections do not hard-lock each other. All items required (checked or skipped-with-reason) before `Mark Job Complete` activates.

---

## 9. Issue Types and Auto-Rules

```
sprinkler_hit | material_shortage | weather_delay | customer_concern |
gate_issue | grade_issue | utility_conflict | other
```

Auto-rules:

- `customer_concern` → severity minimum `medium`, `customer_visible = true`
- `sprinkler_hit` or `utility_conflict` → photo required
- `high` severity → instant SMS to Todd via mechanism in 3.5

Issue records are never deleted (RLS blocks deletes). Updates are allowed only to set resolution fields (`resolved`, `resolved_at`, `resolution_note`) — never to overwrite the original `type`, `severity`, `note`, `photos`, or `section`. Application layer enforces this scope.

---

## 10. GHL Sync Map (One-Way, App → GHL)

| App Event | GHL Action |
|---|---|
| Deposit confirmed → job created | Move opportunity → Fence Production / Job Created |
| Stage → `scheduled` | Move opportunity → Fence Production / Scheduled |
| Stage → `in_install` | Move opportunity → Fence Production / In Install |
| Mark Job Complete | Move opportunity → Fence Production / Job Complete + trigger review workflow |
| Status → `blocked` (3+ days) | Direct SMS to Todd (see 3.5) |
| Issue flagged `high` severity | Direct SMS to Todd (see 3.5) |

All sync failures: log, queue for retry, do not roll back Supabase.

---

## 11. Office Dashboard Layout

- List view (not kanban), sorted by install date ascending
- Blocked jobs pinned to top, pulsing amber border, days-blocked prominent
- Each job card shows: customer name, job number, address, fence type, sections, LF, install date, scheduled start window, deposit status, stage, status badge, last activity
- Overdue flags:
  - Deposit unpaid 3+ days → flag
  - Unscheduled 5+ days after job created → flag
  - Blocked 3+ days → flag + SMS (see 3.5)

---

## 12. Field View Layout

- Mobile-first, single column
- Sticky job header: customer name, address, maps link, fence type, sections, install date, access notes (dogs, sprinklers), proposal link
- `🚩 Flag Issue` button — persistent top-right, always one tap away
- Five checklist sections, expandable cards
- Photo upload at bottom of each section requiring one
- `Mark Job Complete` button — activates only when all sections complete or skipped with reason

---

## 13. Build Order

1. **Schema additions** — new migration `20260521000000_production_module_additions.sql` adds `job_issues.section` and `jobs.last_blocked_notification_at`
2. **Supabase Storage bucket** — create `job-photos` bucket manually in dashboard (pre-deploy step, flag in plan)
3. **Env vars** — add 6 new vars (5 GHL pipeline/stage IDs + Todd phone) to `.env.local` and Vercel
4. `src/types/production.ts` — all interfaces (Job, JobFenceSpec, ChecklistItem, JobPhoto, JobIssue, ActivityLogEntry, plus enums)
5. `src/lib/supabase.ts` — already exists, verify client export
6. `src/lib/crm-api.ts` — extend with `moveOpportunityToStage(opportunityId, stageId)` and `sendSms(toNumber, body)` helpers
7. `src/lib/env.ts` (new) — boot-time validation of required env vars, throws on missing
8. `src/utils/ghlSync.ts` — production milestone sync functions (one per sync map row)
9. `src/utils/jobNumber.ts` — formatting utility (display only — generation is DB trigger)
10. `src/utils/actor.ts` (new) — resolves actor from view toggle
11. `src/hooks/useJob.ts` + `useJobs.ts` — Supabase reads
12. `src/hooks/useActivityLog.ts` — append-only write (used by every mutation hook)
13. `src/hooks/useChecklist.ts` — localStorage autosave + Supabase sync
14. `src/hooks/usePhotoQueue.ts` — Supabase Storage upload queue + GHL mirror + retry
15. `src/hooks/useIssue.ts` — create/resolve issue, auto-rules from 3.6 and section 9
16. `src/hooks/useNotifications.ts` — block-rate-limit logic + SMS dispatch
17. `src/components/production/PinGate.tsx` — adapted from /consult, reuses PIN 8633
18. `src/components/production/ViewToggle.tsx` — office/field switcher, persists to localStorage
19. `src/components/production/JobCard.tsx`
20. `src/components/production/StatusBadge.tsx` + `StagePill.tsx`
21. `src/components/production/ChecklistSection.tsx` + `ChecklistItem.tsx`
22. `src/components/production/PhotoUpload.tsx`
23. `src/components/production/FlagIssueModal.tsx` (auto-captures section)
24. `src/components/production/BlockedModal.tsx` + `CompleteConfirmModal.tsx`
25. `src/components/production/JobHeader.tsx`
26. `src/pages/production/ProductionDashboard.tsx` — replace stub
27. `src/pages/production/ProductionJob.tsx` — replace stub
28. **Wire job creation into proposal handler** — modify `api/proposal/[contactId].ts` to follow mutation ordering from 3.1
29. **End-to-end test** — deposit confirmed → Supabase job row → activity_log entry → GHL opportunity moved → dashboard renders → field checklist completes → photos persist → Mark Job Complete → GHL opportunity moved to Job Complete

---

## 14. Open Items (Defer to Future)

These were identified during brainstorming but explicitly out of scope for V1:

- Supabase Auth migration (deferred — RLS stays permissive until then)
- Per-checklist-item issue linkage (V1 captures section only)
- GHL stage mirror for `final_payment` (V1 leaves it as internal-only)
- **Photo upload persistent queue (post-V1).** `usePhotoQueue` writes failed uploads to localStorage as JSON, which collapses `File` objects to `{}` and is non-replayable on reload. The 3-retry-in-session loop covers transient real-world failures and is the canonical mechanism per spec section 7. The persistent fallback is dead code by intent — IndexedDB-based queueing is V2 work. Decision confirmed 2026-05-21.
- **SMS customer name + address placeholders (post-V1).** Block and high-severity issue SMS messages send `Job: {jobNumber} — (see GHL)` and `Address: (see GHL)` rather than fetching from the GHL contact. Todd has the job number and a direct link to `/production/job/{jobId}` in the SMS, which is sufficient to triage. Real-name hydration is V2. Decision confirmed 2026-05-21.

---

*Abrams Fence — `/production` module design v1.0 — 2026-05-21*

# Abrams Ops Source-Only Containment Design

Version: 1.8
Date: 2026-08-02
Status: source implementation in progress; Todd selected PIN now plus GHL identity later

## Authorized objective

Replace the current screen-only PIN and public browser data access with a server-enforced operator boundary; replace contact-ID proposal links with expiring, single-purpose tokens; make proposal signing idempotent; and remove privileged GHL/Supabase operations from the browser. This document changes no live system.

## Evidence and precedent

- Canonical Abrams base: `2cbe6f634fa0b19b216a2fced7856511ae376458`.
- `src/App.tsx` and `src/utils/actor.ts` enforce the production PIN only in browser/session storage.
- `src/lib/supabase.ts` gives the browser an anon Supabase client; production hooks read and mutate operational tables and storage directly.
- `src/lib/crm-api.ts` reads a `VITE_GHL_API_KEY` and calls GHL from the browser.
- `api/proposal/[contactId].ts` treats a contact ID as proposal access authority.
- `api/proposal/create-job.ts` is unauthenticated and lacks a uniqueness/idempotency boundary.
- BarleyBus `click-maker-hub/src/pages/AdminGlanceEmbed.tsx` deliberately accepts a shared `?token=` on an unguarded route because the GHL widget has no application session.
- BarleyBus `barleybus-tourops/supabase/functions/glance-embed/index.ts` checks that shared token server-side. This protects a bounded embed function but does not identify the human operator.
- BarleyBus `click-maker-hub/ghl-custom-js/workspace-nav-bridge.js` validates message origins for navigation only. It does not authenticate the iframe or transfer a GHL identity.

Therefore the available precedent is not an authenticated, write-capable operator session and cannot safely be copied for Abrams mutations.

## Threat model

### Assets

- Customer identity, contact, address, proposal, job, issue, activity, checklist, and photo data.
- Job lifecycle and production status.
- GHL contact, opportunity, note, tag, media, and message capabilities.
- Proposal-signing and job-creation authority.

### Trust boundaries

1. The top-level GHL page is outside Abrams application control.
2. The Abrams iframe/browser is untrusted until a server verifies a credential.
3. Query parameters, `postMessage`, referrer/origin headers, local storage, and session storage are presentation/transport signals, not identity by themselves.
4. Vercel server functions may hold service-role and GHL credentials.
5. Supabase must deny direct browser access after the server boundary is available.
6. Customer proposal tokens authorize one proposal and its signing action only; they never authorize operator APIs.

### Attacks to prevent

- Direct navigation to operator routes without authentication.
- Reuse of iframe URLs or copied query tokens as general operator credentials.
- Cross-origin message injection or token exfiltration.
- Browser extraction of GHL private credentials.
- Direct anon reads/writes to operational tables or storage.
- Proposal token tampering, expiry bypass, cross-proposal use, replay, and duplicate/racing job creation.
- Partial job creation reported as success when required spec/activity writes fail.

## Operator identity decision

Todd selected both entry modes, sequenced: server-validated Abrams PIN for standalone/mobile and iframe use now, with GHL identity/OAuth later. Both providers must produce the same internal claims and authorization path; GHL OAuth is not simulated before its real contract exists.

### A. GHL app identity/OAuth handoff (recommended for the intended embedded product)

The GHL app installation launches Abrams with a short-lived, signed authorization code or platform token. The Abrams server validates/exchanges it, binds location and operator claims, and issues its own short-lived session. Direct navigation requires a normal Abrams login or is denied. This is the durable fit if Abrams will be a real GHL marketplace/private app, but it requires the exact GHL installation/identity mechanism and verified token claims.

### B. Abrams server login inside the iframe (narrow build-time fallback)

Move the existing Todd/Ty PIN check to a server endpoint and exchange a correct PIN for a short-lived signed bearer session. The PINs become server-only environment values. This works in an iframe without third-party cookies when the bearer token is kept in iframe `sessionStorage` and sent in the `Authorization` header. It identifies only the shared PIN holder, not a GHL user. It is simpler but is a separate Abrams login and should not be presented as GHL SSO.

The provider seam permits A to replace or coexist with B without duplicating protected APIs. Neither path may treat iframe presence, origin, a static widget token, or a GHL URL as user identity.

## Target design after the decision

### Operator session

- Exchange the chosen credential at a server endpoint.
- Issue a signed, audience-bound token containing actor/subject, location, issued-at, expiry, and a random session ID.
- Default expiry: 8 hours for the build-time PIN option; use the GHL token lifetime for OAuth and cap the Abrams session at 8 hours.
- Store only the short-lived bearer token in iframe `sessionStorage`; never put it in the URL.
- Send it as `Authorization: Bearer ...` to every `/api/operator/*` request.
- Logout deletes the browser token. Server-side revocation/versioning must support emergency invalidation; expiry remains mandatory.
- Reject missing, expired, malformed, wrong-audience, wrong-location, and invalid-signature tokens with `401`; reject authenticated but unauthorized actions with `403`.
- PIN attempts are atomically tracked in durable Supabase state by a peppered hash of Vercel's `x-vercel-forwarded-for` client address plus user-agent. [Vercel's request-header contract](https://vercel.com/docs/headers/request-headers) documents `x-vercel-forwarded-for` as identical to its platform-set client address while remaining stable when `x-forwarded-for` is overwritten by an upstream proxy; missing, comma-delimited, or malformed values fail closed. Five failures within 15 minutes lock that key for 15 minutes; a valid credential does not bypass an active lock. Responses remain the same generic `invalid credentials` shape. `OPERATOR_RATE_LIMIT_PEPPER` is a server-only secret of at least 32 characters. Shared NATs deliberately share a limiter key when user-agent also matches, so one abusive device may temporarily deny peers behind the same NAT; automatic 15-minute recovery bounds that tradeoff. Each limiter call deletes unlocked rows whose `updated_at` is older than 24 hours; no raw address, PIN, or user-agent is stored.
- The Vercel server uses `SUPABASE_SERVICE_ROLE_KEY`, which Supabase documents as the server-side key for the Postgres `service_role`. [Supabase's API security guide](https://supabase.com/docs/guides/api/securing-your-api) states that Data API function access is controlled by explicit grants, and [its roles guide](https://supabase.com/docs/guides/database/postgres/roles) identifies `service_role` as the elevated Data API role. Both `SECURITY DEFINER` RPCs therefore revoke PUBLIC/anon/authenticated and grant EXECUTE only to `service_role`.
- Direct navigation renders login for option B or denies/redirects to the authorized GHL launch for option A.
- `postMessage` is optional navigation plumbing only. If used, validate an exact allowlist of origins, message schema, nonce, and `event.source`; never accept a reusable auth token through arbitrary parent messages.
- Do not depend on third-party cookies. If cookies are later selected, require `Secure; HttpOnly; SameSite=None`, CSRF protection, and an explicit browser compatibility proof.

### Server-only operator API

- Replace browser Supabase reads/writes and storage operations with purpose-specific `/api/operator/*` functions.
- Each function verifies the operator session before constructing service-role clients.
- Replace browser GHL calls with purpose-specific server functions using `GHL_API_KEY` without a `VITE_` prefix.
- Preserve mutation order: primary Supabase state, required activity log, then GHL mirror. Return a distinct `partial_failure` result if a fail-soft GHL mirror fails; never claim full success.
- Use explicit request schemas and operation allowlists; do not expose a general table or arbitrary GHL proxy.
- Owner and field roles share purpose-specific production and proposal operations. Broad contact enumeration/config reads and arbitrary SMS remain owner-only; field requests receive `403`. Server queries substitute fixed per-resource select lists and reject unlisted columns.
- Realtime subscriptions are removed initially. Poll/refetch after mutations until a server-authorized realtime design exists.

### Database and storage migration

Apply only after the server APIs are deployed and verified against a non-customer fixture:

1. Drop `jobs_all`, `fence_specs_all`, `checklists_all`, `photos_all`, and all other permissive public operational policies.
2. Revoke table privileges from `anon` and `authenticated` for `jobs`, `job_fence_specs`, `job_checklists`, `job_photos`, `job_issues`, and `job_activity_log`.
3. Keep RLS enabled and add no browser-role replacement policies; service-role server functions bypass RLS.
4. Drop public storage SELECT/INSERT policies for `job-photos`; only server functions upload and mint short-lived signed download URLs.
5. Preserve the append-only activity rule inside server code and database grants/triggers appropriate to the service path.
6. Add a unique constraint or unique partial index for the canonical proposal/opportunity identifier after a preflight duplicate report. Existing duplicates require an explicit reconciliation list, not silent deletion.

Rollback order: restore the prior deployment first, then restore the exact prior grants/policies from a versioned down script. Never leave restrictive policies deployed while the only compatible server API is rolled back.

Credential rollback boundary: operator PIN rotation is a one-way containment prerequisite, not an application rollback step. Before any production activation, the owner must separately approve rotation of every currently exposed operator PIN and verify only the replacement values exist in the target environment. A rollback must never restore an exposed PIN. If application rollback is required, retain the rotated credentials and restore only the prior application/policy state.

### Proposal access and signing

- Generate a random 256-bit proposal token server-side. Store only its SHA-256 hash with `contact_id`, proposal/opportunity ID, purpose, expiry, status, and creation metadata.
- Public URL shape: `/proposal/<opaque-token>`; remove contact IDs from public routes and responses.
- Proposal GET hashes the token, requires purpose `proposal_view_sign`, checks expiry, and returns only the proposal-bound payload. It remains viewable until expiry after signing so a safe retry and customer record view still work.
- Signing sends the same token plus an idempotency key derived from the proposal token record. The server locks/claims the token record and performs an upsert protected by database uniqueness.
- Signing is exactly-once, not viewing: the first signing binds `job_id` and `consumed_at`; a duplicate or racing request returns the same job identity and `200`, not a second job. A token used for a different proposal is rejected.
- Required job, fence-spec, and activity rows execute in one database transaction/RPC. If that cannot be added safely, compensate by marking an explicit failed state and returning failure; do not return success after missing required rows.
- GHL non-2xx responses are checked. A completed database transaction with failed GHL effects returns `202 partial_failure` and writes an observable retry item; it does not roll back authoritative Supabase state.

### Existing records and links

- Existing jobs remain untouched.
- Existing contact-ID proposal links are denied after cutover. Before cutover, generate replacement tokens only through an authenticated operator action.
- Do not silently support both old and new public proposal routes; that would preserve the vulnerable boundary.
- Customer retry after an ambiguous signing response must use the same token and return the existing job.

## Authoritative activation and rollback sequence

This sequence governs every Abrams containment document and replaces any older ordering:

1. Deploy/apply only the additive database prerequisites that do not restrict the legacy app. Additive prerequisites alone do not activate the new authentication boundary.
2. Obtain Todd's separate live-change approval, then configure rotated operator credentials and all required server-only secrets before the compatible build becomes active. The compatible deployment must not become active while the historically exposed PINs remain valid.
3. Deploy the compatible server/API/UI build that reads the rotated credentials.
4. Prove login, signing, webhook, and rollback readiness with non-customer fixtures.
5. Apply the restrictive table/storage cutover last, under separate authorization.

Rollback retains the rotated credentials and server-only secrets. Restore the compatible/prior application and the exact paired database/storage policies as required, but never restore an exposed credential. If the restrictive cutover has occurred, restore its paired prior policies before leaving an incompatible application active.

## Source-build sequence

1. Decide A or B and document the credential/claim contract.
2. Build session verification and purpose-specific server APIs with tests while current live behavior remains unchanged.
3. Build opaque proposal-token issuance, retrieval, signing, transaction/idempotency, and legacy-link replacement tooling.
4. Add restrictive migration and exact rollback SQL; do not apply it.
5. Independently review source, migration intent, compatibility, credential scan, and rollback.
6. Integrate Task 8 and revalidate the complete combined head, including full tests/build, containment checks, migration-pair checks, credential scan, and payment-flow regression coverage.
7. For any future activation, follow the authoritative five-step activation and rollback sequence above without reordering it.

## Required tests

- Missing, malformed, expired, tampered, wrong-audience, wrong-location, and logged-out operator sessions.
- Valid iframe bearer flow and valid direct-login flow for the selected option.
- Exact origin/message validation if a GHL parent bridge is used.
- No `VITE_GHL_API_KEY`; no browser Supabase operational client or direct mutations.
- Expired, tampered, wrong-purpose, already-consumed, and cross-proposal customer tokens.
- Duplicate sequential and concurrent signing returns one job/activity outcome.
- Required spec/activity failure does not return success.
- GHL timeout/network/non-2xx becomes observable partial failure.
- Migration static checks prove no unconditional public operational/storage policy and no anon/authenticated grants.
- Existing job reads remain compatible through the operator API; legacy proposal links fail only at the documented cutover.
- Credential scan covers the complete changed/untracked scope and full tracked tree without printing matches; current operator PIN values must have zero source/document matches.
- Before production activation, owner-approved replacement PINs work, formerly exposed PINs fail, and neither current nor replacement values appear in build artifacts or verification output.

## Acceptance matrix

| Entry | Current behavior | Future behavior |
|---|---|---|
| Standalone mobile/direct | Server validates Todd/Ty PIN and issues an 8-hour bearer session in `sessionStorage` | Same protected APIs; provider can be upgraded without changing data paths |
| GHL desktop iframe | Same server PIN flow; no third-party cookie dependency and iframe presence grants nothing | Real GHL install/OAuth handoff exchanges verified identity for the same claims |
| Logout/expiry | Token removed locally; expired/version-invalid tokens rejected by every protected endpoint | Provider logout may additionally revoke its upstream grant |
| Public proposal | Opaque 256-bit, purpose-bound, expiring token; contact-ID URLs denied | Same |

## Closed gates

No commit, push, PR, deployment, environment change, policy/migration application, key rotation, GHL change, customer communication, live E2E, or exploit probe is authorized by this design.

## Combined Task 8 integration evidence contract

- Integration base remains canonical `2cbe6f634fa0b19b216a2fced7856511ae376458`; apply reviewed Task 8 first and containment second, leaving the combined result uncommitted for independent review.
- Preserve Task 8 final-payment payable-state/race handling and GHL non-2xx observability alongside containment's authenticated operator APIs, opaque proposal tokens, exactly-once signing, role enforcement, durable lockout, restricted migrations, and credential-rotation gate.
- The reproducible environment-reference inventory is defined as: extract names from `.env.example` using `sed -nE 's/^([A-Z][A-Z0-9_]+)=.*/\\1/p'`, join them as an alternation, then run `rg -l` over `git ls-files -co --exclude-standard`, sort uniquely, and count records. The reviewed containment tree produced 22 paths under this definition; values are never printed.
- Required combined checks: full tests/build, containment static checks, Task 8 webhook tests, focused lint, full lint comparison, migration/rollback checks, credential-context and environment-reference scans, `git diff --check`, and the deterministic tracked-plus-untracked content digest.
- Activation order is exactly the authoritative five-step sequence above: additive non-restrictive prerequisites; separately approved rotated credentials and server-only secrets before activation; compatible server/API/UI activation; non-customer proof; restrictive database/storage cutover last.

## Task 8 assertion replacement map

The combined suite intentionally removes these 14 names from the Task 8 input. Each row identifies concrete replacement coverage or preserved source behavior.

| Absent Task 8 assertion | Combined replacement or preserved behavior |
|---|---|
| `inserts job with deposit_status=pending_invoice and signed_at set` | `returns the atomic RPC result and mirrors only a newly created job`; the RPC inserts the signed job atomically and the migration/source retains `pending_invoice` plus `signed_at`. |
| `inserts activity log with type=proposal_signed` | The same atomic-RPC test verifies the created result; `create_job_from_proposal_token` inserts the unique `proposal_signed` activity in the transaction. |
| `PUTs GHL opportunity status=won (no pipelineStageId)` | `sends exact won-status and signature-note GHL requests without a signing-time stage move` asserts the exact opportunity path/method, `{ status: 'won' }` body, and absence of `pipelineStageId`. |
| `POSTs the signature note to the GHL contact with proposal display id` | `sends exact won-status and signature-note GHL requests without a signing-time stage move` asserts the exact contact-note path/method/body and proposal display ID. |
| `does NOT move the GHL pipeline stage` | `sends exact won-status and signature-note GHL requests without a signing-time stage move` asserts no stage/pipeline request URL or `pipelineStageId` payload occurs. |
| `returns 502 when the job insert fails` | `does not report success when the transaction fails` covers the atomic RPC failure boundary. |
| `rejects non-POST` | `rejects non-POST with 405 and no database or GHL calls` asserts the method guard and zero downstream calls. |
| `rejects missing contact_id` | Superseded intentionally: public contact IDs are denied. `requires an opaque proposal token` and token legacy-denial coverage enforce the stronger boundary. |
| Owner mapping for the former owner PIN (test name redacted) | Superseded intentionally: current PINs are never embedded or browser-mapped. `returns a provider-neutral operator identity for a valid server PIN` covers server-issued owner identity with synthetic credentials. |
| Field mapping for the former field PIN (test name redacted) | Superseded intentionally by the same provider-neutral server-session test using synthetic field credentials. |
| `returns null for unknown PIN` | `rejects an invalid PIN and issues no token` covers generic server-side denial. |
| `round-trips an actor` | `stores the short-lived server token and actor` covers the protected session round trip. |
| `clearStoredActor removes the value` | `rejects expired storage and supports logout` covers session removal/logout. |
| `ignores junk values in storage` | `rejects expired storage and supports logout` plus operator-auth malformed/tampered-token denial cover invalid stored state. |

## Changelog

- 2026-08-01 — v1.0: recorded the BarleyBus iframe precedent, threat model, two viable identity authorities, target server boundary, proposal-token/idempotency model, rollout, rollback, and required tests. Implementation paused at the explicit identity decision gate.
- 2026-08-01 — v1.1: recorded Todd's sequenced dual-entry decision, standalone/mobile and iframe acceptance matrix, shared provider seam, and prohibition on simulated GHL identity.
- 2026-08-01 — v1.2: added durable PIN lockout, enforced role permissions and fixed query projections, clarified view-until-expiry/sign-exactly-once semantics, repaired operator/public signing token handoff, completed storage rollback, and fixed the deployment sequence with Task 8 integration before any restrictive migration.
- 2026-08-01 — v1.3: bound limiter identity to Vercel's documented trusted header with a server-side pepper and fail-closed parsing, documented shared-NAT/retention behavior, granted both hardened RPCs only to Supabase `service_role`, and corrected cross-token proposal races to return `created=false` on uniqueness conflict.
- 2026-08-01 — v1.4: removed current operator credentials from tests and governing documents, required synthetic test-only fixtures, and made owner-approved PIN rotation a mandatory pre-activation gate that rollback must never undo.
- 2026-08-01 — v1.5: records the source-only Task 8 integration contract, reproducible 22-path environment-reference definition, combined verification suite, and unchanged staged activation order.
- 2026-08-01 — v1.6: makes the five-step activation/rollback sequence authoritative, records the 14-row Task 8 assertion replacement map, and clarifies that additive prerequisites do not activate the new boundary.
- 2026-08-01 — v1.7: replaces five source-only/partial Task 8 ledger claims with executable 405 and exact signing-time GHL request regression tests.
- 2026-08-02 — v1.8: requires both server PINs to be present, distinct, and exactly four ASCII digits; makes invalid configuration fail closed before identity resolution; and requires every eventual PIN rotation to increment `OPERATOR_SESSION_VERSION` or rotate `OPERATOR_SESSION_SECRET` so existing sessions are immediately invalidated.

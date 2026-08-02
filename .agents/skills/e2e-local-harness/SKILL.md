---
name: e2e-local-harness
description: Run the abrams-ops operator/consult/production flow end to end against a local Supabase and an in-process fake GoHighLevel, with zero contact with the live CRM or the production Supabase project.
---

# abrams-ops end-to-end testing harness

This repo is a Vite + React front end plus Vercel **edge** functions under `api/`
(`export default async function handler(req: Request)`), backed by Supabase Postgres
and GoHighLevel (GHL) as the CRM. Nothing in the app can be exercised meaningfully
without both a database and a CRM, so testing needs a local stand-in for each.

Keep throwaway harness files **outside the repo** (e.g. `/home/ubuntu/e2e/`).

## Local Supabase

```bash
supabase init && supabase start      # Docker; containers are named supabase_*_<project dir>
psql via: docker exec -i supabase_db_<dir> psql -U postgres -d postgres
```

Gotchas:

- **Watch for rollback SQL inside `supabase/migrations/`.** An emergency *rollback* script
  (e.g. `*_operator_containment_rollback.sql`) sorts last in a filename-ordered run and drops
  the very objects a PR adds (`proposal_access_tokens`, `create_job_from_proposal_token`,
  `operator_login_limits`, restrictive RLS). It now lives in `supabase/rollback/`; if you ever
  see one back under `migrations/`, apply up to the `*_restrict.sql` migration and stop.
  After applying everything, sanity-check with
  `\df create_job_from_proposal_token`, `\dt proposal_access_tokens`, `\di jobs_proposal_id_unique`
  and `node scripts/check-containment.mjs`.
- **The modern `sb_secret_...` CLI key may not work with the local PostgREST/Storage**
  (`Invalid Compact JWS`). Read the legacy secret from the container and mint your own JWT:
  `docker inspect supabase_rest_<dir>` → `PGRST_JWT_SECRET` (base64url `k` value, usually
  `super-secret-jwt-token-with-at-least-32-characters-long`), then sign
  `{"role":"service_role","iss":"supabase","exp":...}` with HS256 and use that as
  `SUPABASE_SERVICE_ROLE_KEY`. Only ever point this at `127.0.0.1`.

## Harness for the edge functions + fake CRM

A ~150-line Node ESM script is enough:

- `vite.createServer({ server: { middlewareMode: true } })` for the SPA, and a router that
  maps `/api/...` paths to the matching module's default export, converting
  `IncomingMessage → Request` and `Response → ServerResponse`.
- Run it **from the repo root** (`cd <repo> && node /path/harness.mjs`) or Tailwind's
  relative `content` globs resolve to nothing and the UI renders unstyled.
- `ln -s <repo>/node_modules /path/to/harness/node_modules` so ESM outside the repo can
  resolve `vite`.
- Wrap `globalThis.fetch`: serve every URL containing `leadconnectorhq.com` from an
  in-process fake, and **throw** for any other external `http(s)://` host. That throw is the
  guarantee that no test can touch the customer's real CRM.
- Inject `x-vercel-forwarded-for: 127.0.0.1` on inbound requests — the operator login rate
  limiter rejects requests without a client address, so `POST /api/operator/session` 400s
  without it.
- Expose `GET /__harness/state` (recorded CRM requests, contacts, opportunities, notes,
  tags, SMS) and `POST /__harness/config` (`{fail:{"POST /conversations/messages":500},
  offline:true, env:{GHL_API_KEY:null}, seedContact:{...}}`). Failure injection through this
  endpoint is how the 500/502 and "SMS did not send" paths get tested without touching code.

Fake CRM routes needed: `GET/POST /contacts/`, `GET /contacts/search`, `GET/PUT /contacts/:id`,
`POST /contacts/:id/notes`, `POST /contacts/:id/tags`, `GET /opportunities/pipelines`,
`POST /opportunities/`, `PUT /opportunities/:id`, `POST /conversations/messages`,
`POST /medias/upload-file`.

Env the handlers read: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GHL_API_KEY`,
`GHL_LOCATION_ID`, `GHL_TODD_CONTACT_ID`, `GHL_WEBHOOK_SECRET`, `OPERATOR_SESSION_SECRET`
(≥32 chars), `OPERATOR_TODD_PIN`, `OPERATOR_TY_PIN`, `OPERATOR_RATE_LIMIT_PEPPER` (≥32 chars),
plus the `VITE_GHL_*` pipeline/stage ids. See `.env.example` for the full contract.

## Driving the app

- Operator sessions live in **`sessionStorage`** and there is no sign-out UI: to switch from
  the office PIN to the field PIN, open a **new browser tab**.
- Consult flow: pick contact → *Fence Measurements* (linear feet) → *Gates* →
  **Continue to Proposal** (this is the save-to-CRM path) → **Save Proposal** (issues a
  signing token and writes `contact.proposal_link`) → **Present to Customer** (opens the
  in-app signing view). The green footer button changes label with state — read the DOM
  before clicking, don't reuse coordinates blindly.
- The customer page is `/proposal/<token>`; signing calls `POST /api/proposal/create-job`,
  which uses the RPC `create_job_from_proposal_token` and the **frozen** fence spec stored
  with the token. When checking prices, always compare the UI number against
  `job_fence_specs.proposal_total`, not just the confirmation screen — they can disagree
  if the quote was re-priced after the token was issued.
- To get a job onto `/production`, it must be `deposit_status='paid'`: post to the real
  `POST /api/webhooks/ghl-invoice-paid` with header `X-Abrams-Webhook-Secret` and body
  `{"opportunityId": <jobs.proposal_id>, "paymentType":"deposit", ...}` (the key is
  `opportunityId`, not `proposal_id`).
- Owner SMS on a high-severity issue goes through `POST /api/operator/alerts` server-side;
  the field role's token is intentionally denied `ghl:send-message`, so a 403 from
  `/api/operator/ghl {"action":"sendSms"}` with that token is the expected, correct result.
- Photos: `POST /api/operator/photos {"paths":[...]}` mints signed URLs; the storage path
  must match `<job-uuid>/<loadout|onsite|install|clean|issue>/<name>.<ext>`.

## Getting a *customer-facing* signing link, and re-pricing

- Tokens are minted by `issueProposalToken()`, called from **Save Proposal**
  (`handleSendForReview`), **Present to Customer** and (since `d9406d55`)
  **Send to Customer**. It returns the cached token while `tokenKey` (contact, opportunity,
  fence lines, gates, add-ons) is unchanged, so repeated sends of an unchanged quote must
  NOT create a second token row — check that when testing this area. After a re-price the
  green button reads "Send to Customer"; clicking it should mint a new token *and* rewrite
  `contact.proposal_link`.
- Easiest way to read the plaintext token: the CRM `contact.proposal_link` custom field in
  `GET /__harness/state` (the DB only stores `token_hash`). Cross-check the frozen price with
  `select fence_spec->>'total_lf', fence_spec->>'proposal_total' from proposal_access_tokens`.
- Re-price flow to test staleness: save quote → issue link → *Edit Consult* → change linear
  feet → **Continue to Proposal** (re-saves to CRM) → open the old link. Expected today:
  "Proposal unavailable / this proposal link is out of date — ask for a new one" (409), no
  job row, token stays `consumed_at IS NULL`.

## Things that have been broken before — check them

- Error states on the **proposal screen** used to be invisible. `ProposalView` now takes an
  `errorMessage` prop; if a button appears to do nothing, check the network/console before
  assuming a misclick.
- `api/operator/ghl.ts` upstream `fetch` must be inside a try/catch, otherwise a *network*
  failure (as opposed to a non-2xx response) escapes as a 500 instead of 502
  `{"error":"CRM unreachable"}`.
- Prices: always compare the customer UI number with `job_fence_specs.proposal_total`; the
  page can render live CRM pricing while the job is written from the token's frozen spec.
- **Always include an add-on in at least one quote you walk.** A quote with no add-ons exercises
  a much weaker path: the token snapshot's `addons` array is `[]`, so any bug in comparing
  snapshot objects stays invisible. One side of `specMatches` has been through the
  `proposal_access_tokens.fence_spec` **jsonb** column, which does not preserve key order, so a
  naive `JSON.stringify` comparison can 409 a brand-new, never-repriced link for every quote with
  demo/stain/poolLatch enabled. When testing this area, dump the raw snapshot
  (`select jsonb_pretty(fence_spec->'addons') from proposal_access_tokens order by created_at desc limit 1;`)
  and check the stored key order actually differs from the derive-side order
  (`{type, enabled, …}` in `deriveFenceSpec`) — otherwise the test is vacuous.
- A good adversarial staleness case: toggle **staining on with 0 sq ft**. The customer total is
  unchanged, so only the `addons` array differs — a comparison that lost sensitivity would let the
  superseded link through.
- Tokens minted before server-derived pricing have `fence_spec IS NULL`. Simulate one with a direct
  `insert into proposal_access_tokens(...) values (..., NULL, 'todd')` using a `contact_id` the fake
  CRM does not know (otherwise `create-job`'s pre-RPC check short-circuits and the RPC guard is
  never exercised), then POST it at `/api/proposal/create-job`: expect 409 and **no** `jobs` row.

## Fixture drift ("Saved locally, but CRM sync failed")

If **Continue to Proposal** shows "Saved locally, but CRM sync failed" and the log says
`CRM updateOpportunityStatus failed (502)`, it is usually **not** an app bug: a localStorage
draft (`abrams_drafts`) or the CRM contact's `job_line_items_json` still carries an
`opportunityId` from a previous harness run that no longer exists after the fake CRM was
restarted. Clear `localStorage.abrams_drafts` and use a fresh walk-in contact rather than a
recycled one; a stale contact will keep re-writing the dead id back into the CRM record.

## Re-applying migrations from scratch

The CLI project may not live in the repo: check for a `supabase/config.toml` under the harness dir
(e.g. `/home/ubuntu/e2e/db`) — that is the directory `supabase start|db reset` must be run from, and
the containers are then named `supabase_*_db`. `supabase` may not be on `PATH`; the downloaded
binary here is `/home/ubuntu/e2e/supabase`. To verify a migration edit applies cleanly in filename
order:

```bash
cp <repo>/supabase/migrations/*.sql /home/ubuntu/e2e/db/supabase/migrations/
cd /home/ubuntu/e2e/db && /home/ubuntu/e2e/supabase db reset --local   # takes ~1-2 min
```

This wipes all jobs/tokens, which is usually what you want before a fresh run. Afterwards re-check
the containment objects and `node scripts/check-containment.mjs`.

Psql access: there is no `psql` on the box — use
`docker exec supabase_db_db psql -U postgres -c '…'`. Note `job_fence_specs.job_id` joins
`jobs.job_id` (there is no `jobs.id`).

## Devin Secrets Needed

None — everything runs locally with dummy CRM credentials. Never point the harness at the
production Supabase project or at `services.leadconnectorhq.com`.

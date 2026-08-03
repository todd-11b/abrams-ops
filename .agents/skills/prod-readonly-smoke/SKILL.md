---
name: prod-readonly-smoke
description: How to run a safe READ-ONLY smoke test of the abrams-ops operator app against the live Vercel deployment — which pages write to the database just by loading, how to log in and switch roles, and how to tell a rejected PIN apart from a broken rate limiter.
---

# Read-only smoke testing abrams-ops against live production

Use this when asked to verify a deployed revision of the operator app (e.g.
`https://abrams-ops-app.vercel.app`) against real data. For anything involving writes, signing or
CRM mutations, use the `e2e-local-harness` skill instead — never do that against production.

## Pages that WRITE to the database just by loading

This app is not safe to "just click around" in production. Check these before navigating anywhere:

- `src/hooks/useChecklist.ts` — opening `/production/job/:jobId` for a job with **zero**
  `job_checklists` rows INSERTs a seed checklist. Before opening any job, confirm it already has
  checklist rows (`select count(*) from job_checklists where job_id = '…'`). Ask the lead to run the
  query if you have no DB access; do not guess.
- `src/pages/production/ProductionJob.tsx` → `useJob.checkBlockNotification()` — mounting the job
  detail page for a job in status **`blocked`** whose notification window has elapsed sends a **real
  owner SMS** and UPDATEs `jobs.last_blocked_notification_at`. Only open jobs whose status is not
  `blocked`.

So the pre-flight for "open a job read-only" is: pick a job that is (a) already seeded and (b) not
blocked. Everything else on the job page (checkboxes, stage buttons, Flag Issue, photo upload) is a
write — look, don't click.

`/consult` is safe to open: `ConsultApp`'s mount effect only does `fetchContacts` (a CRM read).
Do not click a contact or start a walk-in — later steps in that flow save.

## Logging in and "logging out"

- PIN gate is `src/components/production/PinGate.tsx` (the consult gate re-exports it). On-screen
  keypad only — there is no keyboard handler; you must click the digit buttons. It auto-submits on
  the 4th digit.
- **The layout shifts** when the "Incorrect PIN. Try again." line appears/disappears (keys move
  ~14 px). Re-screenshot between attempts and verify the dot indicator after each click, or you will
  silently enter the wrong digits and burn rate-limit budget.
- **There is no sign-out button.** The session lives in per-tab `sessionStorage` under
  `abrams_operator_session` (`src/utils/actor.ts`). To switch roles, just open a **new tab** — it
  starts logged out.
- Roles (`api/_lib/operator-auth.ts`): owner and field differ **only** by `ghl:send-message`. A field
  user seeing the dashboard, job detail and consult is by design, not a permissions bug.
- **Rate limit: 5 failed attempts from one client locks it for 15 minutes.** Budget your attempts,
  and run any deliberate wrong-PIN test last.
- Never type a PIN where it can be captured: do not open the DevTools **Payload** tab for
  `POST /api/operator/session` while recording, and never put PIN digits in a report or filename.

## Diagnosing a 401 on `POST /api/operator/session`

There are two different 401s and the response headers tell them apart (`api/operator/session.ts`):

| Response | Meaning |
|---|---|
| `401 {"error":"invalid credentials"}` **with `Retry-After: 900`** | `consumeLoginAttempt()` returned false — the rate limiter / its config. **The PIN was never checked.** |
| `401 {"error":"invalid credentials"}` **without** `Retry-After` | The PIN really is wrong. |
| `500 {"error":"operator auth is not configured"}` | `parseOperatorPinConfig()` threw — PIN env vars missing on that deployment. |

If a *correct* PIN comes back with `Retry-After: 900`, do not keep retrying. From
`api/_lib/login-rate-limit.ts:6` the cause is one of:

1. `OPERATOR_RATE_LIMIT_PEPPER` missing or `< 32` chars in the deployed env (Edge functions bake env
   at build time — setting the var without redeploying does nothing);
2. `x-vercel-forwarded-for` absent or multi-valued on the Edge runtime (`@vercel/edge`'s own
   `ipAddress()` reads `x-real-ip`, so this is plausible — a fallback chain
   `x-vercel-forwarded-for` → `x-real-ip` → first hop of `x-forwarded-for` is the fix to ask for);
3. the RPC call failing (grant/schema issues).

Cheap way to separate them without burning attempts: ask whoever has DB access to
`select * from operator_login_limits;`. **Empty table ⇒ the RPC was never reached**, so it is (1) or
(2), and it also rules out a pre-existing lockout for your IP. A fast TTFB (~50 ms) corroborates that
no Supabase round trip happened.

Note `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` being entirely unset produces a **500**, not a 401,
because `serverEnv()` throws.

**Since the `x-real-ip` fallback fix, `Retry-After` no longer discriminates.** `consume_operator_login_attempt`
returns false for invalid credentials by design, so a genuinely wrong PIN also takes the limiter branch
and gets `401 + Retry-After: 900`; the bare-401 line is unreachable. The only clean proof of a healthy
login path is **a correct PIN returning 200**. Root cause of the original outage, for the record:
`x-vercel-forwarded-for` is simply absent on the Edge runtime (`x-real-ip` and `x-forwarded-for` are
present) — assume any header-derived client IP on Edge needs a fallback chain.

## Things that look broken in production but need interpreting

- **Empty production dashboard.** `useJobs` filters `deposit_status = 'paid'` as well as
  `archived_at IS NULL`. If no job has a paid deposit, the dashboard reads "0 active jobs / No active
  jobs yet" with a perfectly healthy `200 {"data":[]}`. Check the request payload in the Network panel
  before calling it a data-loading bug, and reach jobs by direct URL
  (`/production/job/<job_id>`) when the list is empty.
- **Consult customer search silently fails.** `POST /api/operator/ghl {action:'searchContacts'}` can
  return `502 {"error":"CRM request failed","status":400}` (the handler issues
  `GET /contacts/search?...`, which live GoHighLevel rejects). `handleSearch` only does
  `console.error`, so the UI shows no banner and appears to work because it still filters the
  already-loaded recent contacts client-side. **Always watch the Network panel while typing in that
  box** — the visible result list is not evidence that search works. A contact outside the recent list
  is the honest test.
- **Role surfaces are identical.** owner and field differ only by `ghl:send-message` and there is no UI
  gating, so a field user sees Resolve / Flag Issue / Block Job / Upload photo / the whole consult
  entry point. Report it as a scope question, not a rendering bug.

## NEVER click app content just to move focus (this has already caused a production write)

A real incident on this app: to get keyboard focus out of DevTools before `Ctrl+L`, an agent clicked an
apparently blank spot at `(500, 200)` on `/production/job/:jobId`. At that scroll position the Clean Site
checklist item "All debris and scrap removed" was exactly there, and checklist checkboxes write to
`job_checklists` **immediately, with no confirm step and no undo prompt** (plus a `job_activity_log` row).
One focus click = one production mutation.

Rules:
- To reach the address bar, click the **address bar itself** (`~(400, 40)`), or click browser/DevTools
  chrome — never the page body.
- If you must click the page, click the page **header/title area**, and screenshot immediately before the
  click to confirm what is under those coordinates. Layout shifts after data loads.
- Never `left_click_drag`, rubber-band select, or scroll-with-click over a checklist region.
- Assume any list-item row in this app is a live control.

### Reverting an accidental write (only with the owner's explicit approval)

Do it through the UI, not the database — it leaves an honest audit trail. Log in, navigate straight to
the job URL, scroll to the section, screenshot to confirm the item is ticked, click that one checkbox,
then **reload the page** and screenshot again to prove the revert persisted rather than being local state.
Touch nothing else on the page (Block Job / Flag Issue / Resolve / Upload / Mark Job Complete are all
live). Note that the revert itself appends a second activity-log row — that is expected and correct.

## Testing the consult customer search (`/consult`)

- The picker loads page 1 only: `fetchContacts` → `GET /contacts/?locationId=…&limit=20`. Check
  `meta.total` in the response — if it is ≤ 20+1 you may not be able to find a customer that is *not*
  already on screen, and the "search finds someone outside the list" case becomes unprovable directly.
- **Prove the mechanism instead of guessing names.** If `meta.total` varies per query (e.g. `0` for one
  string, `1` for another) and the returned record carries fields the page never loaded, GHL is matching
  server-side — client-side filtering of a loaded list cannot do either. That is the real assertion.
- GHL's `query` matches **token prefixes, not substrings**: `sop` returns `total: 0` while `sophie`
  returns the record. Do not conclude search is broken from a short partial query.
- The client display filter matches **name or phone only**, never email — a contact matched upstream by
  email is added to state but stays hidden. Check the response body, not just the list.
- To prove the failure banner is live code, use **DevTools → Network → Offline** for a single keystroke,
  then restore. It is read-only, the page shell survives, and the banner should clear on the next
  successful search. The resulting console errors are `ERR_INTERNET_DISCONNECTED` — expected.
- Read-only gates: type in the box, never click a contact row, never start a walk-in.

## Smoke-testing after an RLS / grant lockdown migration

The client never talks to Postgres directly: `src/lib/supabase.ts` is a shim shaped like the Supabase
client whose calls post to `/api/operator/data` or `/api/operator/photos`, served with the service-role
key behind operator auth. So dropping RLS policies and revoking `anon`/`authenticated` grants should be
invisible to the UI. To prove it rather than assume it:

- Load the job detail page and check the data-heavy reads specifically — fence spec in the header
  (`… · N sections · NN LF`), the issues section, and the **full checklist item count and checked
  count**. A missed direct-client call shows up as an empty section, not as an exception.
- Watch for `401/403/500` on `/api/operator/*` and for `permission denied for table` / `42501` in the
  console. Clean console + all-200 network + populated sections is the pass.
- Photos: `POST /api/operator/photos` returns signed `…/storage/v1/object/sign/job-photos/…` URLs; check
  those image requests are 200 too, since `storage.objects` policies get dropped as well.
- `job_activity_log` is **insert-only in the client** (`useActivityLog.ts`) — there is no read surface,
  so it cannot be verified without performing a write. Say so rather than implying it was checked.
- Beware a false alarm: `(failed)` rows for `https://…supabase.co/storag...` with a *truncated* URL are
  produced by DOM-capture tooling re-requesting images, not by the app. Confirm with
  `performance.getEntriesByType('resource')` before reporting a storage failure.

## Proving a page load wrote nothing

With Preserve log on, open the DevTools search (magnifier in the Network toolbar) and search `insert`
across recorded requests. Matches only inside the JS bundle (`index-*.js`) mean no request *body*
carried an insert. Combine with "every `/api/*` row is 200" for a clean read-only claim.

## Useful zero-risk probes (GET only, no auth, no writes)

```bash
for p in /api/operator/session /api/operator/session.test /api/operator/data \
         /api/operator/ghl /api/proposal/create-job; do
  printf '%-32s ' "$p"; curl -s -o /dev/null -w '%{http_code}\n' "https://<deployment>$p"
done
# expect: 401, 404 (.vercelignore keeps api/**/*.test.ts from shipping), 401, 401, 405
```

## Devtools setup that works on a 1024x768 screen

Dock DevTools to the **bottom** (⋮ → Dock to bottom), Network tab, filter box `/api/`, tick
**Preserve log**. Careful: after clicking inside DevTools, `Ctrl+L` types into the DevTools filter
box, not the address bar — click the **address bar** directly to escape, never the page (see the stray
click warning above). To read response headers you must drag the splitter
up (`mouse_move` to the splitter, then `left_mouse_down` / `mouse_move` / `left_mouse_up`;
`left_click_drag` does not grab it).

## Devin Secrets Needed

None as env vars. Operator PINs and the production URL are supplied in the task prompt; treat the
PINs as secrets and keep them out of reports, filenames, screenshots and recordings.

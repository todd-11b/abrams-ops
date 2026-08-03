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
box, not the address bar — click the page first. To read response headers you must drag the splitter
up (`mouse_move` to the splitter, then `left_mouse_down` / `mouse_move` / `left_mouse_up`;
`left_click_drag` does not grab it).

## Devin Secrets Needed

None as env vars. Operator PINs and the production URL are supplied in the task prompt; treat the
PINs as secrets and keep them out of reports, filenames, screenshots and recordings.

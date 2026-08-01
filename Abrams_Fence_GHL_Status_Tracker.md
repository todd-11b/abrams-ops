# Abrams Fence GHL Status Tracker

**Version:** 1.3
**Date:** 2026-08-01
**Status:** Active reconciliation record

## Changelog

- **1.3 — 2026-08-01:** Adds executable combined regressions for the POST-only signing boundary and exact no-stage GHL opportunity/note requests.
- **1.2 — 2026-08-01:** Makes the five-step activation sequence authoritative and records the corrected 14-assertion integration comparison.
- **1.1 — 2026-08-01:** Records the uncommitted Task 8 + containment integration packet and combined independent-review gate.
- **1.0 — 2026-08-01:** Replaces the unavailable Session 8 tracker with a repository-local, evidence-bound payment-flow status record.

## Payment-flow status

- Canonical inspected source: `main` at `2cbe6f634fa0b19b216a2fced7856511ae376458`.
- Task 8 final-balance routing is implemented and has been live-exercised, but
  governed completion is pending source correction review and controlled E2E proof.
- Source-correction scope: accept `pending_invoice`, verify zero-row races,
  observe GHL HTTP non-2xx responses, remove Task 8 lint errors, and reconcile
  governing contracts.
- Repository-wide unrelated lint debt remains outside the Task 8 correction.
- Reviewed Task 8 commit `fe46eb349bff0b37bd4666918dcdd88eab530629` and containment commit `1809a48d2c67694c2043c6e8f191dc0e0a2d001e` are now combined in a fresh source-only worktree in that order, relative to canonical parent `2cbe6f634fa0b19b216a2fced7856511ae376458`.
- The combined result remains uncommitted pending independent review; neither preserved input commit has been pushed.
- Authoritative activation order: additive non-restrictive database prerequisites; Todd's separate approval and configuration of rotated credentials/server-only secrets before activation; compatible server/API/UI activation; non-customer login/signing/webhook/rollback proof; restrictive table/storage cutover last. Additive prerequisites alone do not activate the new boundary, and the compatible build must not become active while historically exposed PINs remain valid.
- The corrected input comparison has 14 absent Task 8 test names, all mapped to executable replacement coverage or intentionally superseded contracts in containment design v1.7.

## Closed gates

- No commit, push, pull request, deployment, environment modification, GHL or
  Supabase mutation, or live end-to-end validation is authorized by this update.
- A controlled deposit → signature → final-payment proof still requires explicit
  owner approval and a documented non-customer test identity.

## Governing sources

- `docs/superpowers/specs/2026-05-21-ghl-invoice-flow-design.md` v1.3
- `docs/superpowers/plans/2026-05-21-ghl-invoice-flow.md` v1.3
- `docs/superpowers/specs/2026-05-21-production-module-design.md` v1.3
- `docs/security/2026-08-01-source-only-containment-design-v1.md` v1.7
- Supabase migration `20260522000002_final_payment_state.sql`

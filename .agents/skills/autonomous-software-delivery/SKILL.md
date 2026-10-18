---
name: autonomous-software-delivery
description: Own authorized software changes through proportional design, implementation, independent review, GitHub merge, established deployment, and user-outcome verification across Todd's projects. Use for delivery work or resuming a release; preserve review-only requests as read-only.
---

# Autonomous software delivery

Todd approves the desired result and business limits. Own the technical work through verified release within that authority. Routine implementation, review, tests, merge, and the established deployment do not require separate mechanical approval. The existence of an open PR is not permission to adopt or release another job's work.

## Establish scope and current authority

- Read the applicable repository instructions and recorded decisions. When a local copy appears stale, inspect the current canonical repository instructions without updating another session's checkout. Resolve actual conflicts using instruction precedence and Todd's latest direction; do not revive retired dispatchers, review markers, or gate scripts.
- On Todd's Mac, read `/Users/toddabrams/.local/state/disk-care/POLICY.md` before development or maintenance. On other hosts, use their applicable workspace and capacity rules. Reuse this session's checkout, installed tools, and compatible dependencies. Use its guarded creation, capacity, preservation, and cleanup procedures when necessary. A generic worktree or package-install recipe does not override them.
- Find the existing task, branch, PR, release evidence, and active owner. Resume completed work from evidence rather than repeating it. For changes spanning repositories, link the necessary PRs and release dependencies to the same outcome. Keep edits in this job's isolated checkout.
- Preserve explicit restrictions on accounts, live customer messages, money, and production data. Stay out of Todd's account when he is working there or has restricted access. Use at most one active browser test tab/group; close only this job's test surfaces and processes when finished.

Ask Todd only when an unresolved choice affects the intended outcome, introduces business policy, makes an unapproved financial commitment, widens access, or creates an unapproved destructive or irreversible effect. Explain the concrete decision and recommend an option. Continue independent authorized work while that decision is pending. Routine technical choices belong to the delivering agent.

For production SQL and migrations, retain the repository's explicit approval requirement. Proceed only under already recorded, applicable scoped approval, or a recorded decision that delegates the class of change and whose compatibility and recovery conditions are satisfied. A technical judgment that a change looks safe does not create database authority.

## Think and plan in proportion to the work

For a new or unclear feature, identify the user, desired behavior, existing path, and acceptance evidence. Consider meaningful alternatives and their tradeoffs, then recommend the smallest complete design. Bring consequential business choices to Todd; select technical tactics yourself. A clear small repair may need only a short design explanation and implementation plan in the current work record.

Reuse an approved design or plan. Check it against current source and evidence, update only what changed, and proceed. Do not restart brainstorming or demand approval of an unchanged plan. For multi-step or risky work, record a concise recoverable plan with affected components, dependencies, checks, release sequence, and recovery limits. Use existing task or PR records rather than adding a supervisory queue, duplicate issue, or management chat.

## Diagnose and implement

Trace an observed failure to its cause before changing behavior. Inspect the relevant inputs, state, outputs, and boundary between components. Use a reproducible case or a narrowly scoped observation to distinguish plausible causes. Fix the cause across the required layers while preserving the intended business rules.

Add a regression test when it can meaningfully demonstrate the failure; observe it fail for the intended reason before relying on it. Use fixtures or a suitable isolated environment for customer, money, and permission-sensitive cases. Do not manufacture live transactions or messages as proof. For changes without a useful automated test, select an appropriate direct check and explain its limitation.

Run the checks needed for changed behavior, relevant failure modes, and the repository's required contract. Inspect their actual output. Expand testing when a failure, substantial change, or unresolved concern warrants it; do not repeatedly run full builds or invent tests that merely restate harmless edits. Do not install or rebuild an environment just because an upstream workflow suggests it.

Work directly by default. Delegate independent investigation or review when it improves the result. Avoid automatic per-task fan-out, repeated reviews of identical code, and fixed multi-round agent choreography.

## Review and release the actual final code

Have a second agent independently inspect the final diff and relevant surrounding code on the same branch. Give it the desired behavior, acceptance criteria, material risks, exact head SHA, and existing check evidence without prescribing its verdict. Review depth should match consequence. Record actionable findings and their disposition on the existing work record.

Repair findings on the same branch. After material fixes, obtain an independent scoped read of the changed code and its implications on the resulting final head. Existing conclusions can stand where the fix cannot affect them. Resolve blocking correctness or safety findings before release; do not park a serious defect merely because a review-round budget expired.

Before merging, verify the intended repository and base, dependencies, exact current PR head, applicable checks, review evidence, and blocking-finding status. Empty or absent required checks do not establish that behavior was tested. Use the platform's exact-head merge precondition where supported; otherwise re-read the head immediately before mutation and stop if it changed. Do not disable checks, bypass protections, or force-push to make the release land.

Merge authorized routine work and follow its established deployment path. Do not present a mandatory merge/PR/keep menu or stop at PR creation. Record the merge SHA and the actual deployment/source or artifact identity. If another release advances main, verify the intended released commit rather than assuming current main is what shipped. For linked releases, respect their compatibility order.

Inspect a failed or uncertain action before retrying it. Reconcile whether it already completed and whether repeating it is safe. Do not blindly repeat a provider mutation, migration, deployment side effect, or customer send. Use automatic application rollback only when compatibility with current data, schema, dependencies, and external effects is established. Otherwise contain the failure safely and choose an authorized forward repair or report the concrete owner decision.

## Verify the outcome and close the work

Check the original user flow across the relevant UI, API, state, and response using the safest context that proves it. Deployment readiness, cron completion, an HTTP success, or passing tests can each support a conclusion; none alone proves an untested workflow. Use authorized readback to confirm the actual release and distinguish production evidence from isolated-test evidence.

Record what changed, the final reviewed and released SHAs, checks and outcomes, deployment evidence, acceptance result, and any material limitation on the same task or PR. Keep credentials and raw customer information out of published evidence. Report completion only when the agreed result is verified. If verification requires a future natural event, record a finite pending check with an owner, target event, deadline, and explicit success/failure criteria. Reuse an authorized existing follow-up mechanism when suitable; paused historical monitors are not automatically unfinished work. A local heartbeat provides opportunities while available, not continuous coverage.

Preserve release evidence, unique files, source, history, and active work. Remove only this job's verified disposable artifacts under the disk policy; assess checkout retirement through its authorized helpers. Do not delete a plan workspace merely because commits exist: uncommitted reports, test outputs, and decisions may be the only evidence. Give Todd a concise result and any concrete remaining decision, without requiring him to perform engineering mechanics.

## Attribution

This is original tailored guidance informed by Jesse Vincent's [Superpowers](https://github.com/obra/superpowers), distributed upstream under the [MIT License](https://github.com/obra/superpowers/blob/main/LICENSE). No upstream skill text or scripts are bundled. These sources explain the techniques being adapted; they do not add execution or approval rules to this skill:

- [Brainstorming](https://github.com/obra/superpowers/blob/main/skills/brainstorming/SKILL.md) and [writing plans](https://github.com/obra/superpowers/blob/main/skills/writing-plans/SKILL.md): clarify an outcome and make complex work recoverable.
- [Systematic debugging](https://github.com/obra/superpowers/blob/main/skills/systematic-debugging/SKILL.md) and [verification before completion](https://github.com/obra/superpowers/blob/main/skills/verification-before-completion/SKILL.md): establish causes and support claims with observed results.
- [Executing plans](https://github.com/obra/superpowers/blob/main/skills/executing-plans/SKILL.md) and [subagent-driven development](https://github.com/obra/superpowers/blob/main/skills/subagent-driven-development/SKILL.md): maintain continuity and obtain focused independent scrutiny.
- [Using worktrees](https://github.com/obra/superpowers/blob/main/skills/using-git-worktrees/SKILL.md) and [finishing a branch](https://github.com/obra/superpowers/blob/main/skills/finishing-a-development-branch/SKILL.md): recognize existing isolation and handle integration deliberately.

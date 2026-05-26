# Story 007 — Daemon files new tasks against the host repo from its own observations

**Milestone(s)**: M1.5

> **Why this story exists.** Motivation bullet #2 in [README.md § "Why Minsky?"](../README.md#why-minsky): *"the agent that knows the codebase best is also the one who should be writing tickets"*. The operator-facing promise: the daemon doesn't just consume `TASKS.md` — after every iteration it reviews the diff, the iteration log, and the existing queue, then files new tasks for things it observed (regressions, missing tests, stale docs, footguns). The implementation is `novel/cross-repo-runner/src/host-cto-audit.ts`; this story documents the operator experience and the load-bearing acceptance criteria.

## Story

As a solo developer, I check my host repo's `TASKS.md` in the morning. Three new P1 entries are there that weren't there yesterday — all surfaced by the daemon's CTO audit overnight. Each has the rule-9 fields filled in (Hypothesis / Success / Pivot / Measurement / Anchor); each has a `**Surfaced-by**: daemon CTO audit YYYY-MM-DD` line citing the iteration log line where the issue was observed; none of them duplicate existing tasks. I read the diff for last night's PR, recognise the regression the audit caught (a test that started flaking on iteration #12 of 17), and add a comment thanking the daemon. The daemon also re-sorted `TASKS.md` priorities — a P2 task it observed twice this week was promoted to P1 with a one-line note in the `**Surfaced-by**` field explaining the bump.

## Acceptance criteria

- After each iteration that touches code on the host repo, `runHostCtoAudit` runs (gated on `MINSKY_CTO_AUDIT=on` env, default `on` for the daemon path)
- The audit reads:
  - The iteration's diff (`git diff <base>...<head>` on the worktree)
  - The iteration log entries for the iteration (verdict, duration, stderr tail, signal)
  - The current `TASKS.md` (so duplicates are not re-filed)
- Newly-filed task entries comply with rule-9: every P0/P1 entry has `**Hypothesis**`, `**Success**`, `**Pivot**`, `**Measurement**`, `**Anchor**` on single lines (so `scripts/check-rule-9-tasksmd-fields.mjs` passes)
- Duplicates are skipped via `decideDuplicate` (the same primitive used by `wire-duplicate-pr-detector-into-cross-repo-runner`)
- Re-ranking is conservative: the audit only PROMOTES tasks (P2 → P1, P3 → P2) when the same issue has been observed ≥2 times in the trailing 7 days; it never demotes (operator's priority calls stick)
- Every new task has `**Surfaced-by**: daemon CTO audit <iso-date> — <one-line evidence>` so the operator can audit the audit
- The audit writes via the same git commit as the iteration's PR (one commit per iteration; no out-of-band edits to TASKS.md)

## Metric

- **Name**: `cto_audit_tasks_filed_per_week`
- **Definition**: count of TASKS.md entries (across the fleet) where `**Surfaced-by**` contains `daemon CTO audit` OR `Devin session` OR `claude-code session` over the trailing 7-day window. Stratified by host repo. Vanity-metric guard: a count rising forever signals the audit is overfitting (filing noise as tasks); the sustained-quality metric is the *merge rate* of audit-filed tasks (`cto_audit_filed_tasks_merged_within_30d`), which must stay >40%.
- **Threshold**: ≥3 audit-filed tasks per active host per week (active = ≥10 iterations/week), with ≥40% of those tasks merged or marked `Status: shipped` within 30 days
- **Source**: `Observability` adapter querying TASKS.md `**Surfaced-by**` field on every commit; secondary computation against `gh pr list` for the merge-rate stratifier

## Integration test

- **File**: `user-stories/007-cto-audit-files-new-tasks.test.ts` (new; ships in the same PR as this story)
- **Setup**:
  - Fixture host repo at `test/fixtures/cto-audit/host-repo/` with a synthetic `TASKS.md` (3 existing P1 tasks), a synthetic git history (5 prior iterations recorded in `.minsky/experiment-store/`), and a `src/` tree with one test file containing an intentionally-introduced regression (a flaky `setTimeout`-based test)
  - `runHostCtoAudit` invoked against the fixture with `MINSKY_CTO_AUDIT_MODE=dry-run` (writes proposed task entries to a temp file instead of mutating TASKS.md, so the test can assert without rolling back)
- **Action**: invoke `runHostCtoAudit({ hostRoot: fixture, iterationId: "iter-6" })`
- **Assert**:
  - The dry-run output proposes ≥1 new task entry naming the flaky test by file path
  - The proposed task entry passes `scripts/check-rule-9-tasksmd-fields.mjs` if applied (parse the proposed block; assert all 5 fields present on single lines)
  - The `**Surfaced-by**` field cites the synthetic iteration log line
  - When a duplicate is seeded (another task already exists with the same `**ID**:`), the audit skips it (proposed-output set excludes the duplicate)
  - When the same issue appears for the 2nd time in the synthetic history, the audit proposes a priority bump (P2 → P1) for the existing task

## Proof

- **Live**: the dashboard's "CTO audit" tile shows the per-week task-fill count and the 30-day merge rate for audit-filed tasks
- **Dashboard**: weekly chart of `cto_audit_tasks_filed_per_week` stratified by host
- **Audit**: `git log --grep="daemon CTO audit"` shows every audit run as a commit; the commit body lists the proposed task IDs
- **Notification**: optional weekly digest push (off by default) summarizing audit activity

## Failure modes & chaos verification

Per constitutional rule #7 (`vision.md` § 7).

- **Steady-state hypothesis**: audit runs to completion after every iteration; new tasks land in `TASKS.md` only via valid rule-9 entries; merge rate of audit-filed tasks stays >40% over trailing 30 days.
- **Blast radius**: a single iteration's audit pass. Worst case: the audit proposes a malformed task entry and the task-lint rejects it on the next commit, the operator never sees it, the audit retries next iteration.
- **Operator escape hatch**: set `MINSKY_CTO_AUDIT=off` in `~/.minsky/config.json` to disable entirely; the daemon continues normally.

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | Audit proposes a malformed task (missing rule-9 field) | upstream-malformed (audit logic bug) | `circuit-break-and-notify` — task-lint rejects on next commit | Force-inject a task entry missing `**Measurement**`; assert `scripts/check-rule-9-tasksmd-fields.mjs` rejects on the post-iteration commit; the audit's dry-run validates BEFORE writing |
| 2 | Audit proposes a duplicate (same `**ID**:` as an existing task) | upstream-malformed | `graceful-degrade` — `decideDuplicate` skips | Seed an existing task; run audit on a synthetic iteration that "discovers" the same issue; assert the audit's proposed-set is empty |
| 3 | Audit hangs (LLM call timeout) | dependency upstream-error | `circuit-break-and-notify` — 60s budget cap | Inject a mock LLM client that sleeps 120s; assert the audit aborts at 60s, logs the timeout, does not write any task |
| 4 | Audit-filed task is never picked up (queue is full of higher-priority work) | dependency upstream-error | `graceful-degrade` — task waits its turn | Saturate TASKS.md with P0s; assert audit-filed P2 sits unclaimed, audit doesn't re-file it on next iteration (duplicate detection) |
| 5 | Audit triggered when iteration verdict is `spawn-failed` (no diff to audit) | upstream-error | `graceful-degrade` — skip audit cycle | Iteration ends in spawn-failed; audit checks for a diff, finds none, skips |
| 6 | Concurrent audits (two hosts in multi-host mode finish their iteration at the same time) | concurrency | `graceful-degrade` — separate audit lanes | Spawn 2 hosts in a single daemon; both finish iterations simultaneously; assert each audit writes only to its own host's TASKS.md (lock file per host) |
| 7 | TASKS.md is being edited by the operator at the moment the audit tries to write | concurrency | `loud-crash-supervisor-restart` — fail closed | Hold a write lock on TASKS.md while the audit runs; assert audit detects lock, defers to the next iteration, logs the deferral |
| 8 | Audit proposes a task whose `**Anchor**` field cites a paper that doesn't exist (hallucination) | upstream-malformed | `circuit-break-and-notify` — the operator catches it on PR review; the audit ships a citation-format validator (DOI / ISBN preferred) as a follow-up | Inject a mock LLM that hallucinates; manually verify; track as a follow-up task to add citation-format check |
| 9 | Audit's `Surfaced-by` evidence cites a log line that doesn't exist in the iteration log | upstream-malformed | `loud-crash-supervisor-restart` — refuse to write | Inject a mock LLM that fabricates a log line; assert audit's pre-write validation greps the iteration log for the cited line, fails when missing |

## Status

- **Phase**: Implemented (the `runHostCtoAudit` primitive is at `novel/cross-repo-runner/src/host-cto-audit.ts` with sibling unit tests). This story documents the operator-facing experience; the integration test `user-stories/007-cto-audit-files-new-tasks.test.ts` ships with this story and exercises the dry-run path end-to-end.
- **Blocking**: the merge-rate metric (`cto_audit_filed_tasks_merged_within_30d`) requires the metrics dashboard's PR-cross-reference query (filed as task `cto-audit-merge-rate-metric` P1 in this PR).
- **Theoretical anchor**: rule #17 (vision.md § 17 — proactive healing; observation IS the fix). Composed with Patterson 2002 *Recovery-Oriented Computing* — the daemon observing its own output is exactly the recovery-as-feature pattern.

## Pattern conformance

- **Pattern**: self-observation + recovery-as-feature (Patterson, D., "Recovery-Oriented Computing", *IEEE Computer* 35(11) 2002). Composed with rule #17 proactive healing (vision.md § 17) and the autonomic-computing self-monitoring loop (Kephart & Chess 2003 — the M of MAPE-K).
- **Conformance level**: partial — the audit runs and files tasks; the LLM-generated rule-9 fields are still occasionally malformed and require post-hoc cleanup. Sustained-quality work tracked as `cto-audit-rule-9-field-quality` P1.
- **Index row**: vision.md § "Pattern conformance index" row TBD — to be added in the implementation completion PR alongside `cto-audit-merge-rate-metric`.

## Security & privacy

(Per vision.md rule #13.)

- **Trust boundary**: the audit reads the operator's git diff + iteration log + TASKS.md, all under the operator's control. The LLM call goes through the same agent backend the operator already configured.
- **Secrets**: the diff may contain accidentally-committed secrets. The audit's pre-write step runs `scripts/scan-secrets.mjs` on the audit's own task-body proposal before writing; a secret in the diff is filed as a `secret-leak-<sha>` P0 with the secret REDACTED, never with the raw value.
- **PII**: file paths in the diff may contain `/Users/<username>/` — the audit redacts these to `~/` before including in any task body. Failure to redact is a `loud-crash-supervisor-restart` failure mode (table row 9 above covers the citation-existence check; PII redaction is a sibling check tracked in `cto-audit-pii-redaction-pre-write` P1).
- **Performance carve-out**: the audit's per-iteration cost is capped at 60s of LLM time (see chaos row 3). If the cap binds frequently (>10% of iterations), the daemon's overall iteration p95 grows, so the cap is documented in the iteration log for operator visibility.

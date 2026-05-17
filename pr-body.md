# feat(tick-loop): TASKS.md auto-lint-fix before the pre-PR gate (P0 `daemon-tasks-md-auto-lint-fix`)

## Why needed

The daemon's TASKS.md writes (claim → `**Status**: in-progress`, progress
overwrite, completion removal) are text substitutions that can leave an
MD012 double blank line at a block boundary. The pre-PR lint gate then
catches it and the daemon deadlocks — anchored by commit `eb7c44b`
(operator hand-fixed an MD012 at the `fresh-clone-bootstrap` task boundary
on 2026-05-11) and the `pre-pr-lint.failed_step:markdownlint` span that
blocked the `minsky-cli-auto-bootstrap-local-llm` PR in today's
`tick-loop.out.log`. This makes the operator babysit a mechanical fix.

This wires `markdownlint-cli2 --fix TASKS.md` into the daemon's
post-completed-iteration path **before** `maybeRunPrePrLintGate` verifies
the branch, so the most common lint violation is repaired at source —
before the gate that deadlocks on it even runs.

## What changed

- **New pure helper** `novel/tick-loop/src/tasks-md-lint-fix.ts` —
  `fixTasksMdMarkdown({ tasksPath, execSyncFn, dryRun?, warn? })` returns
  `{ violations, fixed }`. `markdownlint-cli2` is injected behind the
  `MarkdownlintExec` seam (rule #2). `parseSummaryCount` throws on a
  missing `Summary:` line (rule #6 — a tool crash must not read as "0
  violations" and commit anyway). Production binding
  `createMarkdownlintExec` spawns the repo's own `markdownlint-cli2`
  devDependency (rule #1 — canonical fixer, not reinvented).
- **Wired into `daemon.ts`** — `maybeRunTasksMdLintFix` runs after every
  `completed` iteration, before `maybeRunPrePrLintGate`, emitting a
  `tick-loop.tasks-md-lint-fix` span with `tasks-md-lint-fix.violations`
  + `.fixed`. Opt-in seam (`tasksMdLintExec`) — daemons predating it are
  unchanged. Production seam wired in `bin/tick-loop.mjs`.
- **Tests** — `tasks-md-lint-fix.test.ts` covers the 4 brief input states
  (clean, MD012, MD012+unfixable-MD001+warning, dry-run-no-mutation) plus
  `parseSummaryCount` crash handling; 2 daemon-wiring tests assert the
  span fires (and does not when the seam is absent).

## Optimization (per-iteration discipline gate)

**Round-trip elimination.** The brief's literal Detail (a) design is
`--fix` then a *separate* read-only re-count = 3 `markdownlint-cli2`
subprocess spawns per non-clean write. This implementation reads the
post-fix count from the `--fix` run's own re-lint `Summary:` line → 2
spawns. Bundled skip-earlier gate: a clean TASKS.md (the common case)
returns after 1 read-only spawn, never spawning `--fix`. Net: ≥1 fewer
subprocess spawn (≈ hundreds of ms each) per TASKS.md write — well above
the ≥10-byte anti-vanity floor.

## Manual test delta

Live regression against the real `markdownlint-cli2` (not the test stub):

- A 2× MD012 fixture → `{ violations: 2, fixed: 2 }`; the resulting file
  has zero multi-blank runs (MD012 repaired before any commit sees it).
- MD012 + unfixable MD001 → `{ violations: 3, fixed: 2 }`, warning fired,
  **no throw** (daemon proceeds — operator resolves heading order
  separately, brief Detail c).

## Hypothesis self-grade

- **Predicted**: after this lands, `markdownlint-cli2 --fix TASKS.md`
  runs before the pre-PR gate on every completed iteration, so
  `grep -c "failed_step.*markdownlint" .minsky/workers/*.log` over
  rolling 7d drops from ≥1 (observed today) to 0; the in-PR observable is
  the 4 paired input-state tests + live regression auto-fixing a
  deliberate MD012 before commit.
- **Observed**: 6 helper tests + 2 daemon-wiring tests green (104/104 in
  the daemon suite); live regression on real `markdownlint-cli2` returned
  `{violations:2,fixed:2}` and left zero double-blank-lines; the
  unfixable path warned without blocking.
- **Match**: partial
- **Lesson**: in-PR measurement (paired tests + live regression) is
  green; the 7d `failed_step:markdownlint = 0` metric is the post-ship
  confirmation and is not observable inside this PR.

<!-- security: not-applicable — adds a markdownlint-cli2 --fix pass over the in-repo TASKS.md text file behind an injected seam; no auth/secrets/sandbox/PII/network/supply-chain surface (the linter is an existing pinned devDependency) -->

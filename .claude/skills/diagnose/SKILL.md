---
name: diagnose
description: Structured root-cause debugging for Minsky. Six phases: feedback-loop, reproduce, hypothesize, instrument, fix+regression-test, cleanup. Use when a bug is reported, a test is failing, a worker is crashing, or any stability metric is below its threshold. Enforces rule #9's "pre-registered hypothesis" contract before any code changes.
allowed-tools: Bash, Read, Edit
---

# Diagnose

Structured bug investigation that satisfies rule #9's pre-registration contract *before* code changes. The six phases ensure a falsifiable hypothesis exists before anything is touched.

## Stop-the-Line rule

When a failure occurs: stop all feature work. Preserve evidence (logs, core dumps, last-good commit). Do not patch symptoms.

## Phase 1 — Feedback loop (critical foundation)

Everything else is mechanical once you have a fast, deterministic pass/fail signal. Try in order:

1. Failing unit/integration test (`pnpm vitest run <path>`)
2. HTTP script / `curl` fixture that reproduces the error
3. CLI invocation with a captured fixture
4. Captured trace replay
5. Minimal harness that imports only the broken module
6. Property / fuzz test (`fast-check`)
7. Git bisection (`git bisect run pnpm vitest run <test>`)
8. Human-in-the-loop bash script (last resort)

Do not proceed to Phase 2 until the signal is deterministic (same input → same failure, every run).

## Phase 2 — Reproduce

Verify the feedback loop produces the exact failure reported. Confirm reproducibility across at least 3 consecutive runs. Capture the precise symptom (error message, exit code, metric value) before proceeding.

## Phase 3 — Hypothesize

Generate 3-5 ranked, falsifiable hypotheses **before testing any**. Each hypothesis must state:

> "If <X> is the cause, then <changing Y> will make the bug disappear."

Rank by prior probability. Cheapest-to-falsify first. Do not touch code until this list is written.

## Phase 4 — Instrument

Prefer debugger / REPL over log-and-re-run. When logs are necessary, use tagged prefixes:

```
[DEBUG-<4-hex>] message
```

For performance regressions: measure the baseline metric *before* any change. Record it in the experiment yaml or commit message.

One hypothesis at a time. Mark it confirmed or refuted, then move to the next.

## Phase 5 — Fix + regression test

Write the regression test **at the correct architectural seam** (where the bug occurs in real use) *before* applying the fix. The test must:

- FAIL without the fix
- PASS with the fix
- Live permanently in the test suite

Then apply the minimal fix. No opportunistic cleanups (rule #3 — surgical changes).

Check rule #9: state the stability metric (error rate, recurrence count, MTTR, crash frequency) that this fix is expected to move, and by how much. If the metric source doesn't exist, file a preparation PR first.

## Phase 6 — Cleanup

1. Remove all `[DEBUG-<4hex>]` log lines
2. Verify the original reproduction scenario no longer fires (3 consecutive clean runs)
3. Document root cause in the commit message body (not just the subject line)
4. Note one architectural improvement that would prevent the class of bug — file it as a task if non-trivial

## Anti-rationalization

| Excuse | Counter |
|---|---|
| "I know what the bug is" | Assumed root cause is correct ~70% of the time. Write the hypothesis + falsification test first; costs <5 min and saves the other 30%. |
| "The failing test is probably wrong" | Verify first. Tests encode intended behavior. If the test is wrong, that's a separate fix — don't conflate. |
| "I'll add the regression test later" | "Later" means never. The test goes in before the fix, or the fix isn't done. |
| "The reproduction is intermittent, I can't reproduce it" | That IS the bug: non-determinism in the system. Document the conditions and build a flakiness detector before calling it resolved. |

## Red flags

- Fixing without a feedback loop
- Patching the symptom (deduplicating in UI instead of fixing the query)
- Skipping Phase 3 because "it's obvious"
- Removing the regression test because "it slows the suite"

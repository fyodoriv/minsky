## feat(daemon-pre-pr-lint-gate): pass-rate metric counts every red CI outcome, not just FAILURE (slice 38/N)

### Why needed

`daemon-pre-pr-lint-gate`'s pre-registered observable (TASKS.md Hypothesis) is **"≥80% of daemon-authored PRs open with zero red CI checks"**. The measurement (`pnpm daemon-pr-lint:metrics` + the `daemon-pr-lint-pass-rate` self-diagnose invariant) decided "red" by matching only `conclusion === "FAILURE" || state === "FAILURE"` in `statusCheckRollup`.

GitHub's GraphQL schema has more red terminal outcomes than `FAILURE`: a check-run can end `TIMED_OUT`, `STARTUP_FAILURE`, or `ACTION_REQUIRED`, and a legacy commit status can be `ERROR`. A PR whose CI run timed out or errored did **not** "open with zero red CI checks" — but the old predicate scored it *clean*, silently inflating the rolling pass-rate above its true value. That is exactly the "flattering observable" failure mode the project's rule #9 / pre-registration discipline forbids: the metric must inspect the real observable, not a laxer proxy that always trends up.

This slice tightens the predicate to the documented set of red terminal states, exported as a frozen `RED_CHECK_OUTCOMES` (rule #2 data-not-code) so the metric report, the paired tests, and `scripts/self-diagnose.mjs` — which reuses `parsePrListEntries` via `ghJson` — share one source. `CANCELLED`/`STALE`/`NEUTRAL`/`SKIPPED` are deliberately excluded (usually superseded re-runs; counting them would distort the ratio the *other* way).

No overlap with in-flight slice 37 (`shouldRunPrePrLintGate` wire-in touches `daemon.ts`/`daemon.test.ts`/`docs/`); this slice is confined to the metric/measurement scripts listed in the task's **Files**.

### Changes

- `scripts/daemon-pr-lint-metrics.mjs`: new exported frozen `RED_CHECK_OUTCOMES`; `parsePrListEntries` predicate + `hasFailure` JSDoc + report prose now reference the full red set.
- `scripts/self-diagnose.mjs`: `daemon-pr-lint-pass-rate` invariant JSDoc updated (behaviour follows automatically — it reuses `parsePrListEntries`, the single source).
- `scripts/daemon-pr-lint-metrics.test.mjs`: +6 paired tests (frozen-set pin with non-red exclusions; one red case per non-`FAILURE` outcome; CANCELLED/STALE negative).

### Manual test delta

```text
node_modules/.bin/vitest run scripts/daemon-pr-lint-metrics.test.mjs
  -> Test Files 1 passed (1); Tests 50 passed (50)

node_modules/.bin/vitest run scripts/self-diagnose.test.mjs
  -> Test Files 1 passed (1); Tests 99 passed (99)

node scripts/daemon-pr-lint-metrics.mjs
  -> Verdict: OK (50/50, 1.000)
```

The reported value is unchanged this run — no PR currently sits in a non-`FAILURE`-red terminal state inside the 30d/most-recent-50 window — so the fix is regression coverage that takes effect the next time a timed-out/errored run lands in the window, not a number-mover today.

### Optimization

`optimization: none-this-iteration: measurement-fidelity correctness fix; no brief / cached-prompt / earlier-gate / log-dedup / round-trip surface touched (the ≥10-byte anti-vanity floor is N/A — this is a correctness change, not an optimization)`.

### Scout

`scripts/self-diagnose.mjs § mapGhPrListToCiSnapshots` (the *separate* `daemon-pr-stuck-on-ci` invariant, a different task's surface) still hand-rolls the old `conclusion/state === "FAILURE"` predicate inline rather than reusing `parsePrListEntries`/`RED_CHECK_OUTCOMES` — a latent duplicate-predicate drift hazard. Left untouched per surgical-change discipline (different invariant, different task) and not filed as a task block per this iteration's anti-noop directive; flagging here so it is on record for a future `daemon-pr-stuck-on-ci` slice.

## Hypothesis self-grade

- **Predicted**: tightening the red-check predicate to `RED_CHECK_OUTCOMES` makes `pnpm daemon-pr-lint:metrics` measure the pre-registered observable ("zero red CI checks") instead of a `FAILURE`-only proxy; new paired tests pass and the existing metric + self-diagnose suites stay green.
- **Observed**: `scripts/daemon-pr-lint-metrics.test.mjs` 50/50 passed, `scripts/self-diagnose.test.mjs` 99/99 passed; `node scripts/daemon-pr-lint-metrics.mjs` → Verdict: OK (50/50, 1.000) with the broadened predicate; today's value unchanged (no non-FAILURE-red PR in the current window).
- **Match**: partial
- **Lesson**: the predicate now matches the observable, but the metric is still a current-state proxy (a PR that opened red then went green still counts clean) — a future slice should consider first-run conclusion if the proxy's laxity ever masks a real regression.

<!-- security: not-applicable — read-only metric/measurement script change; no auth, secrets, sandbox, PII, or supply-chain surface touched -->

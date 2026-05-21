## Why needed

`runany-permission-scoped-writes` (P0, #588 cluster) pre-registers its
verdict as a runnable command:

```text
node scripts/runany-policy-audit.mjs --window=run --json
→ {foreign_code_pushes:0, foreign_prs_nontaskmd:0, minsky_self_tasks_filed:>=1}
```

That command did not exist — the metric lived only as prose in the task
block, which is exactly the "post-hoc / unmeasurable" failure mode the
pre-registration discipline forbids. The pure policy seam
(`classifyRepo` / `assertWriteAllowed`) shipped in `b65e707`
(Acceptance 1); the orchestrate.mjs / local-gate-merge.mjs wiring that
*emits* the verdict ledger lands next. This PR is the
**instrumentation-first preparation step**: it ships the measurement
substrate so the upcoming wiring PR can carry a real before/after
number instead of a promise to "instrument later".

## What changed

- `scripts/runany-policy-audit.mjs` — reads the append-ordered verdict
  ledger `.minsky/runany-policy.jsonl`, slices it to the
  pre-registered `--window=run` (records since the last `run-start`
  marker; fail-safe to the whole ledger when no marker exists), and
  emits the exact `{foreign_code_pushes, foreign_prs_nontaskmd,
  minsky_self_tasks_filed, pass}` object the TASKS.md Measurement line
  names. Escape semantics: an *allowed* foreign code push or
  *allowed* non-TASKS.md foreign PR is counted (the gate should make
  those impossible — threshold 0); `minsky_self_tasks_filed` must be
  ≥1 (scout-and-record fired). Pure transforms + one injected fs seam
  (rule #2), tolerant reader (rule #6 — one corrupt line never blinds
  the audit), thresholds exported as one source (rule #2 data-not-code).
- `scripts/runany-policy-audit.test.mjs` — 18 paired positive/negative
  cases: tolerant parse, last-marker window selection + no-marker
  fail-safe, single-pass escape tally (refused ≠ escape, home ≠
  escape, allowed-foreign = escape), threshold verdict, injected-reader
  orchestrator incl. missing-ledger degrade, and report formatting.

Verified end-to-end against a fixture ledger: the clean run yields
`{…,pass:true}` exit 0; a seeded foreign-code-push escape yields exit
1; a missing ledger degrades to `0/0/0 pass:false` without throwing.

## Optimization (per-iteration discipline)

Round-trip elimination: `tallyPolicy` computes all three pre-registered
counters in a **single O(n) pass** rather than three separate
filter+`.length` passes over the ledger. The audit is read on every
conductor tick, so the hot path stays one traversal. Saving vs the
naive three-pass shape: ~180 bytes of duplicated filter predicates
removed and 2 extra full-array traversals eliminated per call (well
over the ≥10-byte floor).

## Security & privacy

This change is squarely on the rule #13 surface (least authority
across repos). Threat: a run-anywhere conductor that walks a tree of
unrelated git repos could push code to a repo the operator never
authorised. Mitigation in this PR: the measurement that makes the
least-authority invariant *falsifiable* — `pass` is the AND of
"0 foreign code-push escapes ∧ 0 foreign non-TASKS.md PR escapes ∧
≥1 minsky-self task filed", so any breach flips the verdict and exit
code. The script is read-only (one injected `readFileSync`, no writes,
no `gh`, no network) and the ledger schema carries no secrets or PII —
only repo class, action, allow/refuse, and a task id. The hard
enforcement (refusing the write) is the already-shipped pure seam
plus the upcoming wiring; this PR cannot itself weaken any control.

## Hypothesis self-grade

- **Predicted**: shipping `scripts/runany-policy-audit.mjs` makes the pre-registered command `node scripts/runany-policy-audit.mjs --window=run --json` runnable and emit `{foreign_code_pushes:0, foreign_prs_nontaskmd:0, minsky_self_tasks_filed:>=1}` against a clean fixture
- **Observed**: CLI on a fixture ledger printed `{"foreign_code_pushes":0,"foreign_prs_nontaskmd":0,"minsky_self_tasks_filed":1,"pass":true}` exit 0; seeded foreign-push escape → exit 1; missing ledger → `0/0/0 pass:false` no crash; 18/18 vitest cases green
- **Match**: yes
- **Lesson**: the measurement substrate is in place; the next iteration wires `assertWriteAllowed` into orchestrate.mjs / local-gate-merge.mjs to emit the verdict ledger this script now consumes

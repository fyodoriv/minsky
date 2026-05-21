## What

Slice 1 of `runany-retro-tui-dashboard`: the **pure render core** of
the new zero-dependency retro-1995 (amber/green-on-black, 80x24)
CLI/TUI operator surface. New package `@minsky/tui`:

- `formatMachineInfo` — pure machine-info panel formatter (host / time
  / load / cpu / mem / disk / proc-count), `nowMs` injected.
- `renderDashboard` / `formatProcRow` / `repoBasename` — pure retro
  80x24 dashboard renderer; colour is an opt-in flag so the layout is
  deterministically unit-testable.
- The machine-wide process scan is **composed, not reinvented**:
  `parseMinskyProcs` / `scanMinskyProcesses` / `MinskyProc` are
  re-exported from `@minsky/cross-repo-runner`'s blessed
  `scan-processes.ts` substrate (rule #1).

12 unit tests, all green. Wired into the workspace (`tsconfig.json`
project reference, `pnpm-lock.yaml` workspace dep) and the `vision.md`
Pattern conformance index (row 89, with the rule #10 ratchet note).

## Why needed

The current operator surface is `@minsky/dashboard-web` — a Hono SSR
web app gated by a Lighthouse Mobile≥0.85 CI job that needs Chromium, a
bound port, and a browser. That is the wrong shape for a $0,
multi-tenant, run-from-any-folder CLI tool (operator directive
2026-05-16). This slice lays the dependency-light, fully-tested render
substrate for screen 1 (machine dashboard). It deliberately does **not**
wire `bin/minsky` or remove the web UI yet: the rule #10 ratchet fires
in the wiring slice that lands the operator-facing surface, so the web
UI is never removed before its replacement is reachable.

`novel/cross-repo-runner/README.md` already declared `scan-processes.ts`
the shared substrate the retro TUI must build on; composing it (rather
than my first draft's duplicate parser) is the rule #1-correct shape and
is verified by the rule-1 lint.

## Scope boundary (this slice)

In: machine-info formatter + dashboard renderer + tests + package +
pattern-index row; scan composed from `@minsky/cross-repo-runner`. Out
(later slices): the I/O shim, screen 2 (process detail + log list),
`bin/minsky` no-arg/auto-open wiring, `scripts/runany-tui-audit.mjs`,
and the rule #10 ratchet removing `@minsky/dashboard-web` +
`distribution/run-dashboard-web.sh` + `.github/workflows/lighthouse.yml`
in the same PR as that wiring.

## Incidental: shared pre-pr-lint gate unblock

`main` was red on the repo-wide `biome ci .` step (6 pre-existing
errors in `novel/cross-repo-runner`: `spawn-plan.ts` unused template
literals + format drift in `task-finder.ts` / `task-finder.test.ts` /
`minsky-run.mjs`). Fixed via biome's own deterministic autofix — no
behaviour change — because the gate blocks every PR until green. The
`spawn-plan.ts` edit collapses two identical template-literal ternary
branches to string literals (same rendered string).

## Optimization-discipline

optimization: none-this-iteration: foundational slice creates a new
render package; there is no pre-existing brief, gate, log line, or
round-trip on this surface to shrink yet. (The rule-1 refactor removes
a duplicate `ps` parser — a correctness fix, not a measured
optimization, so not claimed as one.)

## Security & privacy

The renderer is pure and read-only; the only untrusted input is the
`MinskyProc[]` derived from `ps` command lines of other host
processes, parsed once in the audited `@minsky/cross-repo-runner`
substrate (vet-child exclusion + fail-safe live there, not duplicated).
Threat: a hostile local process could name its argv like a minsky
entrypoint and show as a phantom row (spoofing); the surface is
read-only (no action on a row) so the blast radius is a cosmetic
phantom row, not code execution. The dashboard renders only
`pid/kind/repo-basename/runId`, never the full argv, so other
processes' flag values are not disclosed on screen 1. No auth, secrets,
sandbox, PII, network, or filesystem-write surface is introduced. Full
STRIDE table in `novel/tui/README.md` § Threat model (rule #13 § 13.8
reviewed).

## Test / verification

- `pnpm --filter @minsky/tui test` → 12 passed (machine 3, render 9).
- `@minsky/cross-repo-runner` scan substrate unchanged; its
  `scan-processes.test.ts` (7 cases) still green.
- `pnpm pre-pr-lint` (fast, the canonical gate) → green; full stage
  green in a clean env.
- Not caused by this PR: `novel/tick-loop/src/minsky-bootstrap-smoke.test.ts`
  fails iff `MINSKY_LLM_PROVIDER` is exported in the runner's shell
  (it asserts on un-sandboxed `process.env`); 4/4 green with the var
  unset (CI's state). Pre-existing env-sensitive flake already tracked
  by PR #577; untouched by this slice (no `tick-loop` change here).

## Hypothesis self-grade

- **Predicted**: composing the existing `@minsky/cross-repo-runner`
  scan substrate + a pure renderer (no TUI dependency, no second `ps`
  parser) fully covers screen 1's behaviour, so the operator surface
  costs $0 at runtime and every layout path is unit-testable; success =
  every `renderDashboard` line equals the box width across the empty,
  single and multi-process cases and zero duplicate `ps`-parsing logic
  (rule-1 lint green).
- **Observed**: 12/12 tests pass; width invariant holds at width 80 and
  100 and for the empty-list notice; the duplicate parser was deleted
  and `@minsky/tui` re-exports the substrate; rule-1 / rule-3 / rule-4 /
  rule-6 / rule-12 / pattern-index lints all green.
- **Match**: yes
- **Lesson**: read the consuming package's README before adding a
  "foundational" module — the scan substrate already existed and was
  documented as the thing the TUI must compose; the first draft's
  duplicate would have shipped a rule #1 violation.

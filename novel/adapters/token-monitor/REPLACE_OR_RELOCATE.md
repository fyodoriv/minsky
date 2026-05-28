<!-- scope: human-approved closes-research-replace-or-relocate-adapters-token-monitor (P2; task block removed in the same commit per rule #17). -->

# `@minsky/token-monitor` — Replace or Relocate?

**Decision (2026-05-28)**: **KEEP** in `novel/adapters/`. The
wrapper is small + load-bearing for test isolation; relocation to
`agentbrew` deferred until a second consumer materialises.

## What this file is

A re-evaluable replace-or-relocate research note per rule #1
(don't reinvent the wheel — re-check quarterly whether an upstream
project now fits). The substrate adapter wraps Maciek Lewicki's
upstream [`claude-monitor`](https://pypi.org/project/claude-monitor/)
Python package and exposes a TS Strategy interface.

## Replacement candidates evaluated

### Vendor `claude-monitor` as-is (skip the wrapper)

- **Verdict**: REJECTED.
- **Why**: `claude-monitor` is a Python TUI + JSONL reader; Minsky's
  consumers are TS callers in the daemon hot path. The wrapper is
  the integration layer that lets test code substitute
  `StubTokenMonitor` (per Meszaros, *xUnit Test Patterns*, 2007)
  without forking the upstream package. Dropping the wrapper would
  push the Python-to-TS boundary into every test file.

### Anthropic billing API (direct)

- **Verdict**: PIVOT CANDIDATE.
- **Why**: Anthropic's billing API exposes per-request token counts,
  but it lacks (a) the 5-hour SessionBlock windowed aggregation
  Maciek's package computes from `~/.claude/projects/**/*.jsonl`,
  and (b) the per-process attribution that lets Minsky distinguish
  daemon-spawned agent tokens from operator-driven IDE tokens.
- **Pivot trigger**: if Anthropic ships per-process attribution +
  session-window aggregation in the billing API, the
  `MaciekTokenMonitor` Strategy class becomes a 50-LOC adapter over
  the billing HTTP endpoint; drop the `claude-monitor` dep.

### Roll our own `~/.claude/projects/**/*.jsonl` parser

- **Verdict**: REJECTED.
- **Why**: Maciek's package is the canonical implementation — the
  JSONL format is undocumented Anthropic-internal substrate, and
  `claude-monitor` already tracks Anthropic format changes upstream.
  Reimplementing would duplicate the maintenance burden for the
  format-tracking surface; the wrapper gives us Minsky-specific
  test fakes without touching Maciek's parser.

## Relocation analysis

**Verdict**: POSSIBLE (to `agentbrew`), but DEFERRED.

Token-budget tracking is broadly applicable to any agent-running
tool — not Minsky-specific. The same Strategy interface +
`MaciekTokenMonitor` impl would serve agentbrew (which manages
multiple agent runtimes) or any sibling tool that needs the
"how much have I spent on Claude this session?" surface.

Relocation cost:

- Move `novel/adapters/token-monitor/` → `agentbrew/packages/
  token-monitor/`.
- Update Minsky's imports (3 call sites in the daemon: budget guard,
  `minsky watch` dashboard, observer heal-budget-low).
- Verify agentbrew's CI runs the existing test suite + selfTest
  contract.

Deferred because: today there is only one consumer (Minsky). Rule #1
says "extract when 2+ consumers materialise"; one consumer + a future-
maybe-consumer is below the threshold.

## Re-evaluation criteria

Re-check this decision when ANY of:

1. agentbrew (or another sibling tool) adds an agent-runtime that
   needs token-budget tracking. → trigger relocation to
   `agentbrew/packages/token-monitor/`.
2. Anthropic ships the per-process + session-window billing API. →
   trigger the PIVOT to a 50-LOC adapter; drop `claude-monitor` dep.
3. Maciek deprecates `claude-monitor` or stops tracking Anthropic
   format changes. → trigger a fork-vs-replace evaluation.

## Anchor

- Gamma et al., *Design Patterns*, 1994 — Strategy + Adapter
  patterns (`TokenMonitor` interface + `MaciekTokenMonitor` impl).
- Meszaros, *xUnit Test Patterns*, 2007 — Test Fake (`StubTokenMonitor`).
- Aho-Sethi-Ullman, *Compilers*, 1986 — recursive-descent JSONL parser.
- Rule #1 (`vision.md`): don't reinvent the wheel — re-check
  quarterly per the `review-q*` cadence task.

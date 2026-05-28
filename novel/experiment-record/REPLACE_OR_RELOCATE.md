<!-- scope: human-approved closes-research-replace-or-relocate-experiment-record (P2; task block removed in the same commit per rule #17). -->

# `@minsky/experiment-record` — Replace or Relocate?

**Decision (2026-05-28)**: **KEEP** in `novel/`. The existing
README rule-1 comment already documents the rejection of generic
JSON-Schema validators; this note extends the analysis to the
ecosystem alternatives (GrowthBook, Statsig, mlflow, W&B) and
records why each is the wrong fit for rule-#9's pre-registration
shape.

## What this file is

A re-evaluable replace-or-relocate research note per rule #1.
Codifies the per-tool rationale that's currently a one-line
rejection at the top of `README.md`.

## Replacement candidates evaluated

### ajv / generic JSON-Schema validators

- **Verdict**: REJECTED (already documented in the README's rule-1
  comment).
- **Why**: `EXPERIMENT.yaml` is a Minsky-specific schema with
  rule-#9 fields (hypothesis prose ≥ N words, pivot threshold
  numeric, measurement command runnable, literature anchor with
  citation shape). A generic validator covers the structural
  layer but the field-level semantics need first-class TS code.
  The 5 gates that consume the parsed shape
  (`ci-experiment-runner-v0`, `experiment-tracker-v0`,
  `pivot-success-margin`, `anchor-primary-source`,
  `measurement-inspects-output`) are tightly coupled to the
  parsed AST.

### GrowthBook

- **Verdict**: REJECTED (wrong tool class).
- **Why**: GrowthBook is an A/B-test platform — it splits user
  cohorts, computes statistical significance against a target
  metric, and reports lift. Minsky's `EXPERIMENT.yaml` is a
  hypothesis-driven-development record per PR (Kohavi-Tang-Xu
  2020 sustained-gain pattern, not a cohort-split A/B). The two
  formats overlap only on the word "hypothesis"; the workflows
  are different. GrowthBook over Minsky's PR stream would need
  a substantial adapter to map PRs to "experiments" + a way to
  feed pass/fail back from CI — at which point the wrapper IS
  the experiment-record code.

### Statsig

- **Verdict**: REJECTED, same as GrowthBook.
- **Why**: Statsig is a feature-flag + A/B platform with a
  hosted backend; Minsky's experiment records live in the repo
  as committed `EXPERIMENT.yaml` files (git-native, no hosted
  dependency). Adopting Statsig would force a hosted-service
  dependency for what is fundamentally git-tracked records.

### mlflow / Weights & Biases

- **Verdict**: REJECTED.
- **Why**: ML experiment trackers optimize for parameter sweeps
  and metric logging across thousands of runs; Minsky's experiment
  records are 1-per-PR with a single measurement command, not
  a parameter-sweep workflow. The cost of the runtime
  (Python runtime, hosted backend, UI server) dwarfs the value
  for our per-PR record shape.

## Relocation analysis

**Verdict**: UNLIKELY.

The `EXPERIMENT.yaml` format is rule-#9-specific — the field set
(hypothesis prose, pivot threshold numeric, measurement command,
literature anchor) embodies the rule. A sibling project would
need rule-#9 (or an equivalent) to derive value from the format.
agentbrew today doesn't have a rule-#9 equivalent; the relocation
target is empty.

If agentbrew adopts rule-#9 in the future (the discipline is
sound and transferable), relocation becomes a real candidate.
Until then, the format and the parser stay where they're consumed.

## Re-evaluation criteria

Re-check this decision when ANY of:

1. agentbrew (or another sibling tool) adopts rule-#9 (or an
   equivalent pre-registration discipline). → trigger relocation
   to a shared `experiment-record` package.
2. A generic schema validator ships with first-class support for
   prose-word-count + command-is-runnable + citation-shape
   validators. → re-evaluate the ajv verdict.
3. GrowthBook (or Statsig) ships a "per-commit experiment record"
   feature explicitly designed for PR-level hypothesis tracking
   (not cohort A/B). → re-evaluate.

## Anchor

- Kohavi, Tang, Xu, *Trustworthy Online Controlled Experiments*,
  2020 — sustained-gain pattern (the rule-#9 pivot threshold
  shape).
- Rule #1 + #9 (`vision.md`) — rule #9 IS the format's reason for
  existence; the format would have no value without the rule.

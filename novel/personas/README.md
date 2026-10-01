<!-- rule-1: a bespoke handoff-spec JSON-schema package (novel/handoff-spec/) was considered and rejected because: A2A's Task lifecycle (QUEUED → WORKING → COMPLETED/FAILED) already IS the persona-to-persona handoff substrate; building a parallel schema + validator + writer/reader would reinvent the wheel (rule #1). The personas/ dir holds only markdown brief templates + this mapping doc — no novel transport code. -->
<!-- scope: human-approved — the M2 multi-persona A2A pipeline mapping doc (task multi-persona-pipeline-via-a2a, shipped) -->
<!-- pattern: not-applicable — a mapping doc, not a code artefact; the pipeline's pattern (SOP over the actor model, Hewitt 1973) is named in the "How A2A maps to the persona model" section below -->

# Personas — the multi-persona A2A pipeline

This directory holds the five persona brief templates that drive Minsky's M2
multi-persona pipeline (researcher → planner → developer → QA → reviewer running
on one task) and documents how the pipeline maps onto the A2A adapter. It exists
because no single model is good at architecture, implementation, and review at
once (README.md § "Why Minsky?" bullet #3); the pipeline lets a specialist
persona own each stage and hand its artifact to the next.

## What this is

Five markdown templates — one per persona role — plus this mapping note. Each
template names the role's responsibility, the A2A `Task` it produces as output,
the prior persona's artifact it consumes as input, and its done/fail signal.
`scripts/build_brief.py --persona <role>` overlays the matching template onto the
task brief so the spawned agent reads its role before the task.

## What this is not

This is **not** a custom handoff-format package. The bespoke `novel/handoff-spec/`
JSON-schema design (the superseded `multi-persona-pipeline-handoff-spec` task) is
obsoleted: A2A's Task lifecycle is the handoff substrate. There is no schema, no
validator, and no writer/reader code here — only briefs and this doc.

## How A2A maps to the persona model

The pipeline driver (`bin/minsky-multi-persona.sh`) walks the five personas in
order. For each transition it:

1. Builds the persona brief via `build_brief.py <task-id> <host> --persona <role>`.
2. Obtains an A2A task ID by calling the A2A adapter's `sendMessage(role, task)`
   (`@minsky/a2a` → `A2AOpenHands`). The A2A `Task` lifecycle IS the handoff.
3. Records the persona's artifact at `.minsky/handoffs/<task-id>/<role>.md` — the
   Pivot envelope: a Minsky-side payload the next A2A message references by URI
   (rule #11 "absorb" — the payload is Minsky-specific, the transport is A2A).
4. Appends one line to `<host>/.minsky/iterations.jsonl` carrying `persona=<role>`
   and the A2A task ID, so every transition is observable (rule #4).

The next persona's brief is prepended with the prior persona's artifact, forming
the researcher → planner → developer → QA → reviewer artifact chain.

## Failure modes & chaos verification

Per constitutional rule #7 (`vision.md` § 7).

- **Steady-state hypothesis**: the driver walks all five personas in order, logs
  one `persona=` line per transition, and each persona's artifact is visible in
  the next persona's brief.
- **Blast radius**: one pipeline run for one task. A failed persona halts that
  pipeline only; other tasks are unaffected.
- **Operator escape hatch**: run `build_brief.py --persona <role>` for a single
  persona by hand, or drop the `--persona` flag to fall back to the single-agent
  brief.

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | Unknown persona role passed to `--persona` | upstream-malformed | `loud-crash-supervisor-restart` — exit non-zero, name the valid roles | `test/integration/multi-persona-pipeline.test.ts` asserts an unknown role exits non-zero |
| 2 | A persona's artifact is missing when the next starts | dependency upstream-error | `loud-crash-supervisor-restart` — driver halts the pipeline at the gap | `test/integration/multi-persona-pipeline.test.ts` asserts the artifact chain is contiguous |
| 3 | A2A adapter `sendMessage` unavailable (dist not built) | dependency upstream-error | `graceful-degrade` — driver falls back to a locally-generated task ID and still logs the transition | `test/integration/multi-persona-pipeline.test.ts` asserts every transition is logged even without the adapter |
| 4 | Pipeline run twice for the same task | concurrency | `graceful-degrade` — handoff artifacts are overwritten idempotently | `test/integration/multi-persona-pipeline.test.ts` asserts a second run leaves exactly 5 fresh artifacts |

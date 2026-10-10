# Constitutional rules — full text

This file exists so every agent can read the full text of each constitutional rule that `AGENTS.md` lists in one line. The rules come from [vision.md](../../vision.md), which stays the source of truth; this file is the operational reading of them.

## 1. Don't reinvent the wheel

Before writing any new code, search for an existing tool. If one exists, write an adapter (see rule 2). If none exists, design the new code as an extractable OSS package from day one — not a private module. Apply continuously, not only at start.

## 2. Every dependency is accessed through an interface

No tool name appears in business logic. New external dependencies require:

- An interface file in `novel/adapters/<name>.ts`
- An implementation file in `novel/adapters/<name>.<vendor>.ts`
- A `selfTest()` method on the implementation, runnable from `setup.sh`
- A row added to the dependency table in `ARCHITECTURE.md`

## 3. Test-first, metric-first, doc-first

Every change starts with:

1. A failing test (red)
2. A metric in the relevant `user-stories/*.md` file with a numeric threshold and an SLI source
3. Updated documentation in the same commit as the code change

Then write the minimum code to pass (green). Then refactor.

No exceptions. Apply at every level: code, persona behavior, orchestration logic, even the autonomic manager's own decisions.

**Acceptance-scenario gate (spec-kit Article III reinforcement).** Before a test file is written, the acceptance criteria the test will assert must exist as Given/When/Then scenarios in either `user-stories/<id>.md` or `.minsky/specs/<task-id>.md`. A test without a traceable GWT scenario is orphaned — it can pass for the wrong reason and cannot be falsified against the original intent. Order: write GWT scenarios first (via `/task-spec`), then the test, then implement. Source: spec-kit `spec-template.md` § "User Scenarios & Testing"; conforming pattern: BDD acceptance-test specification (Wynne & Hellesøy, *The Cucumber Book*, 2012).

**Independent testability gate.** Every user story or vertical slice — whether in `user-stories/*.md` or in a spec's story decomposition — must pass the spec-kit independent-testability test: "If you implement just this one story, do you have a viable, demonstrable unit of value?" If yes, the story is correctly bounded. If no, the story spans too many concerns and must be split before `/task-slice`. Source: spec-kit `spec-template.md` IMPORTANT comment block; conforming pattern: vertical-slice delivery (Cockburn, *Crystal Clear*, 2004, Ch. 3).

## 4. Everything measurable, everything visible

New components emit OpenTelemetry. New metrics appear on a dashboard. If a metric matters enough to track, it's reachable from the Watch.

If you can't see it, it doesn't exist. If you have to dig for it, you won't.

## 5. Theoretical grounding

Architectural choices reference named patterns (Hewitt actor model, Beer VSM, Armstrong supervision, Boyd OODA, etc. — see `vision.md` § "Theoretical foundations"). Don't invent terminology when literature has a word for it.

## 6. Stay alive

Code paths must handle: process death, rate limit hits, dependency failures, mid-task interruption. Idempotency is default. Long try-catch chains are a smell — prefer "let it crash" with supervisor restart, per Erlang/OTP discipline.

## 7. Chaos engineering

Trust no component whose failure probability is not provably ≤1e-12. Every novel package and every user-story file enumerates failure modes, expected behavior (`loud-crash-supervisor-restart` / `circuit-break-and-notify` / `graceful-degrade`), a deterministic chaos test, and explicit blast radius + operator escape hatch. Silent retry-with-backoff that suppresses failure is itself a constitutional violation. See `vision.md` § 7 for the full rule + sources.

## 8. Pattern conformance

Every artifact (file, package, interface, architectural decision, process step) traces to a named, published pattern. New artifacts add a row to `vision.md` § "Pattern conformance index" *in the same commit*. Deviations from the published pattern are declared explicitly in the row's notes column (which property differs, why it's acceptable, what would restore full conformance) and, for substantive deviations, in `research.md`. Identifiers match pattern names when the match is total (`aggregateStatus`, future `MapeKLoop`, `SupervisionTree`, `CircuitBreaker`). Top-of-file comments name the pattern; JSDoc on public interfaces cites it. Silent deviation is itself a constitutional violation. See `vision.md` § 8 for the full rule + sources.

## 9. Pre-registered hypothesis-driven development (iron rule)

Every change declares — **before code is written** — its hypothesis, success threshold, pivot threshold (numeric), measurement method (runnable shell/OTEL/CI command), and literature anchor. **Iron**: no exemption for small fixes, obvious bugs, or refactors. Vanity metrics and post-hoc metrics are forbidden. If the metric source doesn't exist yet, ship a preparation PR first.

Full text, automation layer, NEEDS-CLARIFICATION gate, and sources in [vision.md § 9](../../vision.md).

## 10. Deterministic enforcement (iron rule)

Every constitutional rule must be enforced by a deterministic CI check — not a Skill, not an LLM, not "the agent will remember". LLM-driven checks are *advisory only*; never load-bearing. When a rule resists mechanisation, split it into a deterministic substrate plus an explicit human-judgement layer. When a deterministic linter ships, any prior Skill-based enforcement is *removed* in the same PR (the ratchet rule).

Full text, constitutional-gate pattern, and sources in [vision.md § 10](../../vision.md).

## 11. Default by default (rule #16)

When you implement a new behaviour or fix, make it the default immediately — not an opt-in flag behind an env var. Every new default ships with (1) an experiment in `.minsky/experiments/<id>.yaml`, (2) a runnable measurement, (3) a documented opt-out for debugging only. Burden of proof: "why ISN'T this the default?"

**CLI surface consolidation (corollary).** New CLI capabilities default to **flags on existing commands** or **default behavior of existing commands** — never new subcommands. Before writing a new `case` branch in any CLI entrypoint, answer three questions: (1) Is this a refinement of an existing command? → add a flag. (2) Should this happen automatically when the user runs the parent? → make it the parent's default. (3) Are the semantics fundamentally different from every existing command? Only when all three answers force "no, no, yes" does a new verb earn a slot. For `minsky` specifically: invoked with no subcommand it MUST run `doctor` first (pre-flight), exit non-zero on critical failure, attach to a running daemon for $PWD if present, else start one with sensible defaults. Subcommands that violate this rule are folded into their parent with a one-major-version-deprecated alias.

Full text and example list in [vision.md § 16](../../vision.md). See [`.claude/skills/cli-consolidation/SKILL.md`](../../.claude/skills/cli-consolidation/SKILL.md) for the operational checklist.

## 12. Proactive healing (rule #17 — iron, no exemption)

**Observation IS the fix.** Every error you see — `spawn-failed`, `scope-leak`, `ETIMEDOUT`, `GraphQL 401`, stack traces, hung processes, flaky tests, red CI checks — is treated as work to ship in the SAME session, the SAME PR if possible. "Observe and report" is forbidden. "Mental note for later" is forbidden.

Four mandatory parts:

1. **Same-session action.** The agent who observed the error owns the fix before its session ends. If the fix needs an external action, file a `TASKS.md` block with `**Blocked**: <one-word-code>` and the unblock path on the first line — never both fix-attempted and silently-moved-on.
2. **Fix the class, not the instance.** Land the lint or invariant that prevents the entire category (rule #10 shape). A 401 today means the auth path is fragile — add a CI lint, not just a retry.
3. **Heal before reporting.** Every status message to the operator must carry an active verb: `fixed`, `patched`, `rolled out`, or `filed-blocked-because`. A bulleted summary of failures with zero merged fixes is the exact pattern this rule forbids.
4. **Deterministic gate.** `scripts/check-rule-17-proactive-heal.mjs` runs on every PR: if observed-error tokens > 0 and `(prs-opened + tasks-filed + commits-landed) == 0`, the PR is rejected. Same shape as rule #9's missing-`EXPERIMENT.yaml`.

Trigger phrases that activate this rule IMMEDIATELY (don't ask, just fix): "fix bugs before they happen", "be proactive", "heal minsky", "make sure minsky picks them up", "make it persist", "make it iron rule".

## 3a. Runtime invariants (coverage ≠ correctness)

High unit-test coverage (95%+) is necessary but NOT sufficient. Every bug found in production during the 2026-05-18 session (stdin panic, permission mode missing, walker starvation, scope-leak false positives, brief missing PR instructions, watchdog kills) had passing unit tests — because unit tests mock the integration seams where real bugs live.

**Runtime invariants** (`novel/cross-repo-runner/src/runtime-invariants.ts`) run before EVERY iteration and check the **system** — not the pure functions. They verify:

- Agent argv includes required flags for the configured agent (catches an agent without `--permission-mode`)
- Brief includes PR creation instructions (catches the no-PR-opened bug class)
- Git tree is clean before spawn (catches scope-leak false positives)
- Task not stuck in a re-pick loop (catches walker starvation)
- Daemon PID is actually alive (catches stale PID, the #1 ops failure)

When a runtime invariant fails with `severity: "error"`, the iteration **must not proceed** — the bug class it guards against wastes the entire iteration's compute. When it fails with `severity: "warn"`, log it and continue (the operator sees it in `minsky watch`).

**Adding new invariants**: every bug found in production becomes a runtime invariant in the same PR that fixes it. The pattern: `(ctx: InvariantContext) => InvariantResult`. Pure function, no I/O — the caller builds the context.

## 3b. Integration tests for CLI features (reinforcement)

Every CLI-facing feature (`bin/minsky` subcommands, `minsky watch`, `minsky status`, any operator-visible UX) must ship with an integration test in `test/integration/`. The test must:

1. Exercise the real script/binary (not a mock).
2. Use fixture data (temp dirs with synthetic jsonl/yaml) for deterministic results.
3. Assert on the output format the operator sees.

A dashboard feature without an integration test is a regression waiting to happen. Paired unit tests in `novel/*/src/*.test.ts` are not sufficient — the integration test catches the wiring between the bash shim, node scripts, and file-system state.

## 14b. Dynamic settings (no hardcoded timeouts)

All timeouts, intervals, thresholds, and resource limits must be **dynamically computed** from actual iteration history on the current machine — never hardcoded. Different machines have different CPUs, network latencies, and model routing speeds. A watchdog that's correct for Claude on a fast machine kills a slow agent on a slow machine.

The implementation (`novel/cross-repo-runner/src/dynamic-timeouts.ts`):

- **Spawn watchdog** = p95(successful iteration durations) × 1.5, clamped to [2min, 45min]. With <5 data points, defaults to 20min.
- **Tick interval** = p50(successful iteration durations) × 0.1, clamped to [30s, 5min].
- History source: `.minsky/experiment-store/cross-repo/*.jsonl` — the same iteration records the runner already writes.
- Env var `MINSKY_LIVE_SPAWN_TIMEOUT_MS` overrides the dynamic value (escape hatch).

When adding any new configurable constant, follow this pattern: compute from data first, hard-default second, env-override third. Log the computed value so the operator sees it in the daemon log.

## 15. Milestone alignment gate (supersedes task picking)

Before picking ANY implementation task, verify that **seven surfaces** are up-to-date and aligned with the current milestone in `MILESTONES.md`. If any surface is stale or misaligned, updating it IS your first task — not picking an implementation task. This is iron: no exemption.

The seven surfaces:

1. **`README.md`** — reflects the current milestone's install, run, benefits, and competitive positioning. The quickstart section must match the actual one-command flow that works today, not a future aspiration.
2. **Quickstart** — whatever `README.md` says you can do, you can actually do it right now. If the quickstart says `npx minsky init`, that command must work.
3. **`vision.md`** — milestone goals are reflected in the success criteria section. Milestones and vision must not contradict.
4. **`user-stories/`** — each exit criterion in the current milestone's table in `MILESTONES.md` has a corresponding user story file with a metric, integration test reference, proof, and failure modes. Missing user stories for shipped milestone criteria are a gap.
5. **Integration tests** — user-story tests in `user-stories/*.test.ts` exist and pass for every exit criterion the current milestone claims as shipped. A milestone criterion without a passing integration test is not shipped.
6. **Logs + observability** — OTEL spans, daemon logs (`orchestrate.jsonl`), and any other observability surfaces capture the data needed to verify the current milestone's exit criteria. If a milestone criterion requires measuring X, the system must actually emit X.
7. **`METRICS.md`** — every metric the current milestone depends on has a **real observation** (not a `(stub)`). Stub metrics mean the milestone cannot be verified and therefore cannot be considered progressing.

**Enforcement**: when `scripts/check-milestone-alignment.mjs` exists, run it. Until then, manually audit the 7 surfaces. The audit output goes into the PR body as a `Milestone alignment check` section.

**Operator directive 2026-05-18**: this gate is the #1 priority in all minsky work. Implementation tasks that skip it are constitutional violations.

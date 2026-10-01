<!-- pattern: see vision.md § "Pattern conformance index" — this doc is the canonical "make this host follow Minsky principles" checklist consumed by `minsky bootstrap <host>`, the `/next-task` Tier-1–3 audit cascade, and the cross-repo runner's task-synthesis layer. -->

# Host transformation checklist

> Canonical "what does it mean for a host repo to follow Minsky principles?" Read after `minsky bootstrap <host-dir>` lays the `.minsky/` sidecar; the bootstrap is the substrate, this checklist is the contract.

When `minsky bootstrap <host-dir>` writes `.minsky/repo.yaml`, it commits the host to following the six disciplines below. Each discipline has a (a) one-line description, (b) a measurable acceptance criterion, and (c) the enforcing script in `scripts/` that the cross-repo runner invokes against the host substrate via `MINSKY_HOST_ROOT=<host-dir>`.

This document is consumed by three callers:

1. **`minsky bootstrap`** — prints a summary of the six disciplines after writing the sidecar so the operator knows what they just opted in to.
2. **The `/next-task` Tier-1–3 audit cascade** — Tier 1 (constitutional gates) and Tier 2 (failure-mode coverage) are gap-closers against this checklist; Tier 3 picks the next concrete improvement when the queue is empty.
3. **`cross-repo-runner-v1` task-synthesis** — when a host's `TASKS.md` queue is empty, the runner picks the next gap from this checklist (e.g., "no chaos table on `novel/foo/`") and synthesises the task automatically.

The checklist is anchored in **rule #12** (vision.md § "Scope discipline" — when the queue empties, the next move is closing a gap against this substrate, not new functionality) and maps the six disciplines to constitutional rules #2, #3, #4, #7, #8, #9.

## 1. Lint discipline (rule #2 — every dependency behind an interface)

**Description.** Every external dependency the host's novel code imports lives behind an adapter interface in `<host>/novel/adapters/` (or the equivalent adapter directory declared in `.minsky/repo.yaml`). No vendor name appears in business logic. The deterministic CI gate refuses to merge a PR that imports a vendor package directly outside the adapter layer.

**Acceptance criterion.** `node $MINSKY_HOME/scripts/check-rule-2-dep-coverage.mjs` exits 0 against the host's diff. The host's `package.json` declares each adapter-fronted dep in the `dependencies` block; the adapter's `*.test.ts` covers the interface 100 %.

**Enforcer.** `scripts/check-rule-2-dep-coverage.mjs` (cross-repo-portable; consumes `MINSKY_HOST_ROOT`). Baseline lint discipline (formatting, complexity, unused symbols) is delegated to the host's own linter (`biome check` for TS hosts; the runner doesn't reinvent style).

## 2. Test discipline (rule #3 — test-first, metric-first, doc-first)

**Description.** Every non-trivial function in the host's `novel/` directory has a paired `*.test.ts` (or language equivalent). Coverage threshold is whatever the host's `.minsky/repo.yaml` declares (default ≥80 % branch). Public APIs document their contract in a JSDoc / docstring before the implementation lands — the doc is the metric.

**Acceptance criterion.** `node $MINSKY_HOME/scripts/check-rule-3-doc-first.mjs` exits 0 against the host's diff. Coverage report from the host's test runner meets or exceeds the declared threshold.

**Enforcer.** `scripts/check-rule-3-doc-first.mjs` (cross-repo-portable). The coverage threshold check itself is the host's own test runner — minsky reads the report, doesn't replace the runner.

## 3. OTEL coverage (rule #4 — everything measurable, everything visible)

**Description.** Every novel function the host ships emits one OpenTelemetry span per logical operation. The span carries the operation name, the input shape (or its hash, if PII-sensitive), the outcome (`ok` / `error` / `degraded`), and the duration. No silent code paths.

**Acceptance criterion.** `node $MINSKY_HOME/scripts/check-rule-4-otel-coverage.mjs` exits 0 against the host's diff. New top-level exports under the host's `novel/` directory carry an OTEL span emission via the `Observability` adapter.

**Enforcer.** `scripts/check-rule-4-otel-coverage.mjs` (cross-repo-portable; diff-based, grandfathers existing un-annotated code).

## 4. Chaos coverage (rule #7 — chaos engineering, trust nothing unverified)

**Description.** Every novel package in the host (`novel/<name>/README.md`) carries a "Failure modes & chaos verification" section: steady-state hypothesis, blast radius, operator escape hatch, and a failure-mode table (mode | trigger / fault axis | expected behavior — `loud-crash-supervisor-restart` / `circuit-break-and-notify` / `graceful-degrade` | chaos test that reproduces it). Every user-story file carries the same.

**Acceptance criterion.** `node $MINSKY_HOME/scripts/check-rule-7-chaos-coverage.mjs` exits 0 against the host's diff. Each chaos-test referenced in a failure-mode table is actually present in `*.test.ts` and runs in CI.

**Enforcer.** `scripts/check-rule-7-chaos-coverage.mjs` (cross-repo-portable).

## 5. Experiment discipline (rule #9 — pre-registered hypothesis-driven development)

**Description.** Every non-trivial PR carries an `experiments/<id>.yaml` pre-registration with five fields: hypothesis, success threshold, pivot threshold, measurement (an exact runnable command), and literature anchor. Bugfixes are not exempt — the bugfix's hypothesis is "the recurrence rate / stability metric drops from X to Y". Vanity metrics (counts that always go up) and post-hoc metrics (chosen after seeing the result) are rejected at parse time.

**Acceptance criterion.** All four rule-#9 lints exit 0 against the host's PR: `check-anchor-primary-source.mjs`, `check-measurement-inspects-output.mjs`, `check-pivot-success-margin.mjs`, `check-no-singleton-experiment.mjs`. The PR body carries a `Hypothesis self-grade` block (Predicted / Observed / Match / Lesson, all non-empty).

**Enforcer.** `scripts/check-anchor-primary-source.mjs` + `scripts/check-measurement-inspects-output.mjs` + `scripts/check-pivot-success-margin.mjs` + `scripts/check-no-singleton-experiment.mjs` + `scripts/check-pr-self-grade.mjs` (all cross-repo-portable). The `experiment-validate` skill bundles the four rule-#9 lints behind one command.

## 6. Pattern-conformance discipline (rule #8 — every artifact maps to a published pattern)

**Description.** Every new top-level artifact in the host (file under `novel/`, root `*.md`, novel package, named architectural decision) gets a row in the host's pattern conformance index — by default `<host>/.minsky/vision.md` § "Pattern conformance index", which is symlinked to `<minsky-home>/vision.md` so the canonical pattern catalogue is shared. The row names the governing pattern, its published source, and the conformance level (`full` / `partial` / `deviation`). Silent deviation is itself a violation.

**Acceptance criterion.** `node $MINSKY_HOME/scripts/check-pattern-index.mjs` exits 0 against the host's diff. New top-level artifacts are mentioned in the index by full path, package prefix, or basename — or carry a `<!-- pattern: not-applicable — <reason> -->` opt-out in their first ~20 lines.

**Enforcer.** `scripts/check-pattern-index.mjs` (cross-repo-portable; reads the index from `<host>/.minsky/vision.md`, falls back to `<minsky-home>/vision.md` if the host hasn't customised).

## Minimum viable subset

Some hosts won't be ready for all six disciplines on day one (e.g., a legacy repo without an existing OTEL story). The minimum viable subset that *every* host must run from day one is:

- **Test discipline** (rule #3) — without paired tests, the rest of the substrate has no falsifiable foundation.
- **OTEL coverage** (rule #4) — without spans, no metric in any of the other disciplines is observable.
- **Chaos coverage** (rule #7) — without failure-mode tables, the operator escape hatch is folklore.
- **Experiment discipline** (rule #9) — the iron rule; this is the falsifiability contract.

Lint discipline (rule #2) and pattern-conformance discipline (rule #8) can be staged in via a `repo.yaml.disciplines: ["test", "otel", "chaos", "experiment"]` declaration, with the remaining two added in a follow-up PR once the host's adapter / index baseline is in place. The opt-in is recorded in the host's `.minsky/repo.yaml` and surfaced on the dashboard so the partial-conformance is visible, not silent.

## Pivot

If hosts in the wild surface a 7th discipline (e.g., supply-chain hygiene — SBOM coverage, dep-pin discipline), extend this checklist with a 7th heading rather than retiring an existing one. A 7th heading is a one-PR addition; an architectural shift would be a separate task. If hosts find the 6 disciplines over-specified for their stage, the "Minimum viable subset" callout above is the documented escape valve — not a private exemption.

## See also

- [`vision.md` § "Scope discipline"](../vision.md#12-scope-discipline-when-the-queue-empties-close-a-gap-not-add-a-feature) — rule #12, the substrate this checklist gates against.
- [`vision.md` § "Pattern conformance index"](../vision.md#pattern-conformance-index) — the index a fresh host inherits via the `.minsky/vision.md` symlink.
- [`docs/cross-repo-portability.md`](cross-repo-portability.md) — which of the rule lints are cross-repo-portable and which stay repo-local by design.
- [`user-stories/006-runner-on-any-repo.md`](../user-stories/006-runner-on-any-repo.md) — the umbrella user story; this checklist is the substrate it gates against.
- [`novel/sidecar-bootstrap/README.md`](../novel/sidecar-bootstrap/README.md) — `minsky bootstrap` writes the per-host sidecar that enables this checklist.

# Story 022 — Parsers Minsky depends on are tested against real repo data, not just hand-written samples

**Milestone(s)**: M2

> **Why this story exists.** A parser is the code that reads a file and turns its text into data Minsky can act on. Minsky leans on a few of these — the one that reads the to-do list, the one that reads experiment records — so a quiet break in any of them stops real work. PR #494 shipped exactly that kind of break: the test for the to-do-list parser only ever fed it one small hand-written sample, so every test passed while the parser silently skipped the real file. Hand-written samples drift away from the live format they are supposed to stand in for, and the test stays green because it never sees anything but the convenient shape it was written against. This is the Fake Fixture smell (Meszaros, *xUnit Test Patterns*, 2007). This story makes the fix mechanical: every parser Minsky depends on must be tested against a real slice of Minsky's own live data as well as its hand-written sample, and a script reports which parsers still lack that coverage.

Two terms used throughout, defined once:

- **Daemon**: a background program that keeps running on your machine after you start it. Minsky's daemon is what reads the to-do list and does the work.
- **TASKS.md**: the plain-text Markdown to-do list at a project's root. Minsky reads it to pick the next task.

## Story

As an agent editing the TASKS.md picker, I add a metadata field to a real task block, and the parser that reads TASKS.md must keep up with the new shape. The hand-written sample in the test suite — a literal called `SAMPLE_TASKS_MD` — never changed. A test that only fed the parser that sample would stay green even if my edit broke parsing of the real file.

It does not stay green, because the picker's test now also loads the live `TASKS.md`. My format change is exercised against the actual file the daemon reads. If the parser cannot keep up, the test fails loudly instead of passing against a stale convenient shape.

To see where coverage gaps remain, I run the audit:

```text
$ node scripts/audit-fixtures.mjs
Fixture coverage audit — Fake Fixture smell (Meszaros 2007)

  ✓ pick_task.parse_tasks_md (TASKS.md picker)
      test:   tests/test_pick_task.py [real-world+synthetic]
  ✓ build_brief.render_brief (agent brief builder)
      test:   tests/test_build_brief.py [real-world+synthetic]
  ✓ experiment-record parse (EXPERIMENT.yaml)
      test:   novel/experiment-record/src/parse.test.ts [real-world+synthetic]

  parsers with real-world fixture: 3/3 (threshold 3)
  synthetic-only parsers:          0
```

## The parsers this story covers

This is the coverage matrix the audit tracks. Each row pairs one parser whose test used to feed it ONLY a hand-written sample (the Fake Fixture risk PR #494 exposed) with the real-data fixture now added alongside it. "Real-world-derived fixture" means a slice of Minsky's own live repo data — the actual `TASKS.md` or the `experiments/*.yaml` files the daemon has written.

| Parser | Parser source | Test file | Synthetic fixture | Real-world-derived fixture |
|---|---|---|---|---|
| TASKS.md picker | `scripts/pick_task.py` | `tests/test_pick_task.py` | `SAMPLE_TASKS_MD` and siblings (hand-written literals) | the repo's live `TASKS.md` (parses ≥10 tasks, picks a rule-9-compliant task) |
| Agent brief builder | `scripts/build_brief.py` | `tests/test_build_brief.py` | brief built from `SAMPLE_TASKS_MD` | brief built from a task block picked out of the live `TASKS.md` |
| EXPERIMENT.yaml parser | `novel/experiment-record/src/parse.ts` | `novel/experiment-record/src/parse.test.ts` | `valid-{1,2,3}.yaml` test fixtures | every `experiments/*.yaml` the daemon has actually written |

## Acceptance criteria

- `scripts/audit-fixtures.mjs` lists the parser test files Minsky depends on and reports, per parser, whether its test feeds the parser only a hand-written sample or also a real-data fixture.
- The audit is deterministic (rule #10, deterministic enforcement): a test file counts as having real-world coverage only if its content carries the literal marker `REAL-WORLD FIXTURE:` — a plain substring check, no heuristic code-tree walk, no LLM.
- `node scripts/audit-fixtures.mjs --format=json` emits the Measurement object: `{ parsers, parsersTotal, parsersWithRealWorldFixture, parsersSyntheticOnly }`.
- `node scripts/audit-fixtures.mjs --strict` exits 1 when fewer than 3 parsers carry a real-data fixture, and exits 0 otherwise.
- At least 3 parsers Minsky depends on gain a paired real-data fixture lifted from Minsky's own live repo data, and every affected test file stays green.

## Metric

- **Name**: `parsers_with_real_world_fixture`
- **Definition**: `node scripts/audit-fixtures.mjs --format=json | jq '.parsersWithRealWorldFixture'` — the count of audited parsers whose test feeds the parser a real-data fixture in addition to its hand-written one.
- **Threshold**: ≥3 (the count listed in the matrix above). The metric is deliberately simple: each unit is one parser's deterministic marker presence. Rule #11 forbids load-bearing metrics that vary with no source change, and this one only moves when a parser test gains or loses the marker.
- **Source**: the audit script reading the parser test files. No network, no LLM.

## Integration test

- **File**: `scripts/audit-fixtures.test.mjs` (ships in the same PR as this story).
- **Setup**: drive the pure core `auditFixtures` with an injected fake reader for the deterministic cases (covered / synthetic-only / missing-file / no-double-count); one case runs `auditFixtures()` over the real repo manifest with the default reader.
- **Action**: assert per-parser coverage shape, the formatted table, and `parseArgs`.
- **Assert**: the shipped manifest meets the pre-registered threshold — `parsersWithRealWorldFixture >= 3` — so stripping the marker from any of the three audited parser tests fails the suite.

## Proof

- **Live**: `node scripts/audit-fixtures.mjs` prints the table above with `3/3`; `--strict` exits 0.
- **Audit**: `node scripts/audit-fixtures.mjs --format=json | jq -e '.parsersWithRealWorldFixture >= 3'` exits 0; `grep -q 'TASKS.md' tests/test_pick_task.py` exits 0.

## Failure modes & chaos verification

Per constitutional rule #7 (`vision.md` § 7).

- **Steady-state hypothesis**: every audited parser test carries the `REAL-WORLD FIXTURE:` marker and exercises the parser against live repo data; the audit reports `3/3`.
- **Blast radius**: a single test run, or a single PR. The audit never modifies code; `--strict` only rejects the build.
- **Operator escape hatch**: run without `--strict` for a report-only view. The audit exits 0 and prints the gaps rather than failing.

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | A parser test drops the real-world fixture marker | upstream-malformed (a refactor strips the marker) | `loud-crash-supervisor-restart` — the real-repo manifest test fails | `auditFixtures()` over the live manifest asserts `>= 3`; removing a marker drops the count below threshold |
| 2 | An audited test file is deleted or renamed | upstream-malformed (file moved without manifest update) | `graceful-degrade` — the missing file is reported, not crashed on | `auditFixtures` with a reader returning `null` reports `testFileExists: false` |
| 3 | The live `experiments/` glob is empty | upstream-malformed (corpus wiped) | `loud-crash-supervisor-restart` — an explicit non-empty guard fails | `parse.test.ts` asserts the live corpus is non-empty before iterating it |
| 4 | A new live record drifts from the parser's accepted shape | format drift in real data | `loud-crash-supervisor-restart` — the per-file parse assertion fails | `parse.test.ts` runs the parser over every `experiments/*.yaml`; a drifted record fails to parse |

## Pattern conformance

- **Pattern**: Fake Fixture smell remediation (Meszaros, *xUnit Test Patterns: Refactoring Test Code*, Addison-Wesley, 2007) — pair the convenient hand-written fixture with real-world data so the test exercises the actual format. Composed with real-data-driven test design (Bentley, *Programming Pearls*, 2nd ed., 1986) and the deterministic-CI-enforcement pattern (vision.md rule #10 — coverage is a grep-shaped marker check, not a hope).
- **Conformance level**: full — the audit core is a pure function over (manifest, reader); the I/O lives in the default reader and is replaceable via dependency injection for the paired test.

## Realism

This story does NOT claim:

- Every parser in the repo is audited. The manifest tracks the three parsers PR #494's failure class touches. Extending the manifest to more parsers is follow-up work (`integration-fixture-fake-fixture-smell-audit` Pivot — split per-package if >10 single-fixture parsers surface).
- Real-world fixtures replace hand-written ones. They are paired, not substituted — hand-written literals still pin specific edge cases (malformed YAML, vanity-metric rejection) the live corpus may not exercise.
- The marker proves the test is good. It proves the test loads live data; the assertions still have to be meaningful. The audit is a coverage signal, not a quality grade.

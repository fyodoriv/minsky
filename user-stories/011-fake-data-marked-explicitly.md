# Story 011 — Every stub, mock, and deprecation is marked at the point of definition

**Milestone(s)**: M1.6

> **Why this story exists.** Agents iterating on the codebase write stubs all the time — "couldn't connect to the real adapter yet, return a hardcoded user, ship the surrounding work". Without a discipline, the stub becomes load-bearing: a later agent reads it as production, builds on top, ships broken behaviour to operators. This story makes the marker convention mechanical: every stub carries a `// FAKE: …` comment with the closing task id, every `@deprecated` export carries a `// DEPRECATED: …` comment with the replacement, and a CI linter rejects any new stub-shaped pattern in `novel/*` without the marker.

## Story

As an operator reviewing a draft PR, I open the diff. One function returns a hardcoded user object. I instantly know whether this is real or a placeholder: every fake in this codebase carries a comment that says exactly what it is, why, and when it'll be replaced.

```text
// FAKE: returns hardcoded user — real fetch blocked on user-service-adapter (P1, added 2026-05-20).
// Replacement lands when novel/adapters/user-service ships its first probe.
function getUserById(id: string): User {
  return { id, name: "Placeholder", email: "placeholder@local" };
}
```

I move on without having to context-switch. Same for the deprecated export I see two screens down:

```text
// DEPRECATED: superseded by `selectBackend` — removal milestone M2 (tracked at `remove-legacy-spawn-strategy`).
// Callers must migrate before M2 ships; the @deprecated JSDoc plus this marker is the contract.
/** @deprecated */
export function legacySpawn() { ... }
```

I open `docs/FAKE-DATA-REGISTRY.md`. It lists 14 entries — each with the file path, the task id, the date added. Three of them are over 90 days old; those promote to P0 priority via a sweep script. The number is trending down because every PR that closes a task in the registry removes the marker + the registry row in the same commit. The drift-check linter would have rejected the PR otherwise.

## Acceptance criteria

- The canonical FAKE marker convention is documented in `vision.md` (rule #18) and `AGENTS.md` (the agent-readable rule list).
- Every fake has a single-line marker comment with three required fields: a one-line reason, a backticked task id (must resolve to a `**ID**:` in `TASKS.md`), and a date (`added YYYY-MM-DD`).

  ```text
  // FAKE: <one-line reason> — tracked at `<task-id>` (added YYYY-MM-DD).
  ```

- Every `@deprecated` JSDoc export carries the parallel DEPRECATED marker with replacement + removal-milestone fields, AND a row in `DEPRECATED.md` for the same item.

  ```text
  // DEPRECATED: <reason> — replacement: `<replacement-path>` — removal milestone M<N>. Tracked at `<task-id>`.
  ```

- `scripts/check-rule-18-explicit-fake-marker.mjs` detects the **obvious** stub patterns in `novel/*/src/` and `bin/*` (NOT test code, NOT fixtures):
  - A function body that consists ENTIRELY of `return <literal>` (string/number/object/array literal with no parameter references) and has no I/O / network / fs call
  - A top-level `const FOO = <literal>` whose name suggests config (`API_URL`, `*_KEY`, `*_HOST`, `BASE_URL`, etc.) — and no nearby `process.env.*` access
  - Any export with `@deprecated` JSDoc tag
  Each detection requires either the marker comment OR a `// not-fake: <reason>` opt-out comment on the line above. The opt-out is the operator escape hatch for false positives.
- `docs/FAKE-DATA-REGISTRY.md` is the central index. Every `// FAKE:` in the codebase appears as a row in the registry; every registry row corresponds to at least one marker in the codebase. Drift between the two is a CI failure.
- Test code is exempt: `*.test.ts`, `*.test.mjs`, `*.fixture.ts`, anything under `test/fixtures/` or `**/__tests__/`. Test fakes are intentional and the linter trusts their location.
- The linter wires into `scripts/run-pre-pr-lint-stack.mjs` at the `full` stage (not `fast` — the AST walk is slower than the cheap greps). For `fast` stage, only the grep-based marker-presence check runs.
- After 8 weeks in production, the registry's `fake_data_registry_size` metric trends down for ≥4 consecutive weeks — the registry is a punch list that gets shorter, not a permanent feature.

## Metric

- **Name**: `fake_data_registry_size`
- **Definition**: total count of distinct entries in `docs/FAKE-DATA-REGISTRY.md` (`grep -c "^### " docs/FAKE-DATA-REGISTRY.md`). A "deprecation pressure" sibling metric counts `DEPRECATED.md` entries (`grep -c "^### " DEPRECATED.md`).
- **Threshold**: monotonic decline over 4-week rolling window for ≥4 consecutive weeks AFTER the initial backfill stabilises. Acceptable transient growth: ≤2 entries added per week (new stubs intentionally introduced during a feature spike); the decline must dominate over 4 weeks.
- **Source**: the registry file itself, parsed by a weekly script. The metric is deliberately simple — every entry is one human's decision; rule #11 forbids load-bearing metrics that vary with no operator change, and this one doesn't.

## Integration test

- **File**: `user-stories/011-fake-data-marked-explicitly.test.ts` (new; ships in the same PR as this story; activates against the linter once `scripts/check-rule-18-explicit-fake-marker.mjs` lands — the P0 task body covers the linter implementation).
- **Setup**:
  - Fixture packages at `test/fixtures/fake-data/`:
    - `good-stub/` — has `src/index.ts` returning a hardcoded object WITH the canonical `// FAKE:` marker referencing a fixture task id
    - `bad-stub/` — has `src/index.ts` returning a hardcoded object with NO marker
    - `false-positive/` — has `src/index.ts` returning a hardcoded enum value (genuine constant, not a fake) with the `// not-fake: enum value, intentional` opt-out comment
    - `bad-deprecation/` — has `src/index.ts` exporting an `@deprecated` function with NO `// DEPRECATED:` marker
    - `good-deprecation/` — has both the JSDoc and the marker comment
    - `drift/` — has a marker in code but NO corresponding row in a fixture `FAKE-DATA-REGISTRY.md` (test the drift check)
  - The linter accepts `--fixture <dir>` and `--registry <path>` to override paths for test runs
- **Action**: run `node scripts/check-rule-18-explicit-fake-marker.mjs --fixture <each>` against each fixture
- **Assert**:
  - `good-stub`: exits 0 with `[ok] rule-18: <pkg>: PASS (1 marked fake)`
  - `bad-stub`: exits 1 with stderr naming the offending file:line and the missing marker
  - `false-positive`: exits 0 — the opt-out marker satisfies the linter
  - `bad-deprecation`: exits 1 with stderr naming the `@deprecated` symbol missing the parallel marker
  - `good-deprecation`: exits 0
  - `drift`: exits 1 with stderr naming the marker that has no registry row AND any registry row that has no marker (both directions of drift surface)

## Proof

- **Live**: `pnpm pre-pr-lint --stage=full` emits `[ok] rule-18-explicit-fake-marker` on a clean repo; emits `[FAIL]` with the file:line on a repo where a `novel/*/src/` introduces an unmarked stub.
- **Dashboard**: per-week chart of `fake_data_registry_size` + `deprecated_md_size`; both should trend down post-backfill.
- **Audit**: `git log --grep "FAKE-DATA-REGISTRY" --all` shows every registry mutation as a tracked commit; `grep -rE "// (FAKE|DEPRECATED):" novel/ bin/` shows every marker with file:line for any audit.
- **Notification**: weekly digest push (off by default) when the registry has entries older than 90 days — they auto-promote to P0 priority.

## Failure modes & chaos verification

Per constitutional rule #7 (`vision.md` § 7).

- **Steady-state hypothesis**: every stub-shaped pattern in `novel/*/src/` carries the canonical marker; every marker has a registry row; every registry row has at least one marker. Drift is impossible because the linter is in the `full` lint stack and the `full` stack runs on every PR.
- **Blast radius**: a single PR. The linter never modifies code; it only rejects the build. Worst case: a PR is blocked until the agent or human adds the marker (and the registry row).
- **Operator escape hatch**: the `// not-fake: <reason>` opt-out marker on the offending line. The reason text is grepable (`grep -rE "// not-fake:" novel/`) so opt-out abuse is auditable.

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | New stub function added with no marker | upstream-malformed (agent skipped marker) | `loud-crash-supervisor-restart` — block PR | Fixture `bad-stub/` → linter exits 1 with file:line |
| 2 | Marker present in code but no registry row | upstream-malformed (forgot registry update) | `loud-crash-supervisor-restart` — drift check trips | Fixture `drift-marker-only/` → linter exits 1 naming the missing registry row |
| 3 | Registry row present but no marker in code (stub removed without registry cleanup) | upstream-malformed (PR removed code, forgot registry) | `loud-crash-supervisor-restart` — drift check trips in the reverse direction | Fixture `drift-registry-only/` → linter exits 1 naming the orphan row |
| 4 | Marker references task id that doesn't exist in `TASKS.md` | upstream-malformed (typo or stale task id) | `loud-crash-supervisor-restart` — block PR | Fixture marker citing `bogus-task-id` → linter exits 1 with "task id `bogus-task-id` not found in `TASKS.md`" |
| 5 | Marker missing the date field | upstream-malformed (incomplete marker) | `loud-crash-supervisor-restart` | Fixture marker without `(added YYYY-MM-DD)` → linter exits 1 naming the missing field |
| 6 | Linter false positive on a genuine constant (e.g., `const HTTP_OK = 200`) | linter heuristic limitation | `graceful-degrade` — operator adds `// not-fake: HTTP status code constant` | Fixture with `HTTP_OK = 200` + opt-out comment → linter passes |
| 7 | Test code that intentionally stubs (e.g., `vi.fn().mockReturnValue(...)`) | test fixture | `graceful-degrade` — exempt by path | Fixture under `test/fixtures/` with unmarked stubs → linter passes (path-based whitelist) |
| 8 | Marker has the wrong type of quote / mangled formatting (`// FAKE returns hardcoded user`) | upstream-malformed (paraphrased marker) | `loud-crash-supervisor-restart` — block PR | Fixture with malformed marker syntax → linter exits 1 with the canonical-format example |
| 9 | Agent writes semantically-fake code that LOOKS real (no literal return, no `@deprecated`, but the function always errors / returns degenerate output) | LLM hallucination — beyond linter scope | `circuit-break-and-notify` — caught by the next iteration's CTO audit or by integration tests; flagged in PR review by humans | Cannot chaos-test mechanically. Mitigation: the integration-test contract in this story's `## Integration test` section above plus rule-#7 chaos coverage for the package. The linter doesn't claim to catch this class. |
| 10 | Registry has entries older than 90 days | operator process drift | `circuit-break-and-notify` — weekly sweep emits a notification AND promotes those entries' tasks to P0 | Synthetic registry with entries from 6 months ago → sweep script lists them, the linked tasks auto-promote |

## Status

- **Phase**: NOT YET IMPLEMENTED. The story is the spec for the P0 task `fake-data-and-deprecation-marker-discipline`. Today the codebase has zero `// FAKE:` markers (no enforced convention) and `DEPRECATED.md` is a human-maintained list that drifts from the actual `@deprecated` JSDoc tags. The integration test `user-stories/011-fake-data-marked-explicitly.test.ts` lands as a `describe.skipIf(!process.env.MINSKY_RULE_18_ENABLED)` and activates when the linter ships.
- **Blocking**: the P0 implementation (linter + initial backfill of existing stubs + registry seed).
- **Theoretical anchor**: rule #18 (new — vision.md § 18 added by this task); composed with rule #10 (deterministic enforcement — the discipline is a CI lint, not a hope) and rule #11 (no flaky metric is load-bearing — `fake_data_registry_size` is deliberately simple to keep it deterministic).

## Pattern conformance

- **Pattern**: explicit-over-implicit principle (Hunt & Thomas, *The Pragmatic Programmer*, Addison-Wesley 1999, Ch. 8 — "There are no broken windows"; every unmarked stub is a broken window). Composed with the deterministic-CI-enforcement pattern (vision.md rule #10) and the registry-as-punch-list pattern (Beck, *Extreme Programming Explained*, 1999, Ch. 17 — visible debt is debt that gets paid down).
- **Conformance level**: aspirational (not yet implemented; full conformance once the P0 ships, the linter is in `--stage=full`, and the registry is populated by the initial backfill sweep).
- **Index row**: vision.md § "Pattern conformance index" — row TBD, to be added in the P0 PR that ships the linter alongside the new rule #18 entry in the constitution.

## Realism

This story does NOT claim:

- Every fake in the codebase is mechanically detectable. The linter catches obvious stub shapes (literal returns, `@deprecated` JSDoc, suspicious config constants); it does NOT catch semantically-fake code that looks real (LLM hallucinations, plausible-but-wrong implementations). Failure mode #9 above documents this limitation explicitly.
- The initial backfill is painless. Day-1 of the linter shipping, every existing unmarked stub fails the build. The backfill is its own task (`fake-data-initial-backfill-sweep` P1, filed alongside the P0) that runs the linter in warn-only mode for one week, captures the offenders, and adds canonical markers to all of them. Only after backfill does the linter flip to fail-mode.
- False positives never happen. They will. The `// not-fake: <reason>` opt-out is the explicit escape hatch — operator decides; the opt-out is grepable for audit.
- Test-code is unaudited. Tests SHOULD have fakes; that's their job. The path-based exemption (`*.test.ts`, `test/fixtures/`, `__tests__/`) is deliberate. The boundary between "production code can't be fake" and "test code must be fake" is the path discipline.
- Deprecation warnings appear at runtime. The linter only checks definition sites. Runtime deprecation logs are a separate concern (tracked at `runtime-deprecation-emit-warnings` P2 if filed).

What this story DOES claim: at the point of definition, every stub and every deprecation is explicitly marked. Anyone reviewing a diff — human or agent — can tell the real from the fake in 2 seconds. The registry is the punch list; the linter enforces the marker discipline mechanically.

## Security & privacy

(Per vision.md rule #13 — security & privacy second priority after performance.)

- **Trust boundary**: the linter reads source files under the operator's control. No external data ingested.
- **Secrets**: a hardcoded secret in a stub is a separate (more critical) failure caught by `scripts/scan-secrets.mjs`. This linter does NOT replace the secret-scan; it complements it (a stub with a fake API key would trip both linters).
- **PII**: the FAKE marker text is operator-authored and may name systems / agents / dates; no automated extraction of PII.
- **Performance carve-out**: the linter's AST walk over `novel/*/src/` is O(file count × file size). For the current repo (~80 source files), one full sweep takes <1s. If the repo grows past 10k source files, the linter caps per-file walk time and emits a "incomplete-sweep" warning rather than hanging.

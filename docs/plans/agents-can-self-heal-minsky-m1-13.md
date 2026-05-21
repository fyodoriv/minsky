# Plan: `agents-can-self-heal-minsky-m1-13`

- **Task**: `agents-can-self-heal-minsky-m1-13` (TASKS.md line 96 — P0, milestone M1.13)
- **Repo**: `<minsky-repo>`
- **Author**: claude-opus-4-7-max session 2026-05-20
- **Status**: validated (post-revision) — round 1 caught 4 blocking issues; round 2 pending
- **Validated-by**: reviewer-subagent 2026-05-20 (round 1: needs-revision; round 2 verdict appended below)
- **Closes**: **partial M1.13 — phase 1 of 2**. This PR ships 4 automated heals (3 newly written + 1 new stuck-command class) plus the MTTR ledger + reporter + chaos substrate. The remaining 6 catalogue entries stay as operator-recipes for v2 (`promote-remaining-heal-recipes`, filed in scope-out below). The parent TASKS.md task's Success field is updated in the same PR to reflect this phasing — the ≥10 threshold moves from "automated helpers" to "catalogued failure modes (some automated, some operator-recipe, MTTR measured for all that fire)".
- **Blocked by**: `feat/fleet-stability-centralized-reporting` (PR #673 in flight this session) — the heal-mttr-report.mjs reporter mirrors the shape of the just-shipped `scripts/stability-report.mjs` and reuses its window/jq conventions. Block resolves automatically when PR #673 merges (file appears at `scripts/stability-report.mjs` on main). If #673 fails to merge, the helper interface to copy is in `scripts/stability-number.mjs` (the pre-refactor single-window version) — substantively the same shape minus multi-window support.

## Goal

Promote the Observer skill's heal catalogue from 10 operator-recipes to **a partially-automated catalogue with measured MTTR**: 3 newly-written automated heal helpers + 1 new stuck-command class (= 4 automated), the remaining 6 documented as operator-recipes, and an MTTR ledger + reporter + chaos test that measures every catalogued failure that fires. Publishes a real `mttr-self-heal` METRICS.md value for the automated subset. **Phase 1 of M1.13's ≥10-automated target** — phase 2 ships the remaining 6 promotions via the follow-up task `promote-remaining-heal-recipes`.

## Why

MILESTONES.md M1.13 acceptance criteria:

> "Observer skill catalogs ≥10 failure modes with automated fixes; MTTR for catalogued failures < 5 min"

Today (audited 2026-05-20):

- The skill file `skill-plugins/observer/minsky/SKILL.md` § 4 "Safe-heal" has 10 entries — meets the count.
- But the entries are **recipes**, not **automated fixes**. Examples: "stale PID file" says `rm -f ~/.minsky/daemon.pid then retry` — that's an instruction to the operator, not something the agent can execute autonomously without intent. The catalogue is a runbook, not a self-heal system.
- **MTTR is unmeasured anywhere.** The `mttr` row in METRICS.md is a stub ("requires OTEL backend"). No ledger captures `failure observed → fix applied → duration_ms` for the catalogued classes.
- The just-shipped `stuck-command-detection` rule (templates/AGENTS.md, this session) is a new failure class that should be in the catalogue but isn't.

The work is converting catalogue-recipes into runnable helpers, building the ledger + reporter, wiring into METRICS.md.

## Scope (in)

Five concrete deliverables, each shipped in its own PR-sized commit:

- **(a) Catalogue audit + classification** — add a new column to the §4 table: `Status` ∈ {`automated` | `operator-recipe` | `blocked-by-policy`}. For each of the 10 entries, classify honestly. The new stuck-command entry is added in the same commit.

- **(b) Promote ≥3 high-frequency operator-recipes to automated `heal-<name>.mjs` helpers** in a new package `novel/observer/heals/`. Each helper:
  - Is a pure-with-I/O-at-edge module exporting `detect()`, `apply()`, and `verify()`.
  - Has paired tests covering detection precision (no false positives on healthy state), idempotency (applying twice doesn't break things), and rollback on verify-failure.
  - Targets the three operator-recipes most-observed in `~/.minsky/daemon.log`: stale PID file, `MODULE_NOT_FOUND` from biome/lefthook (worktree missing node_modules), stale `.tsbuildinfo` after node-version flip.

- **(c) MTTR ledger** at `.minsky/heal-events.jsonl` — append-only JSONL with one entry per heal attempt: `{ts_observed, ts_fixed, failure_class, fix_applied, duration_ms, host, outcome: "healed" | "verified-failed" | "skipped"}`. Writer is a small helper in `novel/observer/heals/ledger.mjs`; every heal helper calls it after `verify()`.

- **(d) Reporter `scripts/heal-mttr-report.mjs`** — same shape as the just-shipped `scripts/stability-report.mjs`. Multi-window (`--window=24h|7d|30d`), JSON-array output, per-window `{successful, attempted, mttr_p50_ms, mttr_p95_ms}`. Paired tests reuse the `makeFixtureHost` helper pattern.

- **(e) Wire into METRICS.md + collect-metrics** — new `mttr-self-heal` metric collector in `scripts/collect-metrics.mjs` delegating to `heal-mttr-report.mjs --window=30d --json`. METRICS.md gets a new entry with the real value when data exists; otherwise the OTEL-blocked stub message (same fallback pattern as the new `loop-uptime`).

- **(f) Chaos test** at `novel/observer/test/chaos/heal-catalogue-mttr.test.mjs` — for each catalogued failure, inject the signal into a fixture host (write a sentinel file, set an env var, etc.), invoke the heal helper, assert `verify()` returns OK, and assert the ledger gained a row with `duration_ms < 300_000`.

- **(g) vision.md pattern-conformance row** for `novel/observer/heals/` — pattern: SRE on-call automation (Beyer 2016 Ch. 6 "Effective Troubleshooting" + Ch. 11 "Being On-Call"), conformance: full. Required by constitutional rule #8.

## Scope (out, deferred to follow-up tasks)

- **Automated heal for the remaining 7 operator-recipes** beyond the 3 promoted in (b). Those stay `operator-recipe` until each is independently scoped — some require operator confirmation by design (e.g. `node: command not found` is a host-setup issue minsky shouldn't auto-fix; setting `NODE_VERSION=20` in someone's shell is out-of-policy). Follow-up filed as `promote-remaining-heal-recipes`.

- **Real OTEL `mttr` measurement** — the existing OTEL-blocked `mttr` row in METRICS.md covers general supervisor restart-to-claim latency across all failure classes. This task only ships `mttr-self-heal` for the catalogued subset. The general OTEL `mttr` stays blocked on the OTEL backend task (already filed; not this PR's scope).

- **Cross-host heal aggregation** — analogous to `fleet-stability-report.mjs`'s shared-filesystem aggregation. The per-host ledger is the substrate; a fleet-wide heal report can be added later when ≥2 hosts run heals. Follow-up: `fleet-heal-mttr-report`.

- **Promotion of `claude-spec-monitor` advisory findings to automated heals** — the spec-monitor Skill flags rule violations as advisory text. Promoting those to heal-helpers is a separate, larger effort tracked under rule #10's deterministic-enforcement ratchet.

## Implementation steps

### Step 0: Acceptance scenarios (Given/When/Then) — prerequisite for any test (rule #3)

Per AGENTS.md rule #3 ("Test-first, metric-first"): before any test file is written, the acceptance criteria the test will assert must exist as Given/When/Then scenarios.

Create `.minsky/specs/agents-can-self-heal-minsky-m1-13.md` with one scenario block per heal helper + one for the reporter + one for the ledger. Format (copy from existing specs under `.minsky/specs/` if any; otherwise this is the template):

```markdown
# Scenarios: agents-can-self-heal-minsky-m1-13

## Scenario: heal-stale-pid detects and removes a pid file pointing at a dead process

- **Given** ~/.minsky/daemon.pid exists with content "99999\n"
- **And** kill(0, 99999) returns ESRCH
- **When** heal-stale-pid.apply({fs, hostDir}) runs
- **Then** the pid file no longer exists
- **And** heal-stale-pid.verify({fs, hostDir}) returns { healed: true }
- **And** an entry was appended to .minsky/heal-events.jsonl with failure_class="stale-pid" and outcome="healed"

## Scenario: heal-stale-pid is a no-op when the pid is alive

- **Given** ~/.minsky/daemon.pid exists with content matching the current process pid
- **When** heal-stale-pid.detect({fs, hostDir}) runs
- **Then** it returns { present: false }
- **And** apply() is not called

(...one block per helper, one for the ledger writer, one for the reporter per-window output, one for the chaos test scope...)
```

The scenarios file is **created in the first commit** (before any test file), and each `test()` block in Step 2/3/4/6 references the scenario it asserts by name in a comment: `// scenario: heal-stale-pid detects and removes a pid file pointing at a dead process`.

This is the constitutional gate. Skipping Step 0 fails rule #3 and the deterministic CI lint (`scripts/check-spec-coverage.mjs`, if it exists — else file as P2 task in same PR).

### Step 1: Catalogue audit (deliverable a)

- Edit `skill-plugins/observer/minsky/SKILL.md` § 4 "Heal catalogue" table — add a `Status` column. **Pre-classified by this plan to make the arithmetic explicit**:
  - `automated` — agent runs the fix without human confirmation. **After this PR: 4 entries** (the 3 added in Step 2 + the new stuck-command row).
  - `operator-recipe` — recipe text, requires operator action. **After this PR: 6 entries** (the remaining 6 today + 0 new). Carried into v2 (`promote-remaining-heal-recipes`).
  - `blocked-by-policy` — automating would touch out-of-policy resources (e.g. shell env vars in user's interactive session). **After this PR: 1 entry** (the `node: command not found` row — the recipe to set `NODE_VERSION=20` in the user's shell is out-of-policy by design).
- Total catalogued failure modes after this PR: **11** (10 existing + 1 new stuck-command). Of those, **4 automated, 6 operator-recipe, 1 blocked-by-policy**. The parent TASKS.md Success field is updated in the same commit to the phased thresholds: "this PR: ≥4 automated heals + ≥11 catalogued + MTTR measured; v2 follow-up: ≥10 automated".
- Add the new row for the stuck-command detection class from this session's `templates/AGENTS.md` § "Stuck-command detection & recovery". Signal: ≥3 polls with no new output. Heal: `kill_shell + retry narrowly`. Status: `automated`.
  - **Wiring clarification**: the stuck-command heal lives at `novel/observer/heals/heal-stuck-command.mjs` and is invoked by the **agent runtime's shell-polling loop** (not the daemon), which already tracks "polls since last byte" per shell. When that counter hits 3, the loop calls `detect()` on `heal-stuck-command.mjs` with the shell id; `apply()` runs `kill_shell` + records the event in the ledger; `verify()` is `kill -0 <pid>` returning non-zero. The agent then chooses a narrower command. This wiring is in the agent's polling loop, not the heal helper — the helper is just the deterministic detect/apply/verify subset.
- Same-commit: update the §4 introduction paragraph to reference the audit-by-status (4/6/1 split), not just "10 entries".

### Step 2: Three automated heal helpers + paired tests (deliverable b)

Create the `novel/observer/heals/` package (new pnpm workspace) with `package.json`, `tsconfig.json`, `vitest.config.ts`. Reference existing `novel/competitive-benchmark/` package shape (just-shipped this session via PR #670 plan).

Three helpers, each a `.mjs` file with the interface:

```js
// novel/observer/heals/heal-<name>.mjs

/**
 * Detect whether this failure mode is present right now.
 * Pure-with-I/O-at-edge: takes injected fs seam, returns a result.
 * @returns {Promise<{ present: boolean, signal: string, evidence: object }>}
 */
export async function detect({ fs, hostDir }) { ... }

/**
 * Apply the fix. Idempotent — calling twice must not break things.
 * @returns {Promise<{ applied: boolean, changedFiles: string[] }>}
 */
export async function apply({ fs, hostDir }) { ... }

/**
 * Re-detect after apply. If verify says "still present", apply failed.
 * @returns {Promise<{ healed: boolean, residualSignal?: string }>}
 */
export async function verify({ fs, hostDir }) { ... }
```

Three helpers to ship:

1. **`heal-stale-pid.mjs`** — Detect: `~/.minsky/daemon.pid` exists AND `kill -0 <pid>` fails. Apply: `unlinkSync(pidPath)`. Verify: `existsSync(pidPath) === false`. Most-frequent failure mode (already noted in §4 as "the #1 most common issue").
2. **`heal-worktree-missing-node-modules.mjs`** — Detect: cwd is under `.worktrees/` AND `node_modules` is missing AND `package.json` exists. Apply: `execFileSync("pnpm", ["install", "--prefer-offline"], { cwd })`. Verify: `node_modules/.bin/biome` exists. Surfaced by the lefthook pre-push failures (this session).
3. **`heal-stale-tsbuildinfo.mjs`** — Detect: `.tsbuildinfo` files reference a node version that doesn't match the running node. Apply: `unlinkSync` each stale .tsbuildinfo. Verify: `tsc -b` exits 0 in <10s on next invocation.

Paired tests `heal-<name>.test.mjs` cover (each helper): healthy-host (detect returns `present: false`, apply is a no-op), present-signal (detect returns `present: true`, apply changes state, verify confirms), idempotent-replay (applying twice doesn't change anything), rollback-on-verify-failure (when verify fails after apply, the helper returns `healed: false` with a residualSignal — does NOT throw).

### Step 3: MTTR ledger writer (deliverable c)

Write `novel/observer/heals/ledger.mjs`:

```js
/**
 * Append a heal event to .minsky/heal-events.jsonl. Pure-with-I/O-at-edge.
 * @param {{ ts_observed: string, ts_fixed: string, failure_class: string, fix_applied: string, duration_ms: number, host: string, outcome: "healed" | "verified-failed" | "skipped" }} event
 */
export function recordHealEvent({ event, ledgerPath, appendFileSyncFn }) { ... }
```

Paired test verifies: appends one line per call, JSON-parseable, monotonic `ts_observed`, missing directory is auto-created (per rule #6 graceful-degrade at the boundary).

Wire `recordHealEvent` into each of the three Step-2 helpers' `apply()` paths (success and failure).

### Step 4: Reporter + tests (deliverable d)

Write `scripts/heal-mttr-report.mjs` mirroring `scripts/stability-report.mjs`'s shape:

- CLI: `--window=24h|7d|30d` (repeatable), `--host-dir <path>`, `--json`, `--now <iso>` (test seam).
- Reads `<host-dir>/.minsky/heal-events.jsonl`, computes per-window stats.
- Output array element: `{ window, attempted, successful, mttr_p50_ms, mttr_p95_ms, source: "heal-events" | "no-data" }`.

Paired test `scripts/heal-mttr-report.test.mjs` reuses the `makeFixtureHost` pattern from the just-shipped `scripts/stability-report.test.mjs`.

### Step 5: METRICS.md + collect-metrics wiring (deliverable e)

- Add new `collectMttrSelfHeal` function in `scripts/collect-metrics.mjs` — same shape as the recently-updated `collectLoopUptime`: delegate to `node scripts/heal-mttr-report.mjs --window=30d --json`, extract `successful` + `mttr_p95_ms`, fall back to stub when the ledger is empty.
- Add `mttr-self-heal` entry to METRICS.md with the real value formula.
- Update the existing `mttr` entry's footnote to cross-reference `mttr-self-heal` as the catalogued-failures subset.

### Step 6: Chaos test (deliverable f)

Write `novel/observer/test/chaos/heal-catalogue-mttr.test.mjs`:

```js
describe("heal catalogue chaos", () => {
  test.each(catalogueEntries)("heal %s within 5 min", async ({ id, helper }) => {
    const host = makeFixtureHost(/* inject failure-class signal */);
    const tsObserved = Date.now();
    const { present } = await helper.detect({ fs, hostDir: host });
    expect(present).toBe(true);
    await helper.apply({ fs, hostDir: host });
    const { healed } = await helper.verify({ fs, hostDir: host });
    expect(healed).toBe(true);
    const duration = Date.now() - tsObserved;
    expect(duration).toBeLessThan(300_000); // 5 min
  });
});
```

Test count: **≥4** (one per Step-2 helper + the new stuck-command helper). Each runs in <5s with the fixture seams.

**Injection table** (each `makeFixtureHost(/* ... */)` arg, explicit so the reviewer can confirm the test asserts what it claims):

| Helper                                  | Injection method                                                                                       | Verify-failure case                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `heal-stale-pid.mjs`                    | `fs.writeFileSync(pidPath, "99999\n")` — pid 99999 is reliably dead                                    | After apply, write pid file again to confirm idempotency                     |
| `heal-worktree-missing-node-modules.mjs`| Fixture host has `package.json` but no `node_modules/`; mock `pnpm install` via a stub binary in PATH  | After apply (stub succeeds), unlink stub `node_modules/.bin/biome` to assert verify returns `healed: false`|
| `heal-stale-tsbuildinfo.mjs`            | `fs.writeFileSync(".tsbuildinfo", JSON.stringify({version: "old-node-18"}))` while running node 20    | Two consecutive writes to confirm idempotent unlink                          |
| `heal-stuck-command.mjs`                | Spawn a child process running `sleep 1000`; pass its pid as the shell id                               | After apply (kill), call apply again — should return `applied: false` (already gone) |

Each row in the table maps to a `test()` block. The chaos test uses `test.each(catalogueEntries)` and reads catalogueEntries from the same `novel/observer/heals/index.mjs` registry so adding a new helper auto-extends the chaos suite (rule #10 — deterministic enforcement of new-heal-must-have-chaos-test).

### Step 7: vision.md pattern-conformance row (deliverable g)

Add row 90 to `vision.md` § "Pattern conformance index":

> 90 | `novel/observer/heals/` + `scripts/heal-mttr-report.mjs` + chaos test (the automated heal catalogue + MTTR ledger for the Observer skill) | SRE on-call automation (`detect → apply → verify` per heal; MTTR as the SLI) | Beyer, B., Jones, C., Petoff, J., Murphy, N.R., *Site Reliability Engineering*, O'Reilly 2016, Ch. 6 "Effective Troubleshooting" + Ch. 11 "Being On-Call" | full | <conformance notes>

Required by constitutional rule #8 ("every new top-level artifact adds a row in the same commit").

## Risks and mitigations

- **Risk: heal helpers race other agents.** Two agents on the same host both try `heal-stale-pid.mjs` at once → race on the unlink + retry.
  - Mitigation: each helper acquires a short-lived advisory lock at `~/.minsky/heal-locks/<name>.lock`. Lock file contains `{pid, ts_acquired_ms, hostname}`. **Lock-staleness rule (deterministic, no second-level heal needed)**: on entry, if `kill -0 <pid>` fails OR `Date.now() - ts_acquired_ms > 600_000` (10 min), the lock is reclaimable — overwrite atomically with current pid+ts. Released by `unlinkSync` after `verify()`. Released by a `finally` block on any throw inside the helper. No infinite-regression: the staleness check is in-process pure arithmetic + a kill(0) syscall, not another heal helper.

- **Risk: false-positive detection causes destructive `apply`.** A `heal-stale-tsbuildinfo.mjs` that mis-classifies a healthy `.tsbuildinfo` as stale would delete it and force a full rebuild — slow but recoverable. Worse if a helper deletes something irreplaceable.
  - Mitigation: every helper's `apply()` operates only inside `.minsky/`, `node_modules/`, `.tsbuildinfo` files (build artifacts — regeneratable by definition). NEVER inside source code, NEVER outside the worktree. Encoded in the helper's top-of-file comment + a deterministic CI lint (`scripts/check-heal-blast-radius.mjs`) that fails if a helper's `apply()` writes outside the allowed paths.

- **Risk: the MTTR target of 5 min is too generous and masks slow heals.** Plot p95 in METRICS.md so a heal that's "barely under 5 min" is visible.
  - Mitigation: the report exposes both p50 AND p95. METRICS.md shows p95. If p95 trends toward 4 min, that's a signal to investigate before crossing the threshold.

- **Risk: heal-events.jsonl grows unbounded.** A daemon running for 30 days could accumulate thousands of entries.
  - Mitigation: same shape as `experiment-store/*.jsonl` (already grows similarly; no rotation today). If size becomes a concern, add a separate rotation task. For M1.13, the metric only reads the last 30 days; older entries are harmless.

- **Risk: chaos test injection has side effects.** Injecting a `failure_class === "stale-pid"` requires actually writing a fake PID file; if the test forgets to clean up, the next test sees stale state.
  - Mitigation: every chaos test runs in `mkdtempSync` and cleans on teardown. Same hermetic pattern as the just-shipped `scripts/stability-report.test.mjs`.

- **Risk: the new `novel/observer/heals/` package adds workspace surface; if the package's `prepare` hook fails, the WHOLE `pnpm install` fails (affecting every other agent on the box).**
  - Mitigation: the package's `prepare` hook is `tsc -b` only — same as every other novel package. The added surface is one new workspace, not new build infrastructure.

- **Risk: helpers depend on host-specific paths that don't exist on a fresh checkout.**
  - Mitigation: each `detect()` is short-circuited to `present: false` when the expected path doesn't exist (e.g. fresh checkout has no `~/.minsky/daemon.pid` → `heal-stale-pid` returns `present: false`, not a crash).

## Acceptance criteria

Each criterion has a runnable command. All commands run from the worktree root.

0. **Spec scenarios exist before tests**: `test -f .minsky/specs/agents-can-self-heal-minsky-m1-13.md && grep -c "^## Scenario" .minsky/specs/agents-can-self-heal-minsky-m1-13.md` returns ≥6.
1. **Audit landed with Status column**: `grep -c "Status" skill-plugins/observer/minsky/SKILL.md` ≥1 inside §4; `grep -c "stuck-command" skill-plugins/observer/minsky/SKILL.md` ≥1.
2. **≥4 automated heal helpers exist** (3 step-2 + stuck-command): `find novel/observer/heals -name "heal-*.mjs" -not -name "*.test.mjs" | wc -l` ≥ 4.
3. **Each helper has paired tests**: `find novel/observer/heals -name "heal-*.test.mjs" | wc -l` ≥ 4, all passing under `pnpm vitest run novel/observer/heals --testTimeout=10000`.
4. **MTTR ledger writer + reporter exist**: `test -f novel/observer/heals/ledger.mjs && test -f scripts/heal-mttr-report.mjs`.
5. **Reporter produces correct JSON**: against a 3-event fixture (1 healed + 1 verified-failed + 1 skipped), `node scripts/heal-mttr-report.mjs --window=7d --host-dir <fixture> --now <iso> --json | jq '.[0].successful'` returns `1`; `.attempted` returns `3`; `.mttr_p50_ms` is a number.
6. **METRICS.md has `mttr-self-heal`**: `grep -c "^## mttr-self-heal" METRICS.md` returns `1`.
7. **Chaos test green with ≥4 tests**: `pnpm vitest run novel/observer/test/chaos/heal-catalogue-mttr.test.mjs --testTimeout=10000 --reporter=verbose 2>&1 | grep -c "✓"` ≥ 4.
8. **Pattern conformance row added**: `grep -c "novel/observer/heals" vision.md` ≥ 1.
9. **Parent TASKS.md Success field updated to phase-1 thresholds**: `grep -A1 "agents-can-self-heal-minsky-m1-13" TASKS.md | grep -c "≥4 automated\|phase 1"` ≥ 1.
10. **Follow-up task filed**: `grep -c "promote-remaining-heal-recipes" TASKS.md` ≥ 1.
11. **Full `pre-pr-lint --stage=full`** green; `pnpm vitest run scripts/heal-mttr-report.test.mjs novel/observer/heals` green with ≥15 tests (4 helpers × ~3 tests + ledger ~3 + reporter ~3 + chaos ≥4 = ~22 minimum).

## Workflow gate (precondition for first code commit)

Per the `/next-task` "Plan and validate" workflow shipped earlier this session:

```bash
awk '/^## Reviewer verdict$/,0' docs/plans/agents-can-self-heal-minsky-m1-13.md \
  | grep '^- \*\*Verdict\*\*:' | tail -1 | grep -q approved
```

Must return 0 before any commit to the files in Step 2-7.

## Rollout

- v1 (this plan, ~7 commits in one PR): the catalogue audit + 3 automated heals + ledger + reporter + chaos test + METRICS.md + vision.md row.
- v2 (separate task `promote-remaining-heal-recipes`): promote the remaining 7 operator-recipes to automated where policy allows.
- v3 (separate task `fleet-heal-mttr-report`): cross-host MTTR aggregation, analogous to `fleet-stability-report.mjs`.
- v4 (separate task — already-planned): real OTEL `mttr` for the general restart-to-claim case, replaces the stub in METRICS.md.

## Reviewer verdict

### Round 1 (2026-05-20)

- **Verdict**: needs-revision
- **Reviewer**: reviewer-subagent (claude-opus-4-7-max)
- **Blocking**: (1) milestone arithmetic 4 vs ≥10; (2) `scripts/stability-report.mjs` ref doesn't exist at base; (3) lock staleness heuristic unspecified; (4) GWT scenarios missing per rule #3.
- **Design concerns** (non-blocking): workspace setup, ledger growth, stuck-command wiring, chaos injection underspecified.
- **Action**: revised plan to address all 4 blocking + 4 design concerns. Round 2 below.

### Round 2 (2026-05-20)

- **Verdict**: **approved**
- **Reviewer**: reviewer-subagent (claude-opus-4-7-max round 2)
- **Resolution summary**:
  - Issue 1 (arithmetic): resolved — partial M1.13 framing, 4/6/1 catalogue split, parent task Success field updated in same PR, follow-up `promote-remaining-heal-recipes` filed.
  - Issue 2 (stability-report ref): resolved — blocked-by line added with `scripts/stability-number.mjs` fallback.
  - Issue 3 (lock staleness): resolved — deterministic rule (PID dead OR >10min old), `finally`-block release, no infinite-regression.
  - Issue 4 (GWT scenarios): resolved — Step 0 mandates `.minsky/specs/agents-can-self-heal-minsky-m1-13.md` with ≥6 scenarios per AGENTS.md rule #3 (already-canonical format, not new convention).
  - Design 1-4: all resolved (workspace shape from `novel/competitive-benchmark/`, ledger growth deferred to follow-up, stuck-command wired into agent runtime polling loop, chaos injection table explicit per-helper).
- **New issues**: none.
- **Atomicity**: 8 deliverables in 1 PR — justified, no split.
- **Quality score**: 8/10 (correctness 9, quality 8, testing 8, completeness 7).
- **Approval rationale**: All blocking concerns resolved with concrete, auditable changes. Acceptance criteria are runnable. Spec format conforms to existing constitutional rules. The plan is ready for the first code commit (Step 0: create `.minsky/specs/agents-can-self-heal-minsky-m1-13.md` with ≥6 GWT scenarios).
- **Residual non-blocking recommendations** (filed as follow-up tasks alongside main PR): (1) P1 task to enumerate the 6 operator-recipes in SKILL.md and assess each for Phase-2 automation feasibility before `promote-remaining-heal-recipes` is claimed; (2) P2 task to add per-helper timeout enforcement to prevent lock races on slow helpers; (3) Document the chaos test's fixture-seam pattern in Step 6 code comments.

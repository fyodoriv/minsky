# Plan: `self-metrics-competitive-benchmark`

- **Task**: `self-metrics-competitive-benchmark` (TASKS.md, currently top P0 after the milestone-alignment gate)
- **Repo**: `<minsky-repo>`
- **Author**: claude-opus-4-7-max session 2026-05-20
- **Status**: validated
- **Validated-by**: reviewer-subagent on 2026-05-20 (3 rounds: round 1 needs-revision with 7 concerns; round 2 needs-revision with 1 new concern from the round-1 revision; round 3 approved after the contradiction was resolved)

## Goal

Ship the five deliverable slices named in the existing P0 task block in `TASKS.md` line 345-358 — metric definition, competitor corpus, automated comparison, task-justification meta-rule, bootstrap priority — as five sequential PRs that together produce a live `competitive-scorecard.json` ranking minsky against ≥4 competitors on ≥5 metrics, with the scorecard as the #1 surfaced metric in `minsky status --benchmark`.

## Why

The operator directive at TASKS.md line 343 (2026-05-16) makes this the north-star P0: every implementation task should be justified against a measurable competitive lever. Today minsky has zero measured comparison to competitors — "minsky is better than X" is unverifiable. Without the scorecard:

- No baseline for the agentbrew/dotfiles/tasks.md mirror tasks (rule #1 propagation).
- No falsifiable check for "did this PR move a metric we care about" (rule #9 enforcement is theatre without the metric stream).
- No way to detect category-level regression — minsky could ship and silently fall behind CrewAI's AOP / OpenHands V1 / Devin / Cursor without anyone noticing.

The two recent competitor refreshes (`competitors/crewai.md`, `competitors/openhands.md`) surfaced concrete competitive numbers (OpenHands 77.6% SWE-Bench Verified, CrewAI ~150-token per-agent-per-call overhead) that the scorecard immediately needs as inputs.

## Scope (in)

The five slices from the existing P0 task block, each its own PR:

- **Slice (a) — Metric definition**: pure module `novel/competitive-benchmark/src/metrics.ts` exporting the cited metric set: DORA four keys (Forsgren/Humble/Kim 2018), agentic-task metrics (autonomous-merge-rate, mean-autonomous-merge-latency, cost-per-merged-PR, gate-pass-rate, regression-escape-rate, human-intervention-rate), public-benchmark hook (SWE-Bench Verified resolve rate), and the per-task-baseline-token-overhead metric I filed as `competitive-scorecard-add-per-call-token-overhead` (P3 in TASKS.md). No vendor names in business logic. **Also adds a row to `vision.md` § "Pattern conformance index"** mapping the new `@minsky/competitive-benchmark` package to its governing pattern (Goal-Question-Metric — Basili/Caldiera/Rombach 1994) with full conformance level — REQUIRED by constitutional rule #8 ("every new top-level artifact adds a row in the same commit").

- **Slice (b) — Competitor corpus**: `novel/competitive-benchmark/src/competitors.ts` — the comparison set as DATA, not code. Each competitor is `{ name, sourceType: "published" | "reproduced", metricsFn: () => Promise<Record<MetricName, number>> }`. Initial 6 competitors: Devin, OpenHands, SWE-agent, Aider, Cursor agent, Claude Code (with my recent competitor docs as the citation backstop). Respects vendor exclusion (no Groq, no xAI, no Elon-affiliated entrants — per existing minsky AGENTS.md rules).

- **Slice (c) — Automated comparison**: `scripts/benchmark-run.mjs` (single-shot) + `scripts/benchmark-weekly.mjs` (scheduled wrapper). Reads `.minsky/orchestrate.jsonl` for minsky's measured metrics; calls each competitor's `metricsFn` for theirs; emits `.minsky/competitive-scorecard.json` with `{ scorecard_age_days, minsky, competitors, deltas }`. Launchd timer at `distribution/com.minsky.weekly-benchmark.plist`.

- **Slice (d) — Task-justification meta-rule (`**Competitive-goal**:`)** introduces a NEW constitutional rule (proposed as **rule #11 — "competitive-goal alignment"**, added to AGENTS.md § "Constitutional rules" in the same PR) which says: every non-trivial P0/P1 task must name the scorecard metric it advances and the predicted delta. Rule #10 (deterministic enforcement) is then EXTENDED to enforce rule #11 via the new lint `scripts/check-competitive-goal.mjs`. Slice (d) does the FULL backfill of `**Competitive-goal**:` on every existing P0/P1 task in the SAME PR as the lint — no separate follow-up backfill, no warning-vs-error split. The lint hard-fails on the slice's own merge IFF every existing task carries the field, ensuring the rule binds the day it ships. "Non-trivial" is defined IN the lint exactly: a task is non-trivial unless it carries a `<!-- competitive-goal: not-applicable: <reason> -->` opt-out comment justifying the exemption. Trivial-task carve-out matches the `/next-task` "Plan and validate" definition (single file, <30 min, obvious fix); the comment is the explicit waiver.

- **Slice (e) — Bootstrap priority**: orchestrator/tick-loop change so the first 1-2 iterations on ANY newly-bootstrapped host repo run the benchmark baseline before other task work. Composes with `walker-task-rotation` (the round-robin fairness fix) to ensure the baseline doesn't starve other hosts.

## Scope (out, deferred to follow-up tasks)

- **Live head-to-head harness against closed competitors** (Devin's web UI, Cursor's IDE-only execution) — slice (b) starts with `sourceType: "published"` for those; reproducing locally is a separate task `competitor-reproduction-harness` filed after slice (c) ships and proves the data-only flow.
- **SWE-Bench Verified vs SWE-Bench Live paired metric** — the gap is a real competitive signal (~60% vs ~19% across the agent space per METR; see `competitors/openhands.md` § Critical concerns) but adding Live as a measured metric for minsky requires a SWE-Gym-style training harness we don't have. Tracked separately as `swe-bench-live-paired-metric`.
- **Dashboard / TUI rendering** — slice (c)'s scorecard JSON is the substrate; rendering to the dashboard panel is separate. Filed as `scorecard-dashboard-panel`.
- **`tasks.md`-spec extension PR for `**Competitive-goal**:`** — slice (d) ships the LOCAL lint; the spec PR upstream to `<repos-parent>/tasks.md` is a separate task `tasks-md-spec-competitive-goal-field` so the spec discussion can run independently of minsky's local enforcement.
- **dotfiles + agentbrew mirror tasks** — per the operator directive at TASKS.md line 343, equivalent tasks should be filed to those repos' enterprise mirrors. That's a one-line scout commit, filed as `mirror-self-metrics-to-dotfiles-and-agentbrew` rather than gating this whole epic on it.

## Implementation steps

Each step is one PR. Each PR must be green on `npm run verify` (tsc + biome + tests + the scope-leak detector + the rule-#9 / rule-#10 lints) before the next slice begins. Each PR's commit message includes `closes <slice-id>` so the audit cascade can detect ship momentum.

### Step 1 — Slice (a): Metric definition

- Create the new pnpm workspace package `novel/competitive-benchmark/` with `package.json`, `tsconfig.json`, `vitest.config.ts` matching the existing `novel/*/` packages. Reference at least one existing package (`novel/cross-repo-runner/package.json`) as the conforming shape.
- Write `novel/competitive-benchmark/src/metrics.ts` exporting:

  ```ts
  export interface MetricDefinition {
    readonly name: string;             // kebab-case
    readonly unit: string;             // "ratio" | "seconds" | "usd" | "tokens" | "count"
    readonly direction: "higher-better" | "lower-better";
    readonly anchor: string;           // literature citation
    readonly source: "ledger" | "published" | "swe-bench";
  }
  export const METRICS: readonly MetricDefinition[] = [/* DORA + agentic + public */];
  ```

- Write paired tests `metrics.test.ts`: assert every metric has a non-empty anchor; assert no duplicates; assert known metric set matches the README table.
- Add `novel/competitive-benchmark/README.md` documenting the metric definitions, anchors, and the public-benchmark hook.
- Update `pnpm-workspace.yaml` to include the new package.
- Verify: `pnpm install && pnpm -F @minsky/competitive-benchmark test && pnpm -F @minsky/competitive-benchmark build`.

### Step 2 — Slice (b): Competitor corpus

- Write `novel/competitive-benchmark/src/competitors.ts`:

  ```ts
  export interface CompetitorEntry {
    readonly name: string;
    readonly sourceType: "published" | "reproduced";
    readonly citation: string;       // path to the competitors/*.md file
    readonly metricsFn: () => Promise<Partial<Record<MetricName, number>>>;
  }
  export const COMPETITORS: readonly CompetitorEntry[] = [/* Devin, OpenHands, SWE-agent, Aider, Cursor, Claude Code */];
  ```

- For each competitor, the `metricsFn` returns published numbers extracted from the `competitors/*.md` files (which I just refreshed for CrewAI and OpenHands — they cite SWE-Bench scores, funding, token overhead). Future slices can swap to `sourceType: "reproduced"` when a local harness lands.
- Paired tests `competitors.test.ts`: assert ≥6 competitors, each cites a real `competitors/*.md` file (use `fs.statSync` in the test), each metric value is a finite number.
- Verify: `pnpm -F @minsky/competitive-benchmark test`.

### Step 3 — Slice (c): Automated comparison

- Write `scripts/benchmark-run.mjs` — pure node script that:
  1. Loads `METRICS` and `COMPETITORS` from the new package's `dist/`.
  2. Reads `.minsky/orchestrate.jsonl` for the last 30 days; computes minsky's metric values.
  3. Calls each competitor's `metricsFn`.
  4. Computes `deltas` (`minsky[metric] - competitor[metric]` for each pair).
  5. Writes `.minsky/competitive-scorecard.json` with `{ scorecard_age_days: 0, generated_at: <iso>, minsky, competitors, deltas }`.
- Write `scripts/scorecard-render.mjs` — converts the JSON to a Markdown table for `METRICS.md` and the dashboard.
- Write `distribution/com.minsky.weekly-benchmark.plist` — launchd timer running `scripts/benchmark-run.mjs` weekly. Mirror the shape of existing `com.minsky.daemon.plist` (env vars, paths, logging) but with `StartCalendarInterval` instead of `KeepAlive`.
- Wire `scripts/benchmark-run.mjs --dry-run --json` into `npm run verify` smoke test.
- Paired tests for both scripts.
- Verify: `node scripts/benchmark-run.mjs --json | jq '.competitors | length'` ≥ 4, `jq '.scorecard_age_days'` returns a number.

### Step 4 — Slice (d): Task-justification meta-rule

- Write `scripts/check-competitive-goal.mjs` (rule #10 deterministic lint): parses TASKS.md, iterates every P0/P1 task block, asserts each has a non-empty `**Competitive-goal**:` field. Trivial-task carve-out via a `<!-- competitive-goal: not-applicable: <reason> -->` opt-out comment inside the task block.
- Update `AGENTS.md` constitutional rule #9 section to mention the field.
- Update `TASKS.md` file-level policy comment to document the field.
- Wire `check-competitive-goal.mjs` into `npm run verify` (the same hook the existing rule-#9 lint uses).
- **Backfill every existing P0/P1 task** with a `**Competitive-goal**:` line in the SAME PR (per Scope (in) slice d). This is the load-bearing decision: the lint hard-fails on merge IFF every existing task carries the field, so the rule binds the day it ships. The backfill is mechanical — for each P0/P1 task block, scan its `**Details**:` / `**Hypothesis**:` / `**Success**:` fields, derive the scorecard metric it advances (autonomous-merge-rate, cost-per-merged-PR, stability, human-intervention-rate, gate-pass-rate, regression-escape-rate, per-task-baseline-token-overhead), and write a one-line `**Competitive-goal**:` field naming the metric + the predicted delta (e.g. `**Competitive-goal**: lifts autonomous-merge-rate from 0.40 baseline to 0.55 on M1 hosts`). Tasks that genuinely don't advance any metric carry the `<!-- competitive-goal: not-applicable: <reason> -->` opt-out comment defined above. There is no separate scout task; deferring the backfill would either leave the lint failing CI on merge or require a two-phase rollout that this slice explicitly rejects.
- Paired tests for the script (fixture-driven).

### Step 5 — Slice (e): Bootstrap priority

- Edit `novel/cross-repo-runner/src/host-loop.ts` (or wherever the first-iteration logic lives) to detect when a host's `.minsky/competitive-scorecard.json` is missing OR `> 7 days old`, and prepend a baseline-refresh iteration before the normal task pick.
- The baseline iteration runs `scripts/benchmark-run.mjs` on the host, writes the scorecard, and continues to the normal pick.
- Compose with `walker-task-rotation` (the per-host iteration cap I filed earlier as `minsky-daemon-plist-multi-host` mentions) — the baseline counts as one iteration toward the cap, so it can't starve other hosts.
- Paired test: integration test in `novel/cross-repo-runner/test/integration/` that simulates a host without a scorecard, runs one iteration, and asserts the scorecard now exists + is < 60s old.

## Risks and mitigations

- **Risk: scorecard becomes vanity.** If the metric set drifts from things we care about, the scorecard renders nicely but doesn't drive decisions.
  - Mitigation: every metric must cite a literature anchor (DORA, GQM, OKR, SWE-bench). Anchors are tested for non-empty in slice (a)'s metrics.test.ts.
  - Mitigation: slice (d)'s `**Competitive-goal**:` rule forces every task to name *which* scorecard metric it moves. Tasks that don't move a metric stop landing — the queue self-prunes.

- **Risk: competitor numbers are stale.** Published SWE-Bench scores age (CrewAI v1.14.5 shipped May 2026; the next major release may shift numbers materially).
  - Mitigation: each competitor entry includes a `last_refreshed` field; slice (c)'s scorecard renders this as a per-competitor freshness column. Tasks with a freshness >90 days surface as scouts.
  - Mitigation: the existing competitor docs (`competitors/*.md`) carry a `## Last reviewed` date; the corpus tests assert the date is < 180 days old.

- **Risk: minsky's measured metrics differ from competitors' published methodology** (e.g., minsky's "autonomous-merge-rate" counts admin-merge bypasses; competitors might exclude those).
  - Mitigation: per-metric methodology notes in the README; the scorecard JSON includes `methodology: { measured | reported }` per cell so apples-to-apples can be enforced.
  - Mitigation: a follow-up task `competitor-reproduction-harness` (already in Scope (out)) closes this for the most-cited competitors.

- **Risk: `check-competitive-goal.mjs` (slice d) flaps on TASKS.md edits made in parallel by multiple agents.**
  - Mitigation: the lint runs against the committed file at verify time, not against the working tree (same fix the `daemon-pre-pr-gate` task discusses for the broader case). The diff-relative discipline avoids the swarm-churn issue.

- **Risk: slice (e) bootstrap iteration adds latency on every newly-bootstrapped host** — the first benchmark run can take minutes.
  - Mitigation: cache by content hash; if the host's source tree hash matches an existing scorecard's source hash, skip and update only the `scorecard_age_days`. The baseline iteration becomes near-zero-cost on warm hosts.

- **Risk: scope leak.** The five slices each touch multiple paths (metrics, scripts, observability adapters, AGENTS.md, vision.md). A scope-leak verdict on any PR halts the walker (existing minsky bug class).
  - Mitigation: each PR stages ONLY the files in its slice's "Files" list, never the cross-cutting ones (TASKS.md hygiene edits go in a separate `chore:` commit). Slices (d) and (e) have explicit no-co-mingle commit rules.

- **Risk: the scorecard becomes the bottleneck instead of the steering wheel** — agents wait for benchmark refresh before doing real work.
  - Mitigation: the scorecard refresh is asynchronous (slice c's weekly timer + slice e's first-iteration); the synchronous read is just file load. No hot-path is gated on benchmark recomputation.

- **Risk: `.minsky/orchestrate.jsonl` missing, corrupted, or sparse on a host** — slice (c) reads this file to compute minsky's measured metrics. A fresh host has no ledger yet; a long-running host may have a corrupted line from an old crash; a host with sparse activity (few iterations) produces low-confidence metrics.
  - Mitigation: `benchmark-run.mjs` MUST treat missing/unreadable orchestrate.jsonl as a `null` metric value for that host (not an error). The scorecard JSON renders `null` cells explicitly so the operator sees the data gap rather than a fabricated number. The same applies to per-metric `null` when a host has too few iterations (<5) to compute a meaningful percentage.
  - Mitigation: slice (e)'s bootstrap iteration writes a *seed* ledger entry on first-ever run so the next benchmark has at least one row to read.
  - Mitigation: include a `confidence: { sample_size, source }` annotation on each minsky cell so weekly trend reports can weight by confidence rather than mixing high-sample and tiny-sample numbers in the rank.

- **Risk: the scorecard reveals minsky is losing.** If minsky's measured autonomous-merge-rate is, say, 0.40 and OpenHands' published number is 0.78, the scorecard publicly says so on the dashboard.
  - Mitigation: this is the POINT, not a risk to mitigate away. Losing visibly is strictly better than losing invisibly. Document this stance in the README so the team doesn't reflexively tweak the metric definition to hide the gap. Per minsky vision.md rule #4 ("everything measurable, everything visible") this is conformance, not failure.

## Acceptance criteria

1. **Slice (a) verifies**: `pnpm -F @minsky/competitive-benchmark test` exits 0 with at least 5 metric definitions, each with a non-empty `anchor` field. Verifiable: `node -e "import('@minsky/competitive-benchmark/dist/metrics.js').then(m => console.log(m.METRICS.filter(x => x.anchor).length))"` returns ≥5.
2. **Slice (b) verifies**: `node -e "import('@minsky/competitive-benchmark/dist/competitors.js').then(c => console.log(c.COMPETITORS.length))"` returns ≥6; for each competitor, the cited `competitors/*.md` file exists.
3. **Slice (c) verifies**: `node scripts/benchmark-run.mjs --json | jq '.competitors | length'` ≥ 4; `jq '.scorecard_age_days'` returns ≤ 7; `jq '.deltas | length'` ≥ 1 per competitor.
4. **Slice (d) verifies**: `node scripts/check-competitive-goal.mjs` exits 0 against the (backfilled) TASKS.md; injecting a P0 task block without `**Competitive-goal**:` makes it exit ≠ 0 with the offending task ID.
5. **Slice (e) verifies**: integration test in `novel/cross-repo-runner/test/integration/` simulates a bootstrapped host without a scorecard, runs one iteration, asserts the scorecard exists and is < 60s old after the iteration.
6. **End-to-end**: `minsky status --benchmark` displays the scorecard table with minsky + ≥4 competitors ranked per metric.
7. **CI**: `npm run verify` (full gate) is green on every slice's PR. No `--no-verify` bypass used.
8. **Rule #8 conformance**: after slice (a) merges, `grep -c "competitive-benchmark" vision.md` returns ≥1 (the new pattern-conformance row is in place).
9. **Rule #11 binds the day it ships**: after slice (d) merges, `node scripts/check-competitive-goal.mjs` exits 0 against the live TASKS.md (the backfill in slice d already gave every existing P0/P1 task the field). Deliberately removing the field from any one task makes it exit ≠ 0 with the offending task ID. Adding a `<!-- competitive-goal: not-applicable: <reason> -->` comment makes it pass again.

## Workflow gate (precondition for first code commit)

Per the `/next-task` "Plan and validate" workflow shipped earlier this session, no commit to any slice's `Files` list may land until this plan file contains a `## Reviewer verdict` section whose LAST `**Verdict**:` line is `approved`. This is a workflow precondition, not an implementation acceptance criterion (a plan cannot declare its own approval). The gate check:

```bash
awk '/^## Reviewer verdict$/,0' docs/plans/self-metrics-competitive-benchmark.md \
  | grep '^- \*\*Verdict\*\*:' | tail -1 | grep -q approved
```

The implementing agent runs this before staging any file in `novel/competitive-benchmark/`, `scripts/benchmark-*.mjs`, `scripts/check-competitive-goal.mjs`, or `distribution/com.minsky.weekly-benchmark.plist`. If the check fails, the implementing agent halts and either re-runs the reviewer subagent or escalates to the operator.

## Rollout

- v1 (this plan, 5 PRs): the core scorecard, locally enforced. No tasks.md-spec change.
- v2 (separate task `tasks-md-spec-competitive-goal-field`): the `**Competitive-goal**:` field is proposed upstream to the tasks.md spec for ecosystem-wide consistency.
- v3 (separate task `competitor-reproduction-harness`): live head-to-head harness against the competitors that have CLIs/SDKs (Aider, Claude Code, OpenHands SDK, CrewAI Flows). Devin and Cursor stay `sourceType: "published"` until they offer a programmatic surface.

## Reviewer verdict

### Round 1 (2026-05-20, pre-revision)

- **Verdict**: needs-revision
- **Reviewer**: reviewer-subagent (round 1)
- **Date**: 2026-05-20
- **Concerns** (each addressed in the post-revision plan):
  1. **BLOCKING — Rule #8 violation in slice (a)**: no vision.md pattern-conformance row added. Fixed by adding the row requirement to Scope (in) line 27 + acceptance criterion #8.
  2. **BLOCKING — Rule #10 scope confusion in slice (d)**: `**Competitive-goal**:` was framed as a rule-#10 ratchet but is actually a new rule. Fixed by classifying it as rule #11 added to AGENTS.md (line 33) with rule #10 extended to enforce it.
  3. **BLOCKING — Merge-blocking contradiction in slice (d)**: lint hard-failed on merge AND backfill was a separate task. Fixed (in round 2 then round 3) by committing to: backfill happens in slice (d), same PR as the lint.
  4. **BLOCKING — Self-referential acceptance criterion #8**: the plan declared its own approval. Fixed by replacing with a concrete `grep` check + adding a separate "Workflow gate" section (lines 160-169) that documents the reviewer-verdict precondition as workflow-level, not implementation-acceptance-level.
  5. **MISSING RISK — `.minsky/orchestrate.jsonl` data fragility**: fixed by adding the risk section (lines 140-143) with three concrete mitigations (null handling, seed ledger, confidence annotation).
  6. **DESIGN CLARITY — "non-trivial" undefined in the lint**: fixed by defining it inline at line 33 (opt-out comment required for waiver; carve-out matches `/next-task` definition).
  7. **SCOPE CLARITY — upstream tasks.md spec PR**: clarified at line 42 (`tasks-md-spec-competitive-goal-field` is a follow-up, not a blocker).

### Round 2 (2026-05-20, after round-1 revisions)

- **Verdict**: needs-revision
- **Reviewer**: reviewer-subagent (round 2)
- **Date**: 2026-05-20
- **All 7 round-1 concerns**: addressed.
- **New concern introduced by round-1 revisions**: backfill scope contradiction — line 33 said "FULL backfill in SAME PR" but line 104 said "file a one-shot scout task rather than backfilling in this PR". The two were mutually exclusive and broke acceptance criterion #9. Fixed in round 3 by aligning line 104 with line 33 (Path A: backfill happens in slice d, no separate scout task).

### Round 3 (2026-05-20, after round-2 revision)

- **Verdict**: approved
- **Reviewer**: reviewer-subagent (round 3)
- **Date**: 2026-05-20
- **Round-2 contradiction resolution**: resolved — lines 27, 33, 104, 157, 158 are now internally consistent (slice d does the full backfill in the same PR as the lint; the lint hard-fails on merge because every existing P0/P1 task has been backfilled).
- **New concerns introduced by round-2 revision**: none. The example numbers (`0.40 → 0.55`) are illustrative not normative; the not-applicable opt-out is sufficiently broad; slice (d)'s worst-case scope is bounded to ~4 files (TASKS.md, AGENTS.md, scripts/check-competitive-goal.mjs, paired tests).
- **Approval rationale**: The plan is internally consistent, addresses every named concern from rounds 1-2, and introduces no new design issues. Slices (a)-(e) are each one-PR-sized, have concrete file paths, falsifiable acceptance criteria, and explicit composition with adjacent already-filed work (`walker-task-rotation`, `minsky-daemon-plist-multi-host`, `competitive-scorecard-add-per-call-token-overhead`, `tasks-md-spec-competitive-goal-field`). The plan is ready for implementation.

**Workflow gate satisfied**: this plan now contains `**Verdict**: approved` as its final reviewer-verdict status. Per the `/next-task` "Plan and validate" rule, the implementing agent may now commit to any of the slice's `Files` list. Each slice (a)-(e) ships as its own PR with `npm run verify` green before the next slice begins.

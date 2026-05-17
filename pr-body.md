## What & why

Slice (d) of `self-metrics-competitive-benchmark` (north-star P0): the deterministic rule-#10 ratchet behind the `**Competitive-goal**:` TASKS.md field, so "which competitive-scorecard metric does this task move?" becomes a lint-enforced question instead of prose that rots.

**Why needed:** the task makes "beat competitors" the gravitational center every task is justified against. Without a deterministic gate the new field is prose-only — the exact rule-#10 failure mode the constitution exists to prevent. Slices (a)/(b) (pure metric set + competitor corpus) are already in flight in PR #616 and sibling branches; this slice ships the *justification meta-rule* machinery, which has no dependency on the unmerged TS package and can land independently and green.

This is deliberately the **machinery only**, shipped in the dormant-first activation mode this codebase already uses for ratchet lints (`check-cadence-pivot-threshold`): the gate exists, is fully tested, and flips on with a single policy line once the task corpus is migrated. Hard-failing against the unmigrated corpus today would mass-break every concurrent daemon PR — itself a rule-#11 (no instant-red gates) violation. The lint-stack + `ci.yml` parity wiring and the corpus migration are an explicit, coupled follow-up slice (the `ci.yml`↔`STACK_MANIFEST` bidirectional-parity test makes half-wiring a guaranteed red, so it is intentionally not split here).

## Changes

- `scripts/check-competitive-goal.mjs` — pure decision function (`checkCompetitiveGoal`, `parseTaskBlocks`, `readTasksMd`) + thin CLI. Non-triviality reuses rule #9's existing boundary (a `**Hypothesis**:`-bearing block is non-trivial by definition) rather than inventing a fuzzy heuristic.
- `scripts/check-competitive-goal.test.mjs` — 10 paired positive/negative + dormant + block-boundary tests. Discovered and run by the existing `scripts/**/*.test.mjs` vitest include, so the logic is gated by `npm run check` today.
- `AGENTS.md` — documents the `**Competitive-goal**:` field next to the sibling `**Touches**:` field doc.

## Measurement

- `node scripts/check-competitive-goal.mjs` against the real `TASKS.md` → exit 0, dormant advisory (marker absent).
- Enforced fixture (`<!-- policy: competitive-goal-enforced -->` + a Hypothesis-only block) → exit 1, violation names the task id + rule-#9 rationale.
- `npx vitest run scripts/check-competitive-goal.test.mjs` → 10/10 pass.

## Optimization (per-iteration discipline gate)

**Skip-earlier gate.** The CLI's dormant path returns after a single `String.includes(ENFORCE_MARKER)` scan and never enters `parseTaskBlocks` — no `split("\n")` over the ~2000-line `TASKS.md`, no per-block regex sweep. Until the corpus is migrated this is the path *every* concurrent daemon takes on every full-stage pre-pr-lint run, so the gate's added cost is one substring scan rather than a full-file parse (well above the ≥10-byte / one-round-trip-of-work minimum; CI duration delta ≈ 0s, far under the task's 60s budget).

## Hypothesis self-grade

- **Predicted**: a deterministic rule-#10 ratchet for the `**Competitive-goal**:` field can land green and independently of the unmerged metric/corpus package, by shipping dormant-first (marker-gated) like `check-cadence-pivot-threshold`.
- **Observed**: checker + 10 tests green; dormant against real `TASKS.md` (exit 0); enforced fixture correctly exits 1; zero dependency on `novel/competitive-benchmark` so no cross-slice merge coupling.
- **Match**: yes
- **Lesson**: the dormant-first ratchet pattern lets the justification meta-rule ship now while the corpus migration + lint-stack/ci.yml parity wiring proceed as a separate coupled slice — next iteration wires the marker flip plus the `STACK_MANIFEST`/`ci.yml` pair together (never half).

## Security & privacy

vision.md § 13 reviewed. **Surface:** a new repo-local executable lint script (supply-chain-adjacent — new code in the CI/pre-pr path). **Threat:** a malicious `TASKS.md` path argument or crafted content causing code execution or unbounded resource use. **Mitigation:** the script does no `exec`/spawn, no network, no shell interpolation, no `eval`; it `readFileSync`s a single path (default repo-root `TASKS.md`), runs linear regex/string scans only, and adds no dependency (zero `pnpm-lock.yaml` delta). ENOENT degrades to a dormant exit 0; other I/O errors exit 2 (let-it-crash, rule #6). No auth, secrets, PII, or sandbox boundary is touched.

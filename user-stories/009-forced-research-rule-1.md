# Story 009 — Forced research: rule #1 rejects agents reinventing the wheel

> A CI gate blocks any new package that builds something a known library already does, until the agent writes down which libraries it considered and why it rejected each one.

Minsky is a background program that picks tasks from a project's to-do list and drives a coding assistant (the agent) to do them, then hands you a draft for review. One of its non-negotiable project rules is **rule #1, don't reinvent the wheel**. The motivation is blunt: the 100th time an agent reinvents the wheel is the 100th time a human asks "why didn't you just use lodash?". This story shows how that rule is enforced mechanically: a lint check fails the build when an agent writes custom code for a problem an established library already solves, unless the agent records its research.

## Story

As a maintainer, you review a draft PR from a Minsky-spawned agent. The agent added a new utility module under `novel/foo/` and wrote a custom CSV parser by hand. The pre-PR lint check fails with:

> `rule-1-novel-justification: novel/foo/README.md is missing the "Alternatives considered" section. Per rule #1 (don't reinvent the wheel), the package must cite the existing libraries / patterns it considered and explain why each was rejected.`

The PR cannot merge. The agent reads the lint output and edits `novel/foo/README.md` to add an `## Alternatives considered` section with three rows:

- `csv-parser` — rejected because too large
- `papaparse` — rejected because browser-only
- node's native `readline` — rejected because no quote-handling

The agent re-pushes. Lint passes. You now see the research trail in the PR and can verify the agent actually evaluated the alternatives — not just rejected them in prose.

## Acceptance criteria

- `scripts/check-rule-1-novel-justification.mjs` runs on every PR via `scripts/run-pre-pr-lint-stack.mjs` at the `fast` and `full` stages.
- For every new package under `novel/<pkg>/` (where `<pkg>` lacks the `_template_` marker), the linter asserts:
  - A `README.md` exists at `novel/<pkg>/README.md`.
  - The README contains a heading whose text matches `/(alternatives considered|don't reinvent|prior art|why not <X>)/i`.
  - At least one alternative is named beneath the heading (a `**<lib-name>**` bold marker, OR a bullet item starting with a backticked library name).
- The linter exits non-zero with an actionable message naming the offending package and the missing heading.
- New `novel/*` packages that don't ship yet (just `package.json`) are exempt — the requirement triggers when source files land.
- Existing packages that predate rule #1 are grandfathered via an allowlist in the linter; the allowlist is decremented over time as old packages are backfilled.

## Metric

- **Name**: `rule_1_rejections_per_week`
- **Definition**: count of PRs rejected by `scripts/check-rule-1-novel-justification.mjs` in pre-pr-lint over the trailing 7-day window, computed from `gh pr list --search "label:rule-1-failed" --json closedAt,createdAt`.
- **Threshold**: declining trend (week-N count < week-N-1 count) for ≥4 consecutive weeks after the linter ships, demonstrating agents internalising the rule. After 12 weeks, sustained ≤2/week (occasional rejections OK; persistent ones indicate the linter messaging needs work, not that rule #1 is wrong).
- **Source**: GitHub PR API + `gh pr list` shelled out by the dashboard's weekly aggregator.

## Integration test

- **File**: `user-stories/009-forced-research-rule-1.test.ts` (new; ships in the same PR as this story).
- **Setup**:
  - Two synthetic `novel/<pkg>/` fixtures under `test/fixtures/rule-1/`:
    - `good-package/` — has `README.md` with `## Alternatives considered` + 3 named alternatives + `package.json` + `src/index.ts`.
    - `bad-package/` — has `README.md` (no alternatives section) + `package.json` + `src/index.ts`.
  - The linter accepts `--fixture <dir>` to override the workspace root for test runs.
- **Action**: run `node scripts/check-rule-1-novel-justification.mjs --fixture test/fixtures/rule-1/good-package` then `... --fixture test/fixtures/rule-1/bad-package`.
- **Assert**:
  - `good-package` invocation exits 0 with stdout containing `rule-1: <pkg>: PASS`.
  - `bad-package` invocation exits 1 with stderr containing the package name + `missing the "Alternatives considered" section`.
  - Stderr names ≥1 sibling section header that *would* have satisfied the linter (so agents reading the error learn the canonical form).

## Proof

- **Live**: `pnpm pre-pr-lint --stage=fast` emits `[ok] rule-1-novel-justification` on a clean repo; the same command emits `[FAIL] rule-1-novel-justification` on a repo where a `novel/<pkg>/` lacks the section.
- **Dashboard**: weekly chart of `rule_1_rejections_per_week` shows the declining trend.
- **Audit**: `git log --all --grep="Alternatives considered"` shows the rule's effect — every PR that adds a `novel/<pkg>/` ships with the section in the same commit.
- **Notification**: no live notification; this is a CI gate, not a runtime event.

## Failure modes & chaos verification

Per constitutional rule #7 (`vision.md` § 7).

- **Steady-state hypothesis**: zero unjustified `novel/*` packages on `origin/main` at any time. The linter is the mechanical enforcement; the steady state is an empty rejection queue plus a clean main.
- **Blast radius**: a single PR. The linter never modifies code; it only rejects the build. Worst case: a PR is blocked until the agent or human adds the section.
- **Operator escape hatch**: add the package to the linter's allowlist (a short list in `scripts/check-rule-1-novel-justification.mjs` keyed by package name plus a TODO note pointing at the backfill task) with an explicit `// rule-1-grandfathered: <reason> + task id` comment.

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | New `novel/foo/` added without README | upstream-malformed (agent skipped the section) | `loud-crash-supervisor-restart` — block the PR | Fixture `bad-package/` with no `README.md` → linter exits 1, names the missing file |
| 2 | README present but no alternatives heading | upstream-malformed (agent wrote prose only) | `loud-crash-supervisor-restart` | Fixture `bad-package/README.md` with only `## Overview` → linter exits 1, names the missing heading |
| 3 | Alternatives heading present but no named library beneath | upstream-malformed (placeholder heading) | `loud-crash-supervisor-restart` | Fixture `placeholder-package/README.md` with `## Alternatives considered\n\nTBD` → linter exits 1, requires ≥1 named library |
| 4 | Existing pre-rule-1 package on main (grandfathered) | dependency upstream-error (legacy state) | `graceful-degrade` — linter passes via allowlist | Allowlist entry for the package; assert linter passes; verify the allowlist has the backfill task ID in a sibling comment |
| 5 | `novel/_template_*` scaffolding package | upstream — template, not real code | `graceful-degrade` — linter passes | Fixture `_template_foo/` with no alternatives section → linter passes (template name prefix exempts) |
| 6 | Linter itself crashes (parser bug, OOM, regex catastrophic backtracking) | dependency upstream-error | `loud-crash-supervisor-restart` — fail closed | Fixture with a pathologically large README → linter caps input size, exits 1 with a clean error message rather than hanging |
| 7 | Concurrent linter runs (two PRs being checked simultaneously) | concurrency | `graceful-degrade` | Spawn 2 linter processes on different fixtures simultaneously → both complete independently; no shared mutable state |
| 8 | README in a non-English language | locale | `loud-crash-supervisor-restart` — block | Fixture with `## 检查的替代方案` → linter exits 1 (rule: heading must match the English regex; agents writing localized docs add an English heading alongside) |

## Status

- **Phase**: Implemented (linter shipped in PR #133 era). The linter is wired into `scripts/run-pre-pr-lint-stack.mjs` and gates both `fast` and `full` stages. Sibling test `scripts/check-rule-1-novel-justification.test.mjs` exercises the rejection paths. This story documents the operator-facing experience; the integration test file `user-stories/009-forced-research-rule-1.test.ts` ships with this story.
- **Blocking**: none. The story is published to give operators the full mechanism; the existing linter satisfies all acceptance criteria.
- **Theoretical anchor**: rule #1 (vision.md § 1 — don't reinvent the wheel; Brooks 1975 *Mythical Man-Month* "no silver bullet" Ch. 16 + library-first defaults from Stroustrup *The C++ Programming Language* 4e Ch. 31).

## Pattern conformance

- **Pattern**: build-vs-buy decision documentation (Boehm, B. W., *Software Engineering Economics*, Prentice Hall 1981, Ch. 33 — "buy where possible, build only where the buy candidates are demonstrably unfit"). Composed with deterministic CI enforcement (vision.md rule #10 — every rule is a CI lint, not a hope).
- **Conformance level**: full
- **Index row**: vision.md § "Pattern conformance index" — the row backing `scripts/check-rule-1-novel-justification.mjs`. (Story-driven entry to be added if not present; the implementation predates this story.)
- **Notes**: the heading-match regex is intentionally lenient ("Alternatives considered" / "Don't reinvent" / "Prior art" / "Why not <X>") so the rule doesn't dictate prose form — only that the research happened.

## Security & privacy

(Per vision.md rule #13 — security & privacy second priority after performance.)

- **Trust boundary**: the linter reads README content from a working tree under the operator's control. No external data ingested.
- **Secrets**: no API keys or tokens touch this lint. If a `novel/*` README accidentally contains a token, `scripts/scan-secrets.mjs` catches it as a separate concern.
- **PII**: no PII flows through this lint.
- **Sandbox**: the linter runs as a local Node process with read-only access to the working tree; it spawns no network calls and writes nothing outside its exit code and stderr.
- **Performance carve-out**: the linter's per-package check is O(file size). For pathological READMEs >1 MB the linter caps input at 256 KiB and emits a warning; the carve-out is documented at the head of `scripts/check-rule-1-novel-justification.mjs`.

---
name: spec-monitor
description: Advisory checks for rule-#9 hypothesis quality and rule-#8 pattern-conformance language — never gates CI, only advises. Use when reviewing a draft `EXPERIMENT.yaml`, a PR description that pre-registers a hypothesis, or a newly-added pattern-conformance-index row.
allowed-tools: Bash, Read, Grep, Glob, Write
---

# spec-monitor

Advisory-only Claude Skill that augments the deterministic linters under `scripts/check-rule-*.mjs` with judgement-heavy questions about prose quality. Output is a structured markdown advisory written to `spec-advisories/<YYYY-MM-DD>.md`. **The Skill never blocks CI.** Per `vision.md` § 10 (rule #10, "deterministic enforcement — every rule is a CI lint, not a hope"): "whatever cannot be deterministically checked is not a constitutional rule" — so this Skill exists in the *residual* judgement scope only, not as a primary enforcement mechanism. Per rule #10's ratchet rule, when any concern listed below grows a deterministic linter the matching advisory rule here is *removed* in the same PR.

## Framing

Rules #1–#10 each ship at least one deterministic CI lint:

| Rule | Linter |
|------|--------|
| #1 don't reinvent the wheel | `scripts/check-rule-1-novel-justification.mjs` |
| #2 every dep behind interface | `scripts/check-rule-2-dep-coverage.mjs` |
| #3 test-first / metric-first / doc-first | `scripts/check-rule-3-doc-first.mjs` |
| #4 everything measurable / OTEL coverage | `scripts/check-rule-4-otel-coverage.mjs` |
| #5 glossary discipline | `scripts/check-rule-5-glossary-discipline.mjs` |
| #6 let-it-crash | `scripts/check-rule-6-let-it-crash.mjs` |
| #7 chaos coverage | `scripts/check-rule-7-chaos-coverage.mjs` |
| #8 pattern conformance index | `scripts/check-pattern-index.mjs` |
| #9 pre-registration shape + vanity-metric phrase list + self-grade | `scripts/check-pr-self-grade.mjs` + `@minsky/experiment-record` parse-time validation |
| #10 (meta) | the existence of the linters above is rule #10's evidence |

Together those gates catch ~90 % of constitutional-rule violations mechanically. The residual ≤10 % — the prose-quality of a hypothesis, the *meaning* of a pattern-conformance level, the smell-test of a pivot threshold — is what this Skill addresses, advisorially.

## Residual judgement scope (≤5 advisory rules — hard cap)

Adding a sixth rule requires either retiring one or shipping a deterministic linter for the new concern. This cap is the rule-#10 ratchet applied to this Skill.

### A1. Hypothesis vagueness

The deterministic linter (`@minsky/experiment-record` validator, `min_length: 20`) catches an empty or too-short `hypothesis` field. It does NOT catch a 20-character string that still says nothing. This Skill flags hypotheses whose claim is non-falsifiable by inspection.

**Examples to flag:**

- "the system will be better"
- "improves developer experience"
- "users will be happier"
- "code becomes cleaner"
- "this should help"

**Not to flag** (concrete enough — leave to the deterministic gate / observation):

- "p99 latency drops from 1.2s to <800ms"
- "error rate on `/budget` drops from 0.4 % to <0.1 % over 7 d"

### A2. Pivot threshold reuses the success threshold (or has zero margin)

The deterministic linter checks `pivot.length >= 5` and rejects the vanity-phrase list. It does NOT check whether the pivot value is a meaningful distance from the success value. Per Ries 2011 (build-measure-learn / pivot-or-persevere), a pivot threshold that equals the success threshold is theatre — it carries no information.

**Examples to flag:**

- `success: ">= 95 %"` paired with `pivot: "< 95 %"` (no margin — every drift triggers a pivot)
- `success: "tests pass"` paired with `pivot: "tests fail"` (binary — same statement, no pivot)

**Not to flag:**

- `success: ">= 95 % over 30 d"` paired with `pivot: "< 85 % over 7 d"` (10-point margin, different windows)

### A3. Anchor citation is not a primary source

The deterministic linter checks `anchor.length >= 5`. It does NOT verify that the citation points to a peer-reviewed paper, a recognised textbook, or an established standards document, as required by rule #5 / rule #8 ("named, decades-tested pattern"). Blog posts and wikis decay; the constitution is supposed to outlive any single source.

**Examples to flag:**

- "<https://medium.com/some-blog/post>"
- "Wikipedia: Watchdog timer"
- "a tweet by …"
- "ChatGPT said …"

**Not to flag:**

- "Beyer et al., *Site Reliability Engineering*, 2016, Ch. 3"
- "Munafò et al., *Nature Human Behaviour* 1, 0021, 2017"
- "rule #9 (vision.md § 9)"  — internal cross-references to constitutional rules are valid because the rules themselves carry primary citations

### A4. Measurement command runs but doesn't actually inspect output

The deterministic CI runner (`scripts/run-experiment.mjs`) executes the command and records its exit code. It does NOT check whether the command's *stdout* is consumed against a threshold. A measurement that shells out to a tool but never inspects the value (e.g., `curl http://example/api` instead of `curl http://example/api | jq -e '.value < 100'`) gives false confidence — it always exits 0 as long as the network call succeeds.

**Examples to flag:**

- `measurement: "curl https://api/usage"` (no threshold check)
- `measurement: "node count.mjs"` (script reports a number but exit code is always 0)
- `measurement: "echo done"` (literally degenerate)

**Not to flag:**

- `measurement: "test $(curl -s https://api/usage | jq -r '.tokens') -lt 100000"`
- `measurement: "pnpm vitest run path/to/file"` (vitest exits non-zero on failure)
- `measurement: "node scripts/uptime.mjs"` if `uptime.mjs` itself exits non-zero on regression

### A5. Pattern-conformance level doesn't match the source code

The deterministic linter (`scripts/check-pattern-index.mjs`) verifies that every newly-added top-level file is *mentioned* in the index. It does NOT verify that the declared conformance level (`full` / `partial` / `deviation`) matches what the code actually does. A row that says `full` next to source code that obviously deviates is silent rule-#8 violation.

**Examples to flag:**

- Row says `full` but the file's docstring lists a deviation
- Row says `deviation` but no rationale is given in the row's "Notes" column
- Row says `partial` for a file that exactly matches the cited paper's algorithm

**Not to flag:**

- Row says `full (planned)` for a file that is itself the plan document — that idiom is established and used elsewhere in the index

## Output format

Append a markdown block to `spec-advisories/<YYYY-MM-DD>.md` (create the file if absent). One block per artifact reviewed; one row per advisory finding within the block:

```markdown
## <artifact path or PR title> — <ISO 8601 timestamp>

| rule_id | evidence | severity | suggested_repair |
|---------|----------|----------|------------------|
| A1 | "improves developer experience" (hypothesis L7) | medium | Restate as a measurable observable, e.g. "<metric> moves from X to Y over Z days". |
| A3 | Anchor cites a Medium post | high | Replace with a peer-reviewed or textbook source per rule #5 / #8. |
```

`rule_id` ∈ {A1, A2, A3, A4, A5}; `severity` ∈ {low, medium, high}. The Skill never claims authority — every line ends with "consider", "suggest", or "review" framing. The advisory file is human-readable; the orchestrator may surface it in a PR comment but must NOT auto-block a merge on its contents.

## What this Skill does NOT do

The deterministic linters already cover, and this Skill is silent on, the following classes of violation. If a fixture exercises them, the Skill should produce *no* advisory entry — the existing CI gate is the authoritative answer.

- **Vanity-metric phrases** (`lines of code`, `commits made`, `hours spent`, `tasks in flight`) — caught by `@minsky/experiment-record` parser at PR-time. See `novel/experiment-record/src/parse.ts` `VANITY_PHRASES`.
- **Missing `Hypothesis self-grade` block in PR body** — caught by `scripts/check-pr-self-grade.mjs`.
- **New top-level file without a pattern-index row** — caught by `scripts/check-pattern-index.mjs`.
- **Newly-added or modified `.ts` source missing OTEL annotations** — caught by `scripts/check-rule-4-otel-coverage.mjs`.
- **Nested `try/catch` or swallowing catch in `novel/**`** — caught by `scripts/check-rule-6-let-it-crash.mjs`.
- **Novel package without a `## Why not <existing-tool>?` justification** — caught by `scripts/check-rule-1-novel-justification.mjs`.
- **Missing `## Failure modes` table per rule #7** — caught by `scripts/check-rule-7-chaos-coverage.mjs`.
- **Retired-glossary terms** (`CTO loop`, `TPM`, `constitutional review`) — caught by `scripts/check-rule-5-glossary-discipline.mjs`.

If a new violation class is identified that *doesn't* fit any of the deterministic linters above and isn't one of A1–A5, the response per rule #10's ratchet is: **write the deterministic linter, not a sixth advisory rule**.

## Fixtures

- `test/judgement-only/` — fixtures that exercise A1–A5. The Skill should produce ≥1 advisory entry per fixture.
- `test/deterministic-overlap/` — fixtures that violate a *deterministic* rule (e.g., the experiment-record parser would already reject them). The Skill should be silent — the deterministic linter is the authority, not this Skill.

## Hard cap on scope

≤5 advisory rules. Adding a sixth requires either:

1. Retiring one of A1–A5 because the residual judgement-scope it claimed turned out empty, OR
2. Shipping a deterministic linter for the new concern in the same PR (rule #10 ratchet).

Drift above 5 is itself a constitutional-violation against rule #10 and should be flagged by reviewers.

## Anchor

- vision.md § 10 (rule #10 — deterministic enforcement; whatever cannot be deterministically checked is not a constitutional rule)
- Havelund & Goldberg, "Verify Your Runs", *VSTTE* 2008 (runtime verification — split here into deterministic-monitor + advisory-judgement layers)
- Hunt & Thomas, *The Pragmatic Programmer*, 1999, Tip 32 ("crash early") — applied here as "fail deterministically; advise loosely"

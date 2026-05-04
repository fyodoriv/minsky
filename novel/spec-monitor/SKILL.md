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
| #9 pre-registration shape + vanity-metric phrase list + self-grade + pivot-vs-success margin + measurement-inspects-output + anchor-primary-source | `scripts/check-pr-self-grade.mjs` + `@minsky/experiment-record` parse-time validation + `scripts/check-pivot-success-margin.mjs` + `scripts/check-measurement-inspects-output.mjs` + `scripts/check-anchor-primary-source.mjs` |
| #10 (meta) | the existence of the linters above is rule #10's evidence |

Together those gates catch ~90 % of constitutional-rule violations mechanically. The residual ≤10 % — the prose-quality of a hypothesis, the *meaning* of a pattern-conformance level, the smell-test of a pivot threshold — is what this Skill addresses, advisorially.

## Residual judgement scope (≤5 advisory rules — hard cap; currently 2 active)

Adding a sixth rule requires either retiring one or shipping a deterministic linter for the new concern. This cap is the rule-#10 ratchet applied to this Skill. Retired rules (currently: A2 → `scripts/check-pivot-success-margin.mjs`; A3 → `scripts/check-anchor-primary-source.mjs`; A4 → `scripts/check-measurement-inspects-output.mjs`) do not consume scope-cap budget; their slots are kept as tombstones so historical advisory entries that name "A2" / "A3" / "A4" remain readable.

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

### A2 (retired — see ci-lint-pivot-success-margin)

The pivot-vs-success zero-margin check used to live here as an advisory rule. Per the rule-#10 ratchet (vision.md § 10), it has been promoted to a deterministic CI lint at `scripts/check-pivot-success-margin.mjs` (paired tests at `scripts/check-pivot-success-margin.test.mjs`, CI job `pivot-success-margin`). The lint reads `success` and `pivot` from `EXPERIMENT.yaml` via the `@minsky/experiment-record` parser, regex-extracts the leading signed numeric token from each, and fails when the absolute margin is <1 % of the success value or when both sides are identical binary prose. Opt-out for legitimately-binary metrics: a top-level YAML comment line `# rule: ci-lint-pivot-success-margin: skip <reason ≥3 chars>`. Promotion decision recorded in `spec-advisories/2026-05-03-quarterly-audit.md`.

The slot is left as a tombstone (rather than renumbering A3–A5) so that historical references to "A2" in `spec-advisories/*.md` keep their meaning. The slot's heading shape (`### A2 (retired …)`, no period after the digit) is intentionally NOT one that `scripts/check-skill-rule-cap.mjs`'s regex (`/^###[ \t]+A\d+\.\s/`) counts — retired rules do not consume scope-cap budget.

### A3 (retired — see ci-lint-anchor-primary-source)

The anchor-primary-source check was promoted to a deterministic CI lint at `scripts/check-anchor-primary-source.mjs` per the rule-#10 ratchet (PR `ci-lint-anchor-primary-source`). The lint reads `anchor` from `EXPERIMENT.yaml` via the `@minsky/experiment-record` parser and runs an allowlist + deny-list classifier: deny-list of non-primary tokens (`medium.com`, `*.substack.com`, `wikipedia.org`, `twitter.com`, `x.com`, `reddit.com`, `stackoverflow.com`, `chatgpt.com`, `claude.ai`, "ChatGPT said", "tweet by", "blog post") fails when matched without an allowlist token; allowlist of primary-source patterns (italicised title `*…*`, `Ch. <n>`, `pp. <n>`, ISBN, DOI, `<VENUE> <YEAR>`, internal cross-ref `vision.md §` / `rule #<n>` / `spec-advisories/<date>.md`) wins on conflicts. Three-way verdict — pass / fail / advisory-warn (short prose without signal). Opt-out: a top-level YAML comment line `# rule: ci-lint-anchor-primary-source: skip <reason ≥3 chars>`. Promotion decision recorded in `spec-advisories/2026-05-03-quarterly-audit.md`.

The slot is left as a tombstone (rather than renumbering) so historical references to "A3" in `spec-advisories/*.md` keep their meaning. The slot's heading shape (`### A3 (retired …)`, no period after the digit) is intentionally NOT one that `scripts/check-skill-rule-cap.mjs`'s regex (`/^###[ \t]+A\d+\.\s/`) counts.

### A4 (retired — see ci-lint-measurement-inspects-output)

The measurement-inspects-output check was promoted to a deterministic CI lint at `scripts/check-measurement-inspects-output.mjs` per the rule-#10 ratchet (PR `ci-lint-measurement-inspects-output`). The slot is left as a tombstone (rather than renumbering) so historical references to "A4" in `spec-advisories/*.md` keep their meaning. The slot's heading shape (`### A4 (retired …)`, no period after the digit) is intentionally NOT one that `scripts/check-skill-rule-cap.mjs`'s regex (`/^###[ \t]+A\d+\.\s/`) counts.

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

`rule_id` ∈ {A1, A5} (A2, A3, and A4 are retired — emit no advisories for them; the deterministic CI lints `pivot-success-margin`, `anchor-primary-source`, and `measurement-inspects-output` are now the authority); `severity` ∈ {low, medium, high}. The Skill never claims authority — every line ends with "consider", "suggest", or "review" framing. The advisory file is human-readable; the orchestrator may surface it in a PR comment but must NOT auto-block a merge on its contents.

A2 was retired in PR `ci-lint-pivot-success-margin` (deterministic gate: `scripts/check-pivot-success-margin.mjs`); A3 was retired in PR `ci-lint-anchor-primary-source` (deterministic gate: `scripts/check-anchor-primary-source.mjs`); A4 was retired in PR `ci-lint-measurement-inspects-output` (deterministic gate: `scripts/check-measurement-inspects-output.mjs`). All three slots are reserved (do not reuse for unrelated rules) so historical advisory entries that name "A2" / "A3" / "A4" remain readable.

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
- **Pivot threshold equals success threshold (zero numeric margin) or binary-equal prose** — caught by `scripts/check-pivot-success-margin.mjs` (was advisory rule A2; promoted per rule-#10 ratchet, 2026-05-03 quarterly audit).
- **Anchor citation is not a primary source** (deny-list of `medium.com` / `*.substack.com` / `wikipedia.org` / `twitter.com` / `x.com` / `reddit.com` / `stackoverflow.com` / `chatgpt.com` / `claude.ai` / "ChatGPT said" / "tweet by" / "blog post"; allowlist of italicised title / `Ch. <n>` / `pp. <n>` / DOI / ISBN / `<VENUE> <YEAR>` / `rule #<n>` / `vision.md §` / `spec-advisories/<date>.md`) — caught by `scripts/check-anchor-primary-source.mjs` (was advisory rule A3; promoted per rule-#10 ratchet, 2026-05-03 quarterly audit).
- **Measurement command runs but doesn't actually inspect output** — caught by `scripts/check-measurement-inspects-output.mjs` (was advisory rule A4; promoted per rule-#10 ratchet, 2026-05-03 quarterly audit).

If a new violation class is identified that *doesn't* fit any of the deterministic linters above and isn't one of A1, A5, the response per rule #10's ratchet is: **write the deterministic linter, not a sixth advisory rule**.

## Fixtures

- `test/judgement-only/` — fixtures that exercise the active advisory rules (A1, A5). The Skill should produce ≥1 advisory entry per fixture.
- `test/deterministic-overlap/` — fixtures that violate a *deterministic* rule (e.g., the experiment-record parser would already reject them, OR `scripts/check-pivot-success-margin.mjs` already catches a zero-margin pivot, OR `scripts/check-anchor-primary-source.mjs` already catches a non-primary anchor, OR `scripts/check-measurement-inspects-output.mjs` already catches an uninspected-output measurement). The Skill should be silent — the deterministic linter is the authority, not this Skill.

## Hard cap on scope

≤5 advisory rules. The active count is currently 2 (A2 + A3 + A4 retired, see above). Adding a sixth requires either:

1. Retiring one of A1, A5 because the residual judgement-scope it claimed turned out empty, OR
2. Shipping a deterministic linter for the new concern in the same PR (rule #10 ratchet).

Drift above 5 is itself a constitutional-violation against rule #10 and should be flagged by reviewers.

## Anchor

- vision.md § 10 (rule #10 — deterministic enforcement; whatever cannot be deterministically checked is not a constitutional rule)
- Havelund & Goldberg, "Verify Your Runs", *VSTTE* 2008 (runtime verification — split here into deterministic-monitor + advisory-judgement layers)
- Hunt & Thomas, *The Pragmatic Programmer*, 1999, Tip 32 ("crash early") — applied here as "fail deterministically; advise loosely"

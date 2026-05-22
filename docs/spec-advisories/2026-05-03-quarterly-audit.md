# Spec-Monitor Quarterly Audit — Q2 2026

- **Audit date**: 2026-05-03
- **Auditor**: agent (autonomous run)
- **Scope**: `novel/spec-monitor/SKILL.md` advisory rules A1–A5
- **Anchor**: `vision.md` § 10 (rule #10 — deterministic enforcement; ratchet rule)
- **Cadence**: quarterly per `audit-spec-monitor-coverage` task brief
- **Next audit due**: 2026-08-03 (filed as `audit-spec-monitor-coverage-q3-2026`)

## Rule count

- **5 / 5** (at the hard cap declared in SKILL.md § "Hard cap on scope").
- Deterministic enforcement of the cap: `scripts/check-skill-rule-cap.mjs` (shipped in PR #42, commit `0d19b08`). The cap is mechanically enforced — no manual count needed.

## Per-rule decision

| Rule | Concern | Decision | Rationale |
|------|---------|----------|-----------|
| A1   | Hypothesis vagueness | **Kept advisory** | Detecting "says-nothing" prose at ≥20 chars requires natural-language judgement; deterministic detection would either over-fire on every short hypothesis or under-fire by matching only a fixed phrase list (which is already partly handled by the `VANITY_PHRASES` list in `novel/experiment-record/src/parse.ts`). |
| A2   | Pivot reuses success threshold or zero margin | **Promoted to deterministic-candidate** | The `success` and `pivot` fields are strings, but in practice they encode numeric thresholds parseable by regex (e.g., `>= 95 %`, `< 85 %`). A linter can extract the leading numeric token from each, compute the absolute distance, and flag exact equality or sub-1 % margin. Confirmed feasible against `novel/experiment-record/src/parse.ts` which already exposes `success` and `pivot` as parsed string fields. Follow-up: `ci-lint-pivot-success-margin`. |
| A3   | Anchor not a primary source | **Kept advisory** | "Primary source" is judgement: a Medium post by a recognised author is sometimes valid (e.g., Martin Fowler's bliki); a Wikipedia citation can be valid for a well-established term; "rule #N (vision.md § N)" is valid but pattern-matching it is brittle. Deterministic detection would require either an allow-list of journals/textbooks (high maintenance) or a deny-list of domains (`medium.com`, `twitter.com`, `wikipedia.org`) that is too crude. Keep advisory. |
| A4   | Measurement runs but doesn't inspect output | **Promoted to deterministic-candidate** | A linter can pattern-match the `measurement` command for: (a) presence of `>/dev/null`, (b) absence of `test`, `[`, `jq -e`, `grep -q`, `assert`, or known test runners (`vitest`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, `npx @tasks-md/lint`, `markdownlint-cli2`), (c) trivially-degenerate forms (`echo done`, `true`). False-positive rate manageable with an allow-list of recognised inspector tokens. Follow-up: `ci-lint-measurement-inspects-output`. |
| A5   | Pattern-conformance level mismatch | **Kept advisory** | Determining whether `full` matches the source code requires semantic comparison of the cited paper's algorithm against the implementation — judgement-heavy. Deterministic detection would require a formal spec per pattern, which exceeds the ratchet's bar (the linter must be cheaper than the rule it replaces). |

## Follow-up tasks filed

- `ci-lint-pivot-success-margin` (P3) — see TASKS.md
- `ci-lint-measurement-inspects-output` (P3) — see TASKS.md

Per the rule #10 ratchet: the matching advisory rule (A2 / A4) stays in `novel/spec-monitor/SKILL.md` until the deterministic linter actually ships. Removal happens in the same PR that lands the linter, not before.

## Pivot signal (vs. SKILL.md hard cap)

This audit found 2 / 5 rules promoted to deterministic-candidates. Per the audit task's pivot threshold ("if every quarterly audit finds ≥1 deterministic-candidate, the Skill is leaking scope — reduce cap to 3"):

- This is the **first** quarterly audit; the trend cannot yet be assessed.
- Track: if the Q3 2026 audit also finds ≥1 promotion AND the candidates filed here are still open (i.e., the Skill never sheds rules), the cap-reduction pivot fires.

## Verification

- `awk '/^### A[0-9]+\\./' novel/spec-monitor/SKILL.md | wc -l` → 5
- `scripts/check-skill-rule-cap.mjs` exit 0 on `novel/spec-monitor/SKILL.md`
- This file exists at `spec-advisories/2026-05-03-quarterly-audit.md` and contains "Rule count"

## Anchor

- `vision.md` § 10 (rule #10 — deterministic enforcement; ratchet rule)
- Munafò et al., *Nature Human Behaviour* 1, 0021, 2017 (pre-registration of the audit's pivot threshold *before* the result was observed)

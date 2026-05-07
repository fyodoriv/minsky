# `@minsky/spec-monitor`

<!-- rule-1: claude-code-default-assistant rejected because: a generic Claude session has no scope cap — rule #10 requires the residual judgement scope be capped at ≤5 advisory rules and explicitly disjoint from the deterministic `scripts/check-rule-*.mjs` linters. A Skill with its own SKILL.md is the only mechanism that enforces the cap deterministically. -->

Advisory-only Claude Skill that complements the deterministic `scripts/check-rule-*.mjs` linters with at most 5 judgement-heavy advisory rules. Never gates CI.

See [`SKILL.md`](./SKILL.md) for invocation, scope, and the ratchet rule.

## Failure modes & chaos verification

Per constitutional rule #7. Spec-monitor has no runtime — it is a prompt-only Claude Skill — so its failure modes are about *operator* discipline rather than process state.

- **Steady-state hypothesis**: the deterministic `scripts/check-rule-*.mjs` linters always run (they are CI-required); the Skill's verdict is read by the operator in advisory form only.
- **Blast radius**: a single PR description / advisory file under `spec-advisories/`. The Skill never blocks merges (rule #10 + see Failure mode #1 below).
- **Operator escape hatch**: the Skill is opt-in. Operator may decline to invoke it; the deterministic linters remain authoritative.

| # | Failure mode                                              | Trigger / fault axis                          | Expected behavior                                                                                              | Chaos test                                                       |
|---|-----------------------------------------------------------|-----------------------------------------------|----------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------|
| 1 | Skill made required in CI                                 | misconfiguration                              | `loud-crash-supervisor-restart` — the EXPERIMENT.yaml's measurement (`grep -RE 'spec-monitor.*required' .github/workflows/`) fails the rule-#9 gate | covered by EXPERIMENT.yaml measurement assertion at PR time      |
| 2 | Operator skips Skill entirely on a non-trivial PR         | operator-skip                                 | `graceful-degrade` — deterministic `scripts/check-rule-*.mjs` linters still run; rule-#9 self-grade still required | covered by the existing rule-#9 + pr-self-grade CI jobs (deferred — covered when `audit-spec-monitor-coverage-q3-2026` ships) |
| 3 | Advisory rule count exceeds the SKILL.md cap (≤5)         | scope-creep                                   | `loud-crash-supervisor-restart` — adding a 6th rule requires retiring one OR shipping a deterministic linter for it; enforced by `scripts/check-skill-rule-cap.mjs` (rule-#10 ratchet applied to the Skill itself) | covered by the unit tests in `scripts/check-skill-rule-cap.test.mjs` (specifically the "6 rules → fail" case) |
| 4 | Skill misclassifies a deterministic violation as advisory | judgement-overlap                             | `graceful-degrade` — the deterministic linter still fires; the Skill's advisory is double-coverage, not blocker | covered by the deterministic-overlap fixture under `test/deterministic-overlap/` |
| 5 | Skill itself becomes load-bearing (process depends on its verdict) | inversion-of-rule-#10                         | `loud-crash-supervisor-restart` — rule #10 says non-deterministic checks are not constitutional rules; if a process is gating on the Skill's verdict, that process is misconfigured | (deferred — covered when `audit-spec-monitor-coverage-q3-2026` ships) |

## Threat model

STRIDE analysis per vision.md § 13 (Shostack, *Threat Modeling*, Wiley, 2014). The package is a prompt-only Skill with no runtime process; threat surface is operator discipline.

| Threat | Surface | Mitigation |
|---|---|---|
| Spoofing | PR descriptions crafted to manipulate Skill advisory output (prompt injection via PR body) | Skill is advisory-only; deterministic `scripts/check-rule-*.mjs` linters are authoritative |
| Tampering | `spec-advisories/*.md` files modified after-the-fact to falsify advisory history | Files are committed; git history is the authoritative audit trail |
| Repudiation | Advisory files carry no cryptographic provenance; any process could write them | Git commit signature identifies the session; operator reviews before merging |
| Elevation of Privilege | Skill promoted to a required CI gate, granting LLM output blocking power (Failure mode #1) | Enforced by `scripts/check-skill-rule-cap.mjs`; EXPERIMENT.yaml measurement detects accidental CI promotion |
| Information Disclosure | PR descriptions reviewed by Skill may contain sensitive context or credentials | `secret-scanning-precommit-and-ci` P0 prevents credential-bearing PRs from reaching review |

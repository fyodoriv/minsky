# `@minsky/spec-monitor`

<!-- rule-1: claude-code-default-assistant rejected because: a generic Claude session has no scope cap — rule #10 requires the residual judgement scope be capped at ≤5 advisory rules and explicitly disjoint from the deterministic `scripts/check-rule-*.mjs` linters. A Skill with its own SKILL.md is the only mechanism that enforces the cap deterministically. -->

Advisory-only Claude Skill that complements the deterministic `scripts/check-rule-*.mjs` linters with at most 5 judgement-heavy advisory rules. Never gates CI.

See [`SKILL.md`](./SKILL.md) for invocation, scope, and the ratchet rule.

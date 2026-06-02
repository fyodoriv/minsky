# Dependency-update policy

This document exists to answer one question for any agent or operator triaging a
Dependabot PR: **does this bump auto-merge, or does it need me?** It defines the
semver-triage rule (patch/minor → auto-merge; major → operator review) and points
at the deterministic seam that enforces it. For the Dependabot *mechanics* —
schedule, grouping, what it does and does not touch — see
[`docs/dependabot.md`](dependabot.md); this file is the *decision* layer on top.

## Why this policy exists

The 9-hour monitoring window on 2026-05-07 surfaced 8 stuck Dependabot PRs
(`actions/setup-python` 5→6, `actions/upload-artifact` 4→7, `markdownlint-cli2`
0.15→0.22, `hono` 4.12.16→4.12.18, three `@opentelemetry/*` bumps, and more),
all sitting red in CI. Most were major bumps with breaking-change semantics that
genuinely needed human eyes; a few were patch bumps that should have merged
themselves. Without a triage rule, both classes pile into the same backlog and
the safe patches get stuck behind the risky majors. The policy below splits them
by semver magnitude so the safe bumps drain automatically and the risky ones
surface loudly for the operator.

## The rule

| Bump magnitude | Action | Label | Rationale |
|---|---|---|---|
| **patch** (`x.y.Z`) | auto-merge once the local gate is green | (none) | bug-fix-only by the SemVer contract; lowest regression risk |
| **minor** (`x.Y.z`) | auto-merge once the local gate is green | (none) | additive, backward-compatible by the SemVer contract |
| **major** (`X.y.z`) | hold for operator review | `needs-operator` | breaking-change surface; a human (or PR-review agent) must scrutinise it |
| **unparseable** | hold for operator review | `needs-operator` | fail safe — never auto-merge a bump we can't classify |

"Auto-merge once the local gate is green" means the local merge gate
(`scripts/local-gate-merge.mjs`) may merge the PR unattended after
`pre-pr-lint --stage=full` passes. GitHub Actions is disabled on this repo
(operator decision — every merge is locally vetted, not via cloud runners), so
there is no `gh pr merge --auto` workflow; the local gate is the functional
equivalent. See [`docs/dependabot.md` § "Why no GitHub Actions auto-merge
workflow"](dependabot.md#why-no-github-actions-auto-merge-workflow).

## How it is enforced

Two halves, both deterministic (vision.md rule #10 — no LLM in a load-bearing
gate):

1. **Grouping half — `.github/dependabot.yml`.** Every npm and github-actions
   group declares `update-types: [minor, patch]` only. Major bumps are therefore
   never folded into a group; Dependabot opens them as individual PRs. The
   `dependabot-triage.test.mjs` suite pins this so a future edit can't widen a
   group to swallow major bumps.
2. **Triage half — `scripts/dependabot-triage.mjs`.** A pure decision function,
   `classifyDependabotBump({ fromVersion, toVersion })`, returns the bump type,
   the action (`auto-merge` / `needs-operator`), and the label to apply. The
   local merge gate consumes `mayAutoMerge(bump)` to decide whether to merge
   unattended; majors get the `needs-operator` label (the established
   actor-label convention from `scripts/self-diagnose.mjs`) and are skipped.
   Dependabot's config cannot conditionally label by bump magnitude, so the
   label is applied at the local triage seam, not in `dependabot.yml`.

Note on `0.x` versions: by the SemVer arithmetic in `classifyDependabotBump`, a
`0.57 → 0.217` bump is classified as **minor** (the major component `0` is
unchanged). Coupled `0.x` families like `@opentelemetry/*` are kept consistent by
the *grouping* in `dependabot.yml` (they bump together in one PR), not by per-PR
major-classification. This is a deliberate split of concerns: grouping handles
version-coupling; triage handles breaking-change risk.

## When to manually close or hold a Dependabot PR

This list complements [`docs/dependabot.md` § "When to manually close a
Dependabot PR"](dependabot.md#when-to-manually-close-a-dependabot-pr):

- A `needs-operator` major bump that breaks Minsky's APIs (e.g. `biome 1.x → 2.x`
  changing CLI flags): close it, file a `dep-upgrade-<package>` task with the
  migration plan, and revisit in a migration window.
- A `needs-operator` major bump that is mechanical and safe after review: drop
  the `needs-operator` label and let the local gate merge it.

## Anchors

- SemVer 2.0.0 (<https://semver.org>) — the `MAJOR.MINOR.PATCH` contract the
  triage classifies against.
- Dependabot best practices (docs.github.com) — auto-merge low-risk updates,
  review breaking changes.
- NIST SP 800-218 SSDF PW.4 (manage third-party software security).
- OWASP Top 10 A06:2021 (vulnerable and outdated components).
- vision.md rule #10 (deterministic enforcement) and rule #2 (every dependency
  accessed through a pure-decision seam).

# Dependabot

Minsky uses Dependabot for automated dependency updates. Config: [`.github/dependabot.yml`](../.github/dependabot.yml).

## Schedule

Weekly on Monday 06:00 UTC. Security updates open immediately on disclosure (Dependabot's documented behaviour — security alerts bypass the schedule and the open-PR limit).

## Grouping

Related packages bump together so version-coupled families don't deadlock. Three groups:

- **`opentelemetry`** — every `@opentelemetry/*` package (minor + patch). The OTel ecosystem couples `exporter-*-otlp-http`, `core`, `api-logs`, `sdk-metrics`, etc. via internal version axes; merging one at a time produces version-skew failures in `novel/adapters/observability/package.json` (which mixes `0.57.x`, `2.7.x`, and `0.217.x` today). One grouped PR per week is the only safe shape.
- **`dev-dependencies`** — bundlers, linters, test runners, type packages (minor + patch).
- **`runtime-dependencies`** — everything else in `dependencies` (patch + minor), excluding `@opentelemetry/*` which is already in its own group.

**Major upgrades for any group** are not auto-included. Dependabot opens them individually so a human (or agent doing PR review) can scrutinise the breaking-change footprint.

## What Dependabot does NOT touch

- **Transitive dependencies** — `allow.dependency-type: direct` skips bumps for packages we don't depend on directly. Transitive packages update through their parent.
- **Major version jumps** for grouped packages — those open separately.
- **The lockfile when nothing else changed** — `versioning-strategy: increase-if-necessary` prevents "no-op" PRs.

## Merging Dependabot PRs

GitHub Actions is disabled on this repo, so PRs never reach `mergeStateStatus=CLEAN` automatically. Use the local merge gate:

```bash
# Merge a single Dependabot PR:
node scripts/local-gate-merge.mjs --pr=<N> --no-review

# Drain every mergeable Dependabot PR (dry run first):
node scripts/local-gate-merge.mjs --dry-run
node scripts/local-gate-merge.mjs --no-review
```

The gate rebases the PR's head onto `origin/main` in a scratch worktree, runs `pre-pr-lint --stage=full`, and admin-merges if everything is green. `--no-review` skips the Claude Opus brain layer (Dependabot updates are mechanical and don't need it).

## When to manually close a Dependabot PR

- A grouped PR (e.g., `opentelemetry`) supersedes earlier individual-package PRs that were open before the grouping landed. Close the supersedees with a comment pointing to the grouped survivor.
- A major version bump arrives that breaks Minsky's APIs (e.g., `biome 1.x → 2.x` changes CLI flags). Close it, file a P2 task with the migration plan, and revisit when we have a migration window.
- A package is being intentionally pinned to an older version (e.g., we deliberately stay on `pnpm@9.x` until the OMC interop quirks for `10.x` are resolved). Add the pin to `ignore:` in the dependabot config so future bumps don't reopen.

## Security override

If a security alert opens for a package outside any group, Dependabot will open an individual PR that bypasses the schedule and the group settings. These should be merged ASAP — `node scripts/local-gate-merge.mjs --pr=<N> --no-review` handles them the same way.

## Why no GitHub Actions auto-merge workflow

The natural fit would be `dependabot/fetch-metadata` + `gh pr merge --auto`. We don't ship that because GitHub Actions is disabled on this repo (operator decision: every merge is locally vetted via the `local-gate-merge` substrate, not via cloud runners). The local gate is functionally equivalent — same `pre-pr-lint --stage=full` pass that GHA would run — and it's free.

## Anchors

- NIST SP 800-218 SSDF PW.4 (manage third-party software security)
- OWASP Top 10 A06:2021 (vulnerable and outdated components)
- Dependabot grouped-updates documentation (`docs.github.com/en/code-security/dependabot/dependabot-version-updates/configuration-options-for-the-dependabot.yml-file#groups`)

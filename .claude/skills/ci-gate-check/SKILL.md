---
name: ci-gate-check
description: Predict which CI jobs will fail for the current branch's changes before opening a PR. Use before /poll-merge or any time you want to know which of Minsky's 35+ CI gates a change must pass, what each gate enforces, and how to fix common violations. Surfaces the exact failing job name and remediation command.
allowed-tools: Bash, Read
---

# CI gate check

Minsky's CI has 35+ jobs. Pushing without knowing which gates apply wastes CI minutes and blocks /poll-merge. This skill maps your changed files to the jobs that will run, predicts failures, and tells you the exact fix command.

## Args

No argument required — reads the current diff automatically. Optional: pass a job name to get the remediation recipe for a specific failure.

`/ci-gate-check` — predict all relevant jobs for `git diff main`
`/ci-gate-check pr-self-grade` — remediation recipe for that specific job

## Step 1 — Identify changed files

```bash
git diff --name-only main...HEAD
```

## Step 2 — Map files to gates

| Changed file pattern | CI job(s) triggered |
|---|---|
| `**/*.md` | `markdownlint` |
| `TASKS.md` | `tasks-lint`, `rule-12-scope-discipline` |
| `vision.md` | `glossary-discipline`, `rule-12-scope-discipline`, `vision-rule-13-task-id-citations`, `vision-rule-13-non-task-anchors` |
| `novel/adapters/**` | `rule-2-dep-coverage`, `typecheck`, `test` |
| `novel/**/*.ts` | `biome`, `typecheck`, `test`, `rule-4-otel-coverage` |
| `scripts/check-*.mjs` | `test` (the corresponding `*.test.mjs`) |
| `distribution/**/*.sh` | `linux-supervisor-integration` (also run `/live-fire-smoke`) |
| `distribution/**/*.plist`, `*.service` | `linux-supervisor-integration` |
| `experiments/*.yaml` | `experiment-tracker` |
| `.github/workflows/**` | N/A — GitHub validates on push |
| `package.json`, `pnpm-lock.yaml` | `lockfile-integrity`, `sbom-shape` |
| PR description body | `pr-self-grade`, `cto-audit-pr-conventions` |
| Any PR | `secret-scan`, `pr-security-review` |

## Step 3 — Run the local equivalents

Run these locally to catch failures before pushing:

```bash
# Always (fast, <30s)
pnpm exec biome check .
pnpm typecheck
npx markdownlint-cli2@0.15.0 "**/*.md" "#**/node_modules" "#.minsky" "#.claude"
npx @tasks-md/lint@^0.7.0 TASKS.md

# When novel/** changed
pnpm vitest run

# When vision.md or TASKS.md changed
node scripts/check-rule-5-glossary-discipline.mjs
node scripts/check-rule-12-scope-discipline.mjs    # if it exists

# When experiments/*.yaml changed
node scripts/check-anchor-primary-source.mjs       experiments/*.yaml
node scripts/check-measurement-inspects-output.mjs experiments/*.yaml
node scripts/check-pivot-success-margin.mjs        experiments/*.yaml

# When novel/adapters/** changed
node scripts/check-rule-2-dep-coverage.mjs
node scripts/check-rule-4-otel-coverage.mjs

# When distribution/** changed — use live-fire-smoke skill instead
```

## Common CI failures and their fixes

### `markdownlint`

```
Error: MD013/line-length Line length [Expected: 80; Actual: 123]
```

Fix: wrap the long line. The `.markdownlint-cli2.yaml` config file shows the exact rules.

```bash
npx markdownlint-cli2@0.15.0 "**/*.md" "#**/node_modules" "#.minsky" "#.claude"
```

### `tasks-lint`

```
Error: task block missing required field: Hypothesis
```

Fix: add the missing field to the TASKS.md task block. The schema is in `user-stories/001-loop-runs-overnight.md`.

### `pr-self-grade`

```
Error: PR body missing ## Hypothesis self-grade section
```

Fix: add the self-grade block to the PR body. The required format is:

```markdown
## Hypothesis self-grade
- **Predicted**: [numeric movement]
- **Observed**: [actual measurement from the measurement command]
- **Match**: [Yes/No — ≥ success threshold?]
- **Lesson**: [one sentence]
```

Then push an empty commit to trigger re-run (GitHub Actions doesn't auto-rerun on body-only edits):

```bash
git commit --allow-empty -m "ci: trigger re-run after pr-self-grade fix"
git push
```

### `rule-2-dep-coverage`

Every external dependency must be accessed through a `novel/adapters/` interface. If you called a third-party library directly in `novel/`:

```bash
node scripts/check-rule-2-dep-coverage.mjs
```

The error will name the file and the import. Create or extend an adapter.

### `glossary-discipline`

A term used in `vision.md` lacks a Glossary entry. Add the term to `vision.md § Glossary` with a one-sentence definition.

### `rule-12-scope-discipline`

A non-trivial PR introduces new public API without a corresponding `experiments/<id>.yaml`. Either:
- Add the pre-registration yaml (`/experiment-validate` to verify it), or
- Remove the new public API (if the feature is out of scope)

### `lockfile-integrity`

`pnpm-lock.yaml` is out of sync with `package.json`. Fix:

```bash
pnpm install
git add pnpm-lock.yaml
```

### `secret-scan`

A string matching a secret pattern was detected. Remove the secret. If it's a false positive, add the token pattern to the allowlist (check the workflow for the allowlist config).

### `biome`

```bash
pnpm exec biome check . --write   # auto-fix safe issues
pnpm exec biome check .           # verify
```

### `typecheck`

```bash
pnpm typecheck
```

Fix all TypeScript errors before pushing. CI blocks on type errors.

## CI job dependency order

Jobs run in parallel, but logical dependencies apply:

```
Fast gates (always run):
  markdownlint, tasks-lint, biome, secret-scan, lockfile-integrity

Type + test (run after fast gates pass locally):
  typecheck → test

Rule enforcement (run after test):
  rule-2-dep-coverage, rule-4-otel-coverage, glossary-discipline,
  rule-12-scope-discipline, pattern-index

PR-level gates (run on PR creation/update):
  pr-self-grade, cto-audit-pr-conventions, pr-security-review

Integration (heaviest, run last):
  linux-supervisor-integration
```

## When all local checks pass but CI still fails

1. Check if the CI job runs a script that doesn't exist locally — some jobs are CI-only.
2. Check if the PR body is missing a required section — `pr-self-grade` and `cto-audit-pr-conventions` check the PR body, not the code.
3. Check if the failure is in a matrix job — some jobs run on multiple OS/Node combos.

```bash
gh pr checks <pr-number> --watch   # stream live CI status
gh run view <run-id> --log-failed  # read the logs of failed jobs
```

## What this skill does NOT replace

- `/live-fire-smoke` — stripped-env smoke for `distribution/**` changes; CI can't replicate launchd's environment
- `/experiment-validate` — full 4-lint pre-registration check; this skill only lists which jobs will run, not whether the yaml schema is valid

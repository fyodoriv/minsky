---
name: pr-merge-no-shortcuts
description: Primes an agent against the close-with-preservation anti-pattern when running PR backlog drains. When the operator says "merge", "drain the queue", "ship the backlog", "merge all open PRs", or any equivalent, the agent MUST either land each PR's commit on `main` OR close it with mechanical empty-diff proof. Closing PRs as "preserved via GitHub retention" or "tracked via umbrella task" is FORBIDDEN by vision.md rule #18 and is the failure mode this skill is designed to interrupt. Use whenever the upcoming work involves closing more than one open PR.
allowed-tools: Bash, Read, Grep
---

# PR merge — no shortcuts (rule #18 enforcement primer)

## The one-line rule

A "merge" directive has succeeded only when the PR's commit is on `main`, OR you have written an empty-diff proof comment on the closed PR. Anything else is the rule-#18 anti-pattern.

## Why this skill exists

The 2026-05-21 backlog drain produced the same regression **twice in the same day**:

1. **Morning pass**: 32 PRs closed with "the diff is preserved via GitHub closed-PR retention" rationale → operator caught it ("Why tf did you close prs if they contain anything useful?") → all 32 reopened, only 3 verified subsumed.
2. **Evening pass** (PR #695): 16 PRs closed again, this time with "umbrella task tracks the recovery patches" rationale → same anti-pattern, different wrapper.

Both passes happened because the agent ran out of session budget mid-drain and rationalised a fast close-rate as progress. The PRs stay off `main`, off anyone's radar, and the work effectively disappears.

This skill is the primer that interrupts that pattern **before** the rationalisation crystallises.

## When you are about to drain a queue

Before closing **any** PR that you did not personally rebase-merge in the same session, run the verifier:

```bash
node scripts/verify-pr-closure-is-lossless.mjs <PR-NUMBER>
```

The script:
1. Fetches the PR's branch
2. Runs `git rebase --strategy-option=ours origin/main` against the PR's branch
3. Checks `git diff origin/main..HEAD` is empty
4. If empty → writes a one-line proof comment on the PR with the rebase SHA → green light to close
5. If non-empty → exits non-zero with the surviving diff path → **do not close** (the work is not on main)

## Decision table

| Situation                                            | Allowed action                                                                |
| ---------------------------------------------------- | ----------------------------------------------------------------------------- |
| PR is MERGEABLE and gate-green (`MERGEABLE/CLEAN`)   | `gh pr merge <N> --squash --admin --delete-branch`                            |
| PR is **MERGEABLE BLOCKED, blocker = review-required only**, all substantive checks green | `gh pr merge <N> --squash --admin --delete-branch` IS pre-approved by the AGENTS.md rule on admin-merging your own PR. Confirm the blocker IS review-only — run the `verify-blocker-is-review-only` check below before pulling the trigger. **Always preferred fallback**: poll-merge with `--auto` first; admin-merge only if review never comes. |
| PR is CONFLICTING                                    | Rebase first (`git rebase -X theirs origin/main`); if still conflicting, fix the conflict; merge. Closing without rebase is forbidden. |
| PR has a substantive check failing (Build, security scan, BundleScan, vitest, biome, pre-pr-lint stage) | **DO NOT admin-merge**. Fix the failure first. Admin-merging over a substantive failure is the path to broken main. |
| PR is "superseded" by another PR or main commit      | Run the lossless verifier. ONLY close if it writes the empty-diff proof.       |
| PR is stale / WIP / experimental and operator says "close" | OK to close, but only after the operator explicitly says so per-PR (not via blanket directive).  |
| Out of session budget, queue still has open PRs       | **STOP**. File a TASKS.md entry naming each remaining PR by number. Do not close them as "preserved".  |

## The review-only-blocker exception (when admin-merge IS approved)

The operator's standing instruction (most recently confirmed 2026-05-22): *"Remember that there might be a review requirement. IF everything else passes, you can admin merge."*

This is the **same rule** as the AGENTS.md "admin-merge YOUR OWN current-repo PR" carve-out, with the trigger explicitly extended to cover "blocked only on review" (not just "unblock an autonomous loop"). The three conjunctive conditions remain:

1. **The PR is yours** in the current repo (author = the agent or operator who started this session).
2. **Every failing check has a non-substantive cause** — review-required gate, codeowner approval, branch-protection-review-count. NOT: Build / security scans / BundleScan / vitest / biome / pre-pr-lint / typecheck / any rule-N lint.
3. **Substantive checks pass** — at minimum: `ci` (the top-level required check), all `pnpm pre-pr-lint --stage=full` stages green via the per-stage CI jobs, secret-scan, dependency-cruiser, knip.

Before pulling the trigger, run the verifier:

```bash
# 1. Confirm mergeable state
gh pr view <N> --json mergeable,mergeStateStatus -q '.mergeable + " " + .mergeStateStatus'
# expected: MERGEABLE BLOCKED   (BLOCKED only — not UNSTABLE which would mean failing checks)

# 2. Confirm every failed/pending check is review-shaped, not substantive
gh pr checks <N> 2>&1 | grep -vE "^(pass|skipping)" | head
# expected: only review-required / codeowner / approval shapes; NEVER a CI/lint/test name

# 3. Confirm all CI jobs are green
gh pr checks <N> | awk '{print $2}' | sort -u
# expected: only "pass" (no "fail" lines)
```

If steps 1-3 all confirm — admin-merge IS approved by the operator's standing instruction. The merge command:

```bash
gh pr merge <N> --squash --admin --delete-branch
```

**Always document the admin-merge in the PR body before merging** — add a one-line note "Admin-merged per AGENTS.md review-only-blocker carve-out; substantive checks all green at <SHA>" so the audit trail is clear.

**If a substantive check is failing**, the carve-out does NOT apply. Fix the check first. Filing a "the lint is broken in main, my PR didn't introduce it" scout task is acceptable to document the unrelated cause — but DO NOT admin-merge over a substantive failure unless the operator gives fresh per-PR approval.

## Trigger phrases that authorize admin-merge in the current session

The operator has standing approval for admin-merge on the operator's own PRs in the current repo. The phrases below activate it without further per-PR approval (subject to the 3 conditions above):

- "merge this", "land this", "get this merged" (after the PR is green except for review)
- "get everything merged" (sweep mode — applies to every open PR you authored in this session)
- "admin merge if needed", "admin-merge it"
- "IF everything else passes, you can admin merge" (the exact phrase that confirmed the standing rule on 2026-05-22)

The phrases below do NOT activate it — fresh approval required:

- "merge this" on a PR with substantive failures (Build / lint / test) → first fix the failures
- "merge this" on someone else's PR → cross-author admin-merge always needs explicit per-PR approval
- "force merge" / "merge over the failures" → always needs explicit per-PR approval naming the failing check

## Forbidden phrasings (each is a rule-#18 violation)

Any PR closure comment, commit message, or session log containing one of these is the anti-pattern:

- "preserved via GitHub closed-PR retention"
- "recoverable via `gh pr diff`"
- "tracked by umbrella task"
- "CONFLICTING — closing for cleanup"
- "superseded by parallel implementation" (without lossless-verifier proof)
- "patch file in `.minsky/preserved-diffs/`" (the directory is gitignored — the patch evaporates on clone)

## Pivot check (run at every hour boundary while draining)

```bash
gh pr list --state=open --json number,closedAt --jq 'length' # currently open
gh pr list --state=closed --search "closed:>=$(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ) -is:merged" --json number --jq 'length' # closed in last hour, NOT merged
gh pr list --state=merged --search "merged:>=$(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ)" --json number --jq 'length' # merged in last hour
```

If `closed-not-merged > merged` for two consecutive hours, STOP. The session is doing the wrong thing. Escalate to the operator with the queue snapshot.

## Operational discipline — observed 2026-05-21 PM session (15 PRs merged in 2h)

These are tactical patterns the session learned through 18 merges. Each one prevents a class of self-inflicted failure.

### 1. Work in an isolated worktree, not the main repo dir

Parallel agent sessions (Devin in another tab, the auto-merge launchd, etc.) can `git reset --hard` or `git checkout` the main repo dir mid-edit, wiping uncommitted work. Use:

```bash
git worktree add /tmp/minsky-<task> -b <branch> origin/main
cd /tmp/minsky-<task>
```

The `/tmp/<dir>` path is unique-per-PR and untouchable by other agents. The branch lives on the same git object store but the working tree is yours alone.

### 2. After every squash-merge, verify the file list actually landed

Observed 2026-05-21: PR #704's source commit had `.releaserc.json` in its `--stat`, but the squash-merge commit on main did NOT include it (the file appeared identical to base after some intermediate state). Result: the lint failure I thought I fixed was still failing on main.

Verify with:

```bash
gh pr view <N> --json files --jq '.files[].path'
# Compare against the expected file list from your local commit's `git show <sha> --stat`
```

If a file you committed is missing from the PR's file list, you have to ship it in a separate PR — the squash already happened.

### 3. Don't trust `pnpm install --frozen-lockfile` to resolve per-arch optional deps

Observed 2026-05-21 (pnpm 9.12.0): linux/x64 CI runners did NOT install `@biomejs/cli-linux-x64@1.9.4` even though it was in the lockfile, because:

- (a) The user-level `optionalDependencies` block pinned only one arch (`darwin-arm64`) — pnpm interpreted this as "skip the others", and
- (b) Even after removing the over-restrictive pin, `--frozen-lockfile` still skipped per-arch optionals that were locked at a different host than the one running install.

**Fixes** in order of preference:
1. Don't pin individual arch packages at the user `package.json` level — let the upstream tool (biome, esbuild, swc) handle its own optionalDependencies block. Pinning ONE arch silently drops the others.
2. If a workflow has a bot commit that runs lefthook + check-toolchain, prefer `git config core.hooksPath /dev/null` over trying to install the right per-arch package. The bot's commit is from a verified actor on a paths-restricted change; the local-dev biome lint isn't the right gate.

### 4. The pre-pr-lint `biome` step needs `--no-errors-on-unmatched`

Otherwise it exits 1 on every docs-only / yaml-only / TASKS-only PR (because `--changed --since=origin/main` sees no biome-lintable files). That exit-1 cascades into:

- `lefthook pre-push hook → push aborted`
- `semantic-release's git push --tags → release workflow fails`

Verify your fork has this fix landed (PR #702 added the flag). If not, add it to `scripts/run-pre-pr-lint-stack.mjs`.

### 5. CI workflows must use `node-version-file: '.node-version'`, never a bare version literal

Observed 2026-05-21: half the workflows had `node-version: "20"` while `.node-version` pinned `24.14.0`. Lefthook's check-toolchain (which runs in the experiment workflow's bot commit) fails loudly on the version mismatch. The fix-class is: every `actions/setup-node@v6` step reads from `.node-version`, never a literal.

### 6. Adding a kebab-case skill primer requires updating `scripts/glossary-allowlist.txt` in the same PR

Rule #5's `glossary-discipline` lint flags any backticked kebab-case identifier in `vision.md` that doesn't resolve to a Glossary row, a Pattern conformance index row, or the allowlist. When you add a new skill primer to `.claude/skills/<name>/` and reference it in `vision.md` (or any rule's enforcement section), add the same `<name>` to `scripts/glossary-allowlist.txt` in the same commit. The allowlist is the right anchor for skill names because the SKILL.md file itself is the anchor.

### 7. The release workflow can't push back to main behind branch protection

`@semantic-release/git` plugin tries to commit CHANGELOG + version bump to main. The built-in `GITHUB_TOKEN` doesn't bypass branch protection. The fix-class:

- Remove `@semantic-release/git` from `.releaserc.json` plugins (PR #703 took this path — GH Releases still produced, CHANGELOG.md becomes a frozen artifact)
- OR provision a PAT with `admin:write_repo` scope as a repo secret and switch the workflow's token (more credential surface)

The first is the cheaper path and aligns with operator preference (`"set up github releases for this"`).

### 8. The `<package>/test/*.test.ts` vs `<package>/src/*.test.ts` orphan-test trap

Observed 2026-05-21 in `novel/tui/`: PR #639's `test/*.test.ts` files referenced functions from PR's `src/*.ts` files that I REJECTED during conflict resolution (kept main's source). The result: test files referenced `formatProcRow`, `renderDetail`, `gatherMachineRaw` that didn't exist in main's source → 13 broken tests, only caught by the full-tree CI test:coverage job (not the diff-scoped pre-push gate).

Fix-class during conflict resolution: when you take main's source over PR's source, you must ALSO take main's tests (or delete PR's tests that reference the rejected API). The orphan-test detector is filed as a TASKS.md follow-up.

## Anchor

- `vision.md` § 18 — the iron rule itself
- `scripts/verify-pr-closure-is-lossless.mjs` — the mechanical proof
- `scripts/local-gate-merge.mjs` — the real merge path (never closes)
- 2026-05-21 morning drain (32 PRs reopened) + evening drain (16 PRs merged for real) + CI-stabilization sweep (8 cascading fixes) — the empirical justification

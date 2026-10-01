---
name: poll-merge
description: Wait for a GitHub PR to reach `MERGEABLE/CLEAN`, then squash-merge and delete its branch. Use when the user says "merge #N when CI passes", "poll-merge it", "wait then merge", or any phrase about waiting on CI before a merge. Replaces the inline `until ... gh pr merge` loop.
allowed-tools: Bash
---

# Poll-merge

Wait-for-CLEAN-then-merge loop for a GitHub PR. Use whenever you've just opened (or fixed up) a PR and want to land it as soon as CI passes — without tying up the foreground turn polling.

## Args

The skill accepts one required argument: the PR number.

- `/poll-merge 142` — wait for PR #142 then squash-merge.
- `/poll-merge 142 --no-delete` — same but keep the branch (rare; default is delete).

## Behaviour

```bash
gh pr merge "$pr" --squash --delete-branch
```

…wrapped in a 60-second polling loop that:

1. Reads `gh pr view <pr> --json state,mergeStateStatus`.
2. Exits the loop early if state is `MERGED` or `CLOSED`.
3. Runs the merge if `mergeStateStatus` is `CLEAN` (all required checks green; no conflicts).
4. Aborts with a `[block-dirty]` log line if `mergeStateStatus` is `DIRTY` (rebase conflict — operator handles).
5. Otherwise sleeps 60s and re-checks.

## Run it in the background

The `until ... done` loop is the right shape but must run in the background — invoking it in the foreground blocks the turn. Use the Bash tool's `run_in_background: true`:

```bash
while true; do
  s=$(gh pr view PR --json state,mergeStateStatus --jq '.state + "/" + .mergeStateStatus' 2>&1)
  echo "[poll-PR] $s"
  if echo "$s" | grep -q '^MERGED'; then break; fi
  if echo "$s" | grep -q '^CLOSED'; then break; fi
  if echo "$s" | grep -qE '/CLEAN'; then
    gh pr merge PR --squash --delete-branch 2>&1 | tee -a /tmp/prPR-merge.log; break
  fi
  if echo "$s" | grep -qE '/DIRTY'; then echo "[block-dirty]"; break; fi
  sleep 60
done
echo "[final PR] $(gh pr view PR --json state --jq .state)"
```

The Bash background task fires its own completion notification when the inner `gh pr merge` lands — the next agent turn picks up the `<task-notification>` and can immediately sync main, run the next step, etc. This is the canonical "wait for CI then move on" pattern in this repo.

## Escalating from BLOCKED → admin-merge (review-only-blocker)

When the poll-loop has been spinning on `MERGEABLE/BLOCKED` for several cycles AND all substantive checks are green, the blocker is almost always a **review-required gate** (codeowner approval, required-reviews-count, branch-protection-review-count). The operator's standing instruction covers this case: *"IF everything else passes, you can admin merge."* See `pr-merge-no-shortcuts/SKILL.md` § "The review-only-blocker exception" for the full carve-out.

The polling loop should escalate after **5+ minutes of BLOCKED with all CI green**. The escalation pattern:

```bash
# After ~5 polling cycles (5 minutes) of MERGEABLE/BLOCKED:
fails=$(gh pr checks <N> 2>&1 | awk '{print $2}' | grep -c "^fail$")
pending=$(gh pr checks <N> 2>&1 | awk '{print $2}' | grep -c "^pending$")

if [[ "$fails" -eq 0 ]] && [[ "$pending" -eq 0 ]]; then
  # All checks green, only blocker is review → operator-approved admin-merge path
  echo "[escalate-admin-merge] PR <N> BLOCKED only on review; substantive checks all green"
  gh pr merge <N> --squash --admin --delete-branch
  break
else
  echo "[wait-real-failure] $fails failed, $pending pending — NOT admin-merging"
  # continue polling
fi
```

**Never admin-merge when `fails > 0` or `pending > 0`** — that's the case the carve-out does NOT cover. Fix the failure first.

For a one-shot "wait then admin-merge if needed" pattern (e.g., this session's three-PR sweep), the inline form is:

```bash
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  state=$(gh pr view <N> --json mergeable,mergeStateStatus -q '.mergeable + " " + .mergeStateStatus')
  echo "[$i] $state"
  if [[ "$state" == "MERGEABLE CLEAN" ]]; then
    gh pr merge <N> --squash --delete-branch --auto
    break
  elif [[ "$state" == "MERGEABLE BLOCKED" ]] && [[ "$i" -gt 5 ]]; then
    # 5+ cycles of BLOCKED — check if blocker is review-only
    fails=$(gh pr checks <N> 2>&1 | awk '{print $2}' | grep -c "^fail$")
    pending=$(gh pr checks <N> 2>&1 | awk '{print $2}' | grep -c "^pending$")
    if [[ "$fails" -eq 0 ]] && [[ "$pending" -eq 0 ]]; then
      gh pr merge <N> --squash --admin --delete-branch
      break
    fi
  fi
  sleep 30
done
```

## When NOT to use this

- The PR has known **failing** checks (any check with state `fail`). Fix them first — admin-merge does NOT cover this.
- The PR has unresolved review **comments** (a reviewer left actionable inline feedback). Address them first. *Note: this is different from "review required but no reviewer assigned" — that's the admin-merge case.*
- You're stacking PRs and need #N+1 to wait for #N — better to rebase #N+1 onto main once #N merges, rather than chaining poll-merges.

## Failure modes

- **`pr-self-grade` fails on a PR you just edited the body of**: GitHub Actions doesn't auto-rerun on body-only edits. Push an empty commit (`git commit --allow-empty -m "ci: trigger re-run"`) to force a fresh CI run.
- **`BLOCKED` mergeStateStatus persists indefinitely**: usually a required check failed. `gh pr checks <pr>` to surface the failures; fix before the poll-loop can proceed.
- **`UNKNOWN` mergeStateStatus**: GitHub is computing — sleep and re-check; usually resolves within 30s.

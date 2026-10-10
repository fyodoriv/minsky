<!-- pattern: not-applicable — reference file of skill-plugins/observer/minsky/SKILL.md, covered by that skill's pattern-index row -->

# Minsky observer — §5 Swift-PR (escalation path)

This file exists so the observer skill stays short. It holds the full §5 Swift-PR procedure: picking the upstream repo, the PR body template, and the PR creation commands. Read it when a failure needs a code fix instead of a safe heal.

## Contents

- §5 Swift-PR (the escalation path)
  - Picking the upstream repo
  - The PR body template
  - The PR creation commands

## 5. Swift-PR (the escalation path)

When the restart budget is exhausted OR a failure matches the
"escalate immediately" patterns (scope-leak, rule-#9 violation at the
runner level, segfault / panic), open a **draft** P0 PR in the correct
upstream repo within 5 minutes. The speed matters: the operator is
often concurrently editing TASKS.md, so a slow PR risks merge conflicts.

### Picking the upstream repo

| Failure source | Upstream |
|---|---|
| Runner bug (spawn logic, CTO audit, walker, shim) | the minsky repo (`$MINSKY_REPO`) |
| `minsky-bootstrap` / sidecar bug | the minsky repo (`$MINSKY_REPO`) |
| Host-specific (task missing rule-#9 fields, host config broken) | the host repo itself |
| Claude API outage | neither — tell the operator + stop restarting |

If unsure, open it against Minsky — the maintainers can re-route.

### The PR body template

Every observer-filed PR follows this shape (fields in angle brackets
are to be filled by the observer; 4-backtick fence outer block so the
inner code blocks survive the copy-paste):

````markdown
# observer: <one-line failure headline>

## Why this is needed

Seen on `<host-repo-url>` at `<UTC timestamp>`. `minsky-run` produced
the following failure pattern `<N>` times in `<M>` minutes:

```
<redacted stderr tail, ≤40 lines>
```

## Pattern class

`<scope-leak | spawn-failed | rule-9-violation | crash | stuck>`

## Repro

```bash
cd <host-dir>
MINSKY_NON_INTERACTIVE=1 minsky --max-iterations=1 --tick-interval-ms=0
```

## Suggested P0 TASKS.md block

(Paste into TASKS.md if this is the right upstream.)

- [ ] `observer-<short-id>-<date>` — `<task title>`
  - **ID**: `observer-<short-id>-<date>`
  - **Tags**: `p0, observer-filed, <pattern-class>`
  - **Hypothesis**: `<what the observer expects the fix to change>`
  - **Success**: `<measurable threshold>`
  - **Pivot**: `<decision boundary>`
  - **Measurement**: `<runnable command>`
  - **Anchor**: `<literature ref>; rule #<N>`

## Hypothesis self-grade

- **Predicted**: this failure recurs without intervention at rate `<X>`.
- **Observed**: `<N>` occurrences in `<M>` minutes on `<host>`.
- **Match**: partial (need the fix to know if it drops to 0).
- **Lesson**: `<one line>`.

Protocol version: v1

*🤖 Filed by the minsky observer. See Minsky's `skill-plugins/observer/minsky/SKILL.md` § 5.*
````

**Always carry the `Protocol version: v<N>` line** — it pins each
observer-filed PR to the exact protocol revision the observer followed,
so a post-incident audit can read the PR against the protocol-as-of-that-PR
rather than against today's (possibly evolved) protocol. The version is
the `protocol_version` value in this SKILL.md's frontmatter; bump both
the frontmatter and the `## Changelog` below whenever the protocol changes
substantively (a new section, a changed escalation boundary, a new heal
class). Pure metadata — it adds an audit trail, not a behaviour change.

### The PR creation commands

```bash
# Always draft — rule-9 requires the fix to be human-reviewed.
cd $MINSKY_REPO   # or the host repo
git switch -c observer-<short-id>-$(date +%Y-%m-%d)
# Optional: append the P0 task block to TASKS.md (only for the
# minsky repo itself — don't modify host TASKS.md from outside)
# git add TASKS.md && git commit -m "observer: file <short-id>" ...
git push -u origin HEAD

gh pr create --draft \
  --title "observer: <one-line headline>" \
  --body-file /tmp/observer-pr-body.md
```

**Rate limit**: ≤2 observer PRs per hour per upstream repo. If you'd
exceed the rate, escalate to the operator instead of opening a third
PR — the first two are enough signal to act on.

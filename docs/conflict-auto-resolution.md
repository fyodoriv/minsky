# Conflict auto-resolution (Mergiraf)

When the daemon merges its own work — or when daemon-vs-daemon parallel
worktrees rebase onto each other — git's default 3-way line-diff often falls
into structural conflicts that aren't actually semantic conflicts (e.g. two
task blocks appended to TASKS.md, two new lines in `.github/workflows/ci.yml`'s
`needs:` array). Mergiraf is a tree-sitter-backed semantic merge driver that
resolves these structurally rather than line-textually, across 33 languages
(see <https://mergiraf.org>).

## Activation

```bash
node scripts/setup-mergiraf.mjs
```

The script is idempotent and three-state:

- **Configured** (exit 0): binary present and `git config merge.mergiraf.*`
  matches the canonical command. No-op.
- **Binary missing** (exit 1): prints the install hint
  (`brew install mergiraf` or `cargo install mergiraf`); operator must install,
  then re-run.
- **Needs config** (exit 2): binary present but config absent or stale; the
  script writes the three keys (`name`, `driver`, `recursive`) and exits 0.

## What gets auto-resolved

`.gitattributes` declares `merge=mergiraf` for the high-conflict globs:
`*.ts`, `*.tsx`, `*.mjs`, `*.js`, `*.jsx`, `*.json`, `*.md`, `*.yml`, `*.yaml`.
Without the binary, git falls back to the default merge driver silently — no
regression, just no auto-resolution.

## Substrate

- `.gitattributes` — registers the driver per glob.
- `scripts/setup-mergiraf.mjs` — idempotent activator (pure
  `planMergirafSetup` decision function + thin CLI).
- `scripts/check-gitattributes-mergiraf.mjs` — invariant lint asserting the
  required globs stay declared.

## Anchor

- Mergiraf project, <https://mergiraf.org> — tree-sitter-backed AST diffs;
  428/7415 kernel conflicts auto-resolved in published benchmarks.
- Slice 5 of `daemon-parallel-worktree-launch` (TASKS.md).
- Operator directive 2026-05-06: "ensure that minsky itself will be able to
  resolve git conflicts when it merges its work."

## Trust level (open question — slice-N follow-up)

Mergiraf trust is currently **advisory**: the daemon-side conflict-recovery
slice (a follow-up to this substrate) decides whether auto-merges land
silently or require a human/CI gate. If Mergiraf produces ≥3 wrong
auto-merges/week, demote to advisory-only and re-add a human/CI gate at the
merge step (per the parent task's pivot threshold).

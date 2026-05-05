---
name: live-fire-smoke
description: Run the supervisor's launch script under launchd-equivalent stripped env (minimal PATH, no user shell rc) to surface bugs the integration tests skip. Use after editing `distribution/{systemd,launchd}/run-*.sh` or any plist / unit-file template, before pushing the PR. Replaces the four-bug live-fire pattern that surfaced #143-#146.
allowed-tools: Bash, Read
---

# Live-fire smoke

Pre-push smoke test for changes to the supervisor launch scripts (`distribution/{systemd,launchd}/run-*.sh`) and unit-file templates (`distribution/{systemd,launchd}/*.{service,target,plist}`). Catches bugs that the in-repo integration tests skip because they substitute sleep-stubs for the real production code path.

## Why this skill exists

The 2026-05-04 dogfood bring-up surfaced FOUR real bugs (#143, #144, #145, #146) that all of these passed:

- `pnpm typecheck` (TypeScript only — doesn't lint shell scripts)
- `pnpm exec biome check .` (lints TS, not bash)
- `./distribution/lint-units.sh` (structural lint over plist XML + systemd unit headers)
- `linux-supervisor-integration` / `macos-supervisor-integration` CI jobs (write their own sleep-stubs in place of the real `run-*.sh` scripts)

The bugs:

1. Launchd plists referenced `distribution/launchd/run-*.sh` — files that didn't exist (#143).
2. `run-budget-guard.sh` used `exec sleep infinity` — GNU coreutils only, broken on BSD/macOS (#144).
3. `run-tick-loop.sh` expanded `"${EXTRA_ARGS[@]}"` directly — bash strict mode crashed on empty array (#144).
4. `run-tick-loop.sh` exec'd `node` — launchd's minimal PATH didn't include the operator's fnm-managed node (#145).
5. `process.stdout` block-buffered when launchd redirected to a regular file — invisible iterations (#146).

All five surfaced only when the supervisor was actually loaded on the operator's real machine.

## What this skill runs

Three smokes, in increasing confidence order:

### 1. Stripped-env script smoke

```bash
env -i HOME="$HOME" PATH=/usr/bin:/bin bash distribution/systemd/run-tick-loop.sh \
  --max-iterations=1 --tick-interval-ms=100
```

Should exit 0 cleanly with at least one `[span] tick-loop.iteration ...` line on stdout. The minimal PATH catches bug #4. The `set -u` strictness in the script catches bug #3. The `--max-iterations=1` keeps it short.

### 2. Background daemon smoke (verifies the budget-guard sleep-forever pattern)

```bash
( bash distribution/systemd/run-budget-guard.sh & ); pid=$!; sleep 1
if pgrep -f "tail -f /dev/null" >/dev/null; then echo "✓ runner alive"; pkill -f "tail -f /dev/null"; fi
```

Catches bug #2 — `sleep infinity` would exit immediately on macOS with usage-error.

### 3. plist render + plutil-lint smoke

```bash
TMPDIR=$(mktemp -d) && for f in distribution/launchd/*.plist; do
  out="$TMPDIR/$(basename "$f")"
  MINSKY_HOME="$(pwd)" envsubst '${MINSKY_HOME}' < "$f" > "$out"
  plutil -lint "$out" || echo "✗ $(basename "$f")"
  grep -E "<string>$(pwd)" "$out" >/dev/null || echo "✗ $(basename "$f") MINSKY_HOME placeholder didn't substitute"
done
rm -rf "$TMPDIR"
```

Catches bug #1 — if the plist references a file that doesn't exist on the resolved path.

## Invocation

When the user says any of:

- "smoke the supervisor scripts"
- "live-fire test"
- "before pushing this dist/ change, smoke it"
- "the integration test passes but does it actually run?"

Run all three. Report which pass / fail. If all pass, the user can push with the live-fire scripts having been exercised.

## What this does NOT catch

- Behaviour bugs in `runDaemon` itself (those are caught by `pnpm vitest run novel/tick-loop`).
- Environment-variable interactions specific to the operator's shell rc (we strip env on purpose).
- Real-spawn `claude --print` failures (that requires the operator's actual Claude Code session — too costly for a smoke).

For those, a separate skill or the actual `pnpm dogfood` invocation is the right surface.

## When NOT to use

- The PR doesn't touch `distribution/{systemd,launchd}/*.{sh,plist,service,target}` → skip; the smokes have nothing to validate.
- You've already run `pnpm dogfood` and verified live behaviour → the smokes are subsumed by the live run.

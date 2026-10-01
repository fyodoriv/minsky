#!/usr/bin/env bats
# tests/fresh-clone-bootstrap.bats — pins the fresh-clone bootstrap
# contract: `git clone && pnpm install && minsky daemon doctor` works
# with no separate `pnpm build` step, and a missing/unbuilt run target
# fails LOUDLY at the actionable boundary instead of emitting a raw node
# ERR_MODULE_NOT_FOUND stack trace.
#
# What this pins:
# - Root package.json carries a `prepare` script that runs `tsc -b`
#   (the canonical build-on-install hook — pnpm docs).
# - `minsky __assert-built <unbuilt-fixture>` prints a one-line
#   actionable `pnpm install` hint to stderr and exits 1 (NOT a node
#   module-resolution stack trace).
# - `minsky __assert-built <built-fixture>` exits 0 when a runnable
#   entrypoint exists (executable bash runner OR non-empty node runner).
# - The real repo (this checkout) passes the guard once installed.
#
# Race-safety: the failing branch is exercised against a TEMP fixture
# tree, never `rm -rf` on the shared dist (concurrent test runs share
# the same checkout).
#
# Source: TASKS.md `minsky-cli-fresh-clone-bootstrap`.
# Run: bats tests/fresh-clone-bootstrap.bats

setup() {
  REPO_ROOT="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
  MINSKY_BIN="$REPO_ROOT/bin/minsky"
  TMPDIR_TEST="$(mktemp -d -t minsky-fresh-clone-test.XXXXXX)"
}

teardown() {
  rm -rf "$TMPDIR_TEST"
}

# --- prepare hook (build-on-install) ---------------------------------------

@test "package.json carries a prepare script that runs tsc -b" {
  run node -e '
    const p = require("'"$REPO_ROOT"'/package.json");
    const prep = (p.scripts && p.scripts.prepare) || "";
    if (!/tsc -b/.test(prep)) { console.error("prepare missing tsc -b: " + prep); process.exit(1); }
    process.stdout.write(prep);
  '
  [ "$status" -eq 0 ]
  [[ "$output" == *"tsc -b"* ]]
}

# --- actionable-hint branch (unbuilt tree) ---------------------------------

@test "__assert-built on an unbuilt tree exits 1 with a pnpm install hint" {
  # Fixture: a repo tree with a ZERO-BYTE node runner (the gutted
  # Path-A placeholder) and NO bin/minsky-run.sh — i.e. nothing
  # runnable. The guard must fail loudly with an actionable hint.
  FIXTURE="$TMPDIR_TEST/unbuilt-repo"
  mkdir -p "$FIXTURE/novel/cross-repo-runner/bin"
  : > "$FIXTURE/novel/cross-repo-runner/bin/minsky-run.mjs"  # empty = unbuilt

  run "$MINSKY_BIN" __assert-built "$FIXTURE"
  [ "$status" -eq 1 ]
  # Actionable hint present...
  [[ "$output" == *"pnpm install"* ]]
  [[ "$output" == *"no runnable entrypoint"* ]]
  # ...and it is NOT a raw node module-resolution stack trace.
  [[ "$output" != *"ERR_MODULE_NOT_FOUND"* ]]
  [[ "$output" != *"at ModuleLoader"* ]]
}

@test "__assert-built names BOTH candidate paths it looked for" {
  FIXTURE="$TMPDIR_TEST/empty-repo"
  mkdir -p "$FIXTURE"
  run "$MINSKY_BIN" __assert-built "$FIXTURE"
  [ "$status" -eq 1 ]
  [[ "$output" == *"minsky-run.mjs"* ]]
  [[ "$output" == *"minsky-run.sh"* ]]
}

# --- happy path (built tree) -----------------------------------------------

@test "__assert-built exits 0 when an executable bash runner exists" {
  FIXTURE="$TMPDIR_TEST/built-bash-repo"
  mkdir -p "$FIXTURE/bin"
  printf '#!/bin/bash\nexit 0\n' > "$FIXTURE/bin/minsky-run.sh"
  chmod +x "$FIXTURE/bin/minsky-run.sh"

  run "$MINSKY_BIN" __assert-built "$FIXTURE"
  [ "$status" -eq 0 ]
  [ -z "$output" ]
}

@test "__assert-built exits 0 when a non-empty node runner exists" {
  FIXTURE="$TMPDIR_TEST/built-node-repo"
  mkdir -p "$FIXTURE/novel/cross-repo-runner/bin"
  printf 'console.log("ok");\n' > "$FIXTURE/novel/cross-repo-runner/bin/minsky-run.mjs"

  run "$MINSKY_BIN" __assert-built "$FIXTURE"
  [ "$status" -eq 0 ]
}

@test "__assert-built defaults to this repo and passes (post-install)" {
  # No path arg → defaults to the script's own repo root. After
  # `pnpm install` the canonical bash runner bin/minsky-run.sh is
  # present + executable, so the guard passes.
  run "$MINSKY_BIN" __assert-built
  [ "$status" -eq 0 ]
}

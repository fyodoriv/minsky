#!/usr/bin/env bash
# bin/minsky-bootstrap.sh — Path A Phase 11 bash bootstrap (rule #1 — replace
# 1.6K LOC of TypeScript inferer with shell + template substitution).
#
# Materializes a per-host `.minsky/` sidecar so the cross-repo-runner can
# govern any host repo. Idempotent (re-runs converge to the same shape).
#
# Status: BASH ALTERNATIVE to `novel/sidecar-bootstrap/bin/minsky-bootstrap.mjs`.
# Coexists with the TS version during the Phase 11 decouple-before-delete
# window. Operator opts in via `bin/minsky bootstrap-sh <host>` or by
# invoking this file directly. The TS version remains the default until
# this bash version has been live-fire-smoked.
#
# What it does (6-action plan, same order as the TS bootstrapper):
#   1. Resolve host repo identifier from `<host>/.git/config` remote URL
#   2. Infer defaults (tasks_md_path, default_branch, pre_commit_command,
#      branch_prefix, host_packages_path) from on-disk state
#   3. Write `<host>/.minsky/repo.yaml` via envsubst over templates/repo.yaml
#   4. Create `<host>/.minsky/experiments/` directory
#   5. Symlink `<host>/.minsky/vision.md` → minsky's `vision.md`
#   6. Register `.minsky/` in `~/.config/git/ignore` (idempotent append)
#
# Usage:
#   bin/minsky-bootstrap.sh <host-dir>           # write the sidecar (default)
#   bin/minsky-bootstrap.sh --doctor <host-dir>  # read-only diagnostic
#   bin/minsky-bootstrap.sh --help               # print this usage
#
# Exit codes:
#   0  — sidecar materialized (or already correct)
#   1  — host-dir missing or not a git repo
#   2  — bad CLI args
#   75 — concurrent bootstrap detected (EX_TEMPFAIL, same as TS version)
#
# Anchor: rule #1 (the TS bootstrap's heavy inference is over-engineered;
# 90% of hosts get the same defaults — write the template + 80 lines of
# shell, let the operator hand-edit the 10% that need tuning);
# `docs/plans/2026-05-24-path-a-aggressive-cut.md` § Phase 11.

set -euo pipefail

# --- 1. Arg parsing ----------------------------------------------------

MODE="write"
HOST_DIR=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --doctor) MODE="doctor"; shift ;;
    --help|-h)
      grep '^# ' "$0" | head -45 | sed 's/^# \?//'
      exit 0
      ;;
    -*) echo "minsky-bootstrap: unknown flag: $1" >&2; exit 2 ;;
    *)
      if [[ -z "$HOST_DIR" ]]; then
        HOST_DIR="$1"
      else
        echo "minsky-bootstrap: unexpected positional arg: $1" >&2
        exit 2
      fi
      shift
      ;;
  esac
done

if [[ -z "$HOST_DIR" ]]; then
  echo "minsky-bootstrap: usage: $0 [--doctor] <host-dir>" >&2
  exit 2
fi

if [[ ! -d "$HOST_DIR" ]]; then
  echo "minsky-bootstrap: host-dir not found: $HOST_DIR" >&2
  exit 1
fi
HOST_DIR="$(cd "$HOST_DIR" && pwd)"

# --- 2. Resolve minsky repo root --------------------------------------

# We need the template + vision.md. Walk up from this script's location.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MINSKY_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMPLATE_PATH="$MINSKY_ROOT/templates/repo.yaml"
VISION_MD_PATH="$MINSKY_ROOT/vision.md"

if [[ ! -f "$TEMPLATE_PATH" ]]; then
  echo "minsky-bootstrap: template missing at $TEMPLATE_PATH" >&2
  exit 1
fi

# --- 3. Infer host signals --------------------------------------------

infer_host_repo() {
  # Try `.git/config`'s [remote "origin"] url. Tolerant: missing → echo
  # the host directory basename as fallback (operator can edit later).
  # Normalize to `owner/repo`, stripping:
  #   - `git@host:` prefix (SSH form)
  #   - `https://host/` prefix (HTTPS form)
  #   - `.git` suffix
  local git_config="$HOST_DIR/.git/config"
  if [[ -f "$git_config" ]]; then
    local url
    url="$(grep -A1 '\[remote "origin"\]' "$git_config" 2>/dev/null \
            | grep -oE 'url = .*' \
            | sed 's/^url = //' \
            | head -1 \
            || true)"
    if [[ -n "$url" ]]; then
      # Strip everything up to (and including) the last ":" or "/" that
      # precedes the owner segment. The owner/repo pair is the LAST two
      # path components.
      local normalized="$url"
      normalized="${normalized%.git}"          # strip trailing .git
      normalized="${normalized#git@*:}"        # strip git@host:
      normalized="${normalized#https://*/}"    # strip https://host/
      normalized="${normalized#http://*/}"     # strip http://host/
      normalized="${normalized#ssh://*/}"      # strip ssh://host/
      echo "$normalized"
      return 0
    fi
  fi
  basename "$HOST_DIR"
}

infer_tasks_md_path() {
  if [[ -f "$HOST_DIR/TASKS.md" ]]; then echo "TASKS.md"
  elif [[ -f "$HOST_DIR/docs/TASKS.md" ]]; then echo "docs/TASKS.md"
  else echo "TASKS.md"  # default; operator can edit
  fi
}

infer_default_branch() {
  local head_file="$HOST_DIR/.git/HEAD"
  if [[ -f "$head_file" ]]; then
    local ref
    ref="$(grep '^ref:' "$head_file" 2>/dev/null | sed 's|^ref: refs/heads/||' || true)"
    if [[ -n "$ref" ]]; then echo "$ref"; return; fi
  fi
  echo "main"
}

infer_pre_commit_command() {
  # `pnpm run check` when package.json has it; else empty.
  local pkg="$HOST_DIR/package.json"
  if [[ -f "$pkg" ]] && grep -q '"check"' "$pkg" 2>/dev/null; then
    echo "pnpm run check"
  else
    echo ""
  fi
}

infer_branch_prefix() {
  echo "feat/"
}

infer_host_packages_path() {
  if [[ -d "$HOST_DIR/packages" ]]; then echo "packages"
  else echo "."
  fi
}

HOST_REPO="$(infer_host_repo)"
TASKS_MD_PATH="$(infer_tasks_md_path)"
DEFAULT_BRANCH="$(infer_default_branch)"
PRE_COMMIT_COMMAND="$(infer_pre_commit_command)"
BRANCH_PREFIX="$(infer_branch_prefix)"
HOST_PACKAGES_PATH="$(infer_host_packages_path)"

# --- 4. Doctor mode: print signals + exit -----------------------------

if [[ "$MODE" == "doctor" ]]; then
  echo "minsky-bootstrap doctor:"
  echo "  host_dir:            $HOST_DIR"
  echo "  host_repo:           $HOST_REPO"
  echo "  tasks_md_path:       $TASKS_MD_PATH"
  echo "  default_branch:      $DEFAULT_BRANCH"
  echo "  pre_commit_command:  ${PRE_COMMIT_COMMAND:-(none)}"
  echo "  branch_prefix:       $BRANCH_PREFIX"
  echo "  host_packages_path:  $HOST_PACKAGES_PATH"
  echo "  template:            $TEMPLATE_PATH"
  echo "  vision.md:           $VISION_MD_PATH"
  if [[ -d "$HOST_DIR/.minsky" ]]; then
    echo "  .minsky/ exists:     yes"
    [[ -f "$HOST_DIR/.minsky/repo.yaml" ]] && echo "    repo.yaml:         present"
    [[ -L "$HOST_DIR/.minsky/vision.md" ]] && echo "    vision.md symlink: present"
    [[ -d "$HOST_DIR/.minsky/experiments" ]] && echo "    experiments/:      present"
  else
    echo "  .minsky/ exists:     no (would create on write)"
  fi
  exit 0
fi

# --- 5. Concurrent-bootstrap lock -------------------------------------

LOCK_DIR="$HOST_DIR/.minsky/.bootstrap.lock.d"
mkdir -p "$(dirname "$LOCK_DIR")"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "minsky-bootstrap: another bootstrap is in progress at $LOCK_DIR" >&2
  echo "minsky-bootstrap: rm -rf '$LOCK_DIR' if stale" >&2
  exit 75
fi
# shellcheck disable=SC2064
trap "rmdir '$LOCK_DIR' 2>/dev/null || true" EXIT

# --- 6. Action plan: write sidecar ------------------------------------

# (a) Create directories
mkdir -p "$HOST_DIR/.minsky/experiments"

# (b) Write repo.yaml via envsubst over the template. Use a tempfile +
# atomic rename so a partial-write doesn't corrupt the existing config.
TMP_YAML="$(mktemp -t minsky-repo-yaml.XXXXXX)"
export HOST_REPO TASKS_MD_PATH DEFAULT_BRANCH PRE_COMMIT_COMMAND \
       BRANCH_PREFIX HOST_PACKAGES_PATH
if command -v envsubst >/dev/null 2>&1; then
  envsubst < "$TEMPLATE_PATH" > "$TMP_YAML"
else
  # No envsubst — fall back to bash parameter expansion via a here-doc.
  # Read the template, do explicit substitution.
  python3 - "$TEMPLATE_PATH" <<'PY' > "$TMP_YAML"
import os, sys
content = open(sys.argv[1]).read()
for k in ("HOST_REPO", "TASKS_MD_PATH", "DEFAULT_BRANCH",
         "PRE_COMMIT_COMMAND", "BRANCH_PREFIX", "HOST_PACKAGES_PATH"):
    content = content.replace("${" + k + "}", os.environ.get(k, ""))
sys.stdout.write(content)
PY
fi
mv "$TMP_YAML" "$HOST_DIR/.minsky/repo.yaml"

# (c) Symlink vision.md (idempotent — recreate if pointing somewhere else)
SYMLINK_PATH="$HOST_DIR/.minsky/vision.md"
if [[ -L "$SYMLINK_PATH" ]]; then
  current_target="$(readlink "$SYMLINK_PATH")"
  if [[ "$current_target" != "$VISION_MD_PATH" ]]; then
    rm "$SYMLINK_PATH"
    ln -s "$VISION_MD_PATH" "$SYMLINK_PATH"
  fi
elif [[ -e "$SYMLINK_PATH" ]]; then
  echo "minsky-bootstrap: $SYMLINK_PATH exists and is not a symlink — refusing to overwrite" >&2
  exit 1
else
  ln -s "$VISION_MD_PATH" "$SYMLINK_PATH"
fi

# (d) Register .minsky/ in ~/.config/git/ignore (idempotent append)
GLOBAL_IGNORE="${XDG_CONFIG_HOME:-$HOME/.config}/git/ignore"
mkdir -p "$(dirname "$GLOBAL_IGNORE")"
touch "$GLOBAL_IGNORE"
if ! grep -qE '^\.minsky/?$|^\.minsky/\*\*$' "$GLOBAL_IGNORE" 2>/dev/null; then
  printf '\n# minsky cross-repo-runner sidecar (per-host gitignored)\n.minsky/\n' \
    >> "$GLOBAL_IGNORE"
fi

echo "minsky-bootstrap: sidecar materialized at $HOST_DIR/.minsky/"
echo "  repo.yaml:    inferred for $HOST_REPO ($DEFAULT_BRANCH)"
echo "  vision.md:    → $VISION_MD_PATH"
echo "  experiments/: ready"
echo "  global gitignore: registered (.minsky/ excluded everywhere)"

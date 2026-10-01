#!/usr/bin/env bash
# Smoke-test for the supervisor unit-file / plist templates.
#
# Validates:
#   - launchd plists are well-formed XML (plutil -lint, macOS only)
#   - systemd unit files contain the required directives
#   - all templates use only the documented ${MINSKY_HOME} placeholder
#
# Run as: ./distribution/lint-units.sh
# Exits 0 on pass, 1 on any failure.
#
# Pattern: structural smoke test for config templates — closest published
# pattern is "linting" (Chen, *Communications of the ACM* 2010, "Software
# Bug Detection"), specialised to declarative config. Conformance: full.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

failures=0
fail() { printf '  ✗ %s\n' "$*" >&2; failures=$((failures + 1)); }
ok()   { printf '  ✓ %s\n' "$*"; }

# 1. Validate launchd plists (macOS).
if command -v plutil >/dev/null 2>&1; then
  printf 'launchd plists (plutil -lint):\n'
  for plist in "$ROOT"/launchd/*.plist; do
    if [ -f "$plist" ]; then
      if plutil -lint "$plist" >/dev/null 2>&1; then
        ok "$(basename "$plist")"
      else
        fail "$(basename "$plist") — plutil -lint reported errors"
      fi
    fi
  done
else
  printf 'launchd plists: skipped (plutil not on PATH; macOS only)\n'
fi

# 2. Validate systemd unit files (POSIX-grep — works on any platform).
printf '\nsystemd unit files (structural lint):\n'
for unit in "$ROOT"/systemd/*.service "$ROOT"/systemd/*.target; do
  if [ -f "$unit" ]; then
    name=$(basename "$unit")
    # Required directives per the systemd manual: every unit needs [Unit] +
    # Description; .service needs [Service] + ExecStart + Restart.
    if ! grep -q '^\[Unit\]' "$unit"; then
      fail "$name — missing [Unit] section"
    elif ! grep -q '^Description=' "$unit"; then
      fail "$name — missing Description="
    elif [[ "$name" == *.service ]] && ! grep -q '^\[Service\]' "$unit"; then
      fail "$name — missing [Service] section"
    elif [[ "$name" == *.service ]] && ! grep -q '^ExecStart=' "$unit"; then
      fail "$name — missing ExecStart="
    elif [[ "$name" == *.service ]] && grep -q '^Type=oneshot' "$unit"; then
      # Type=oneshot services run-to-completion and exit by design; Restart=
      # would defeat the contract. The systemd timer that fires them IS
      # the cadence kernel (rule #6 stay-alive applied at the timer/unit
      # boundary, not at the service boundary). See `minsky-auto-merge.timer`
      # — every 5 min the timer re-fires the oneshot service, which is
      # functionally identical to `Restart=always` but with bounded execution.
      ok "$name"
    elif [[ "$name" == *.service ]] && ! grep -q '^Restart=' "$unit"; then
      fail "$name — missing Restart= directive (rule #6 stay-alive)"
    else
      ok "$name"
    fi
  fi
done

# 3. Verify placeholder hygiene — only ${MINSKY_HOME} and ${HOME} permitted;
# flag any undocumented ${...} expansions.
#
# ${MINSKY_HOME} is the canonical minsky-repo-root placeholder (substituted
# by setup.sh via envsubst). ${HOME} is the operator's home directory —
# launchd substitutes ${HOME} natively, and setup.sh also envsubsts it; it
# appears in plists for log paths like ${HOME}/.minsky/auto-merge.log.
printf '\nplaceholder hygiene:\n'
allowed='MINSKY_HOME|HOME'
for tmpl in "$ROOT"/systemd/*.service "$ROOT"/systemd/*.target "$ROOT"/launchd/*.plist; do
  if [ -f "$tmpl" ]; then
    name=$(basename "$tmpl")
    # Extract every ${VAR} occurrence; subtract the allowed set.
    bad=$(grep -oE '\$\{[A-Z_][A-Z0-9_]*\}' "$tmpl" 2>/dev/null \
          | sort -u \
          | grep -vE "^\\\$\\{($allowed)\\}\$" \
          || true)
    if [ -z "$bad" ]; then
      ok "$name"
    else
      fail "$name — undocumented placeholder(s): $bad"
    fi
  fi
done

printf '\n'
if [ "$failures" -eq 0 ]; then
  printf '✓ all unit-file templates passed structural lint\n'
  exit 0
else
  printf '✗ %d failure(s)\n' "$failures" >&2
  exit 1
fi

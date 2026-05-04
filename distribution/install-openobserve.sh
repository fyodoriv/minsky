#!/usr/bin/env bash
# Minsky observability backend — OpenObserve single-binary installer.
#
# Hypothesis (rule #9): pinning OpenObserve v0.80.2 (latest stable as of
# 2026-04-30, verified reachable on the openobserve.ai CDN at
# `downloads.openobserve.ai/releases/o2-enterprise/${VERSION}/`) and laying it
# down as a per-user daemon under `${HOME}/.local/bin/openobserve` +
# `${HOME}/.openobserve/data` makes the 5 OTEL-backed success-criteria queries
# (vision.md rows 1, 2, 5, 6, 9) measurable today instead of rendering `(stub)`.
#
# Pattern: thin shell wrapper around OpenObserve's official tarball release;
# binary is *not* bundled in the repo (size + license). Per
# `research.md` § "Lighter OTEL backend" (PR #43, 2026-05-03), OpenObserve
# is the chosen v0 OTLP receiver — single binary, parquet-on-disk,
# PromQL-compatible read API.
#
# Pinned version: lifts when the quarterly review (TASKS.md `review-q3-2026`)
# decides to bump.
#
# Usage:
#   bash distribution/install-openobserve.sh                # install, default port 5080
#   bash distribution/install-openobserve.sh --port=5180    # custom port
#   bash distribution/install-openobserve.sh --dry-run      # print what would happen
#
# Exits 0 on success; non-zero on download / unpack / write failure.
#
# Anchor: rule #1 (don't reinvent the wheel — OpenObserve is the dep);
# research.md § "Lighter OTEL backend"; OpenTelemetry specification (CNCF 2020+).

set -euo pipefail

# --- pinned configuration -----------------------------------------------------

OO_VERSION="${OO_VERSION:-v0.80.2}"
OO_PORT_DEFAULT="5080"
OO_BIN_DIR="${HOME}/.local/bin"
OO_BIN_PATH="${OO_BIN_DIR}/openobserve"
OO_DATA_DIR="${HOME}/.openobserve/data"
# OpenObserve ships binaries through their CloudFront-fronted S3 CDN, NOT via
# GitHub Releases (the Releases page intentionally has no asset binaries —
# verified 2026-05-04: every release tag returns `assets: []` from
# `gh api repos/openobserve/openobserve/releases`). The canonical CDN path is
# `${BASE}/${VERSION}/openobserve-ee-${VERSION}-${TARGET}.tar.gz`. The
# `o2-enterprise` namespace is OpenObserve's current release channel for the
# self-hostable binary (the open-source distribution; "ee" is OpenObserve's
# binary-naming convention, not a license tier — see
# `https://openobserve.ai/downloads`).
OO_DOWNLOAD_BASE="${OO_DOWNLOAD_BASE:-https://downloads.openobserve.ai/releases/o2-enterprise}"

# --- argument parsing ---------------------------------------------------------

dry_run=0
port="${OO_PORT_DEFAULT}"
for arg in "$@"; do
  case "$arg" in
    --port=*) port="${arg#--port=}" ;;
    --dry-run) dry_run=1 ;;
    --version=*) OO_VERSION="${arg#--version=}" ;;
    -h|--help)
      sed -n '1,30p' "$0"
      exit 0
      ;;
    *)
      printf 'install-openobserve: unknown arg: %s\n' "$arg" >&2
      exit 2
      ;;
  esac
done

# --- platform detection -------------------------------------------------------

uname_s="$(uname -s)"
uname_m="$(uname -m)"

case "${uname_s}-${uname_m}" in
  Darwin-arm64)  target="darwin-arm64" ;;
  Darwin-x86_64)
    # Upstream stopped publishing darwin-amd64 binaries (verified 2026-05-04
    # against v0.80.2 / v0.80.1: only darwin-arm64 is available on the CDN).
    # Fall through to the unsupported branch with a focused error.
    printf 'install-openobserve: darwin-amd64 is not published by upstream OpenObserve as of %s; use darwin-arm64 or run via Linux\n' "$OO_VERSION" >&2
    exit 1
    ;;
  Linux-x86_64)  target="linux-amd64" ;;
  Linux-aarch64) target="linux-arm64" ;;
  *)
    printf 'install-openobserve: unsupported platform %s/%s\n' "${uname_s}" "${uname_m}" >&2
    exit 1
    ;;
esac

archive="openobserve-ee-${OO_VERSION}-${target}.tar.gz"
url="${OO_DOWNLOAD_BASE}/${OO_VERSION}/${archive}"

# --- plan summary -------------------------------------------------------------

printf 'install-openobserve: target=%s\n' "$target"
printf 'install-openobserve: version=%s\n' "$OO_VERSION"
printf 'install-openobserve: bin=%s\n' "$OO_BIN_PATH"
printf 'install-openobserve: data=%s\n' "$OO_DATA_DIR"
printf 'install-openobserve: port=%s\n' "$port"
printf 'install-openobserve: url=%s\n' "$url"

if [ "$dry_run" -eq 1 ]; then
  printf 'install-openobserve: dry-run — exiting before download\n'
  exit 0
fi

# --- install ------------------------------------------------------------------

mkdir -p "$OO_BIN_DIR" "$OO_DATA_DIR"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

printf 'install-openobserve: downloading\n'
if ! curl -fsSL "$url" -o "${tmp_dir}/openobserve.tar.gz"; then
  printf 'install-openobserve: download failed; verify OO_VERSION (%s) and platform asset (%s)\n' \
    "$OO_VERSION" "$archive" >&2
  printf 'install-openobserve: pivot — if upstream tarball naming changed, fall back to VictoriaMetrics triad per research.md PR #43\n' >&2
  exit 1
fi

tar -xzf "${tmp_dir}/openobserve.tar.gz" -C "${tmp_dir}"
# The tarball lays down a single `openobserve` executable at the top level.
if [ ! -f "${tmp_dir}/openobserve" ]; then
  printf 'install-openobserve: extracted tarball did not contain the openobserve binary\n' >&2
  exit 1
fi

install -m 0755 "${tmp_dir}/openobserve" "$OO_BIN_PATH"

printf 'install-openobserve: installed binary at %s\n' "$OO_BIN_PATH"
printf 'install-openobserve: data dir at %s\n' "$OO_DATA_DIR"
printf 'install-openobserve: next step — see distribution/openobserve/README.md to register the daemon\n'
printf 'install-openobserve: PromQL endpoint will be http://127.0.0.1:%s/api/default/prometheus/api/v1/query\n' "$port"

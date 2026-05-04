#!/usr/bin/env bash
# Runner for `@minsky/dashboard-web` — sub-task 4/4 of `dashboard-web-v0`.
#
# Builds the package (idempotent — `pnpm --filter @minsky/dashboard-web
# build` is no-op when `dist/` is current) and starts the SSR server on
# the requested port (default 8080). Exec's into `node` so the OS
# supervisor (systemd-user / launchd) can manage the live process by PID
# without an intermediate shell wrapper.
#
# Environment:
#   PORT          (optional, default 8080) — bind port
#   OTEL_*        (optional, pass-through)  — opens the seam for sub-task
#                 2 of `dashboard-web-otel-wiring` (P3) to wire real
#                 backend reads at start-time without touching this script
#
# Run as: bash distribution/run-dashboard-web.sh
#         PORT=8181 bash distribution/run-dashboard-web.sh
#
# Pattern: thin runner / process-launcher script — the I/O boundary that
# binds a port to the pure `createServer` constructor. Anchors:
# Martin, *Clean Architecture*, 2017 (I/O at the edge); Beck 1999 (CI as
# the constraint enforcer — sub-task 4's Lighthouse job calls this script
# unmodified). Conformance: full.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PORT="${PORT:-8080}"
export PORT

# Build is idempotent: if `dist/start.js` is newer than every `src/*.ts`
# file the tsc invocation is essentially a no-op.
pnpm --filter @minsky/dashboard-web build

# `exec` so the supervisor / Lighthouse harness sees the node PID
# directly and a SIGTERM reaches it without a shell-wrapper detour.
exec node novel/dashboard-web/dist/start.js

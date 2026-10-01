#!/usr/bin/env bash
# Runner for `@minsky/dashboard-web`.
#
# Builds the package (idempotent — `pnpm --filter @minsky/dashboard-web
# build` is no-op when `dist/` is current) and starts the SSR server on
# the requested port (default 8080). Exec's into `node` so the OS
# supervisor (systemd-user / launchd) can manage the live process by PID
# without an intermediate shell wrapper.
#
# Environment:
#   PORT                          (optional, default 8080) — bind port
#   OTEL_*                        (optional, pass-through) — propagated to
#                                 the node process for tracing / metric
#                                 export by `@minsky/observability`
#   OTEL_EXPORTER_OTLP_ENDPOINT   (optional) — when set together with
#                                 `DASHBOARD_METRICS_SNAPSHOT_CMD` (a
#                                 shell command writing JSON to
#                                 `DASHBOARD_METRICS_SNAPSHOT`), the
#                                 runner pre-fetches a snapshot before
#                                 exec'ing into node. Async I/O happens
#                                 here, not on the per-request path.
#   DASHBOARD_METRICS_SNAPSHOT     (optional) — path to a JSON file shaped
#                                 `Record<metric-id, string>`. When
#                                 present and readable, `start.ts`
#                                 constructs a `snapshotGetValue`
#                                 Strategy and renders live values in
#                                 place of `(stub)`. Unset → default null
#                                 Strategy (rule #7 graceful-degrade —
#                                 every row renders `(stub)`).
#   DASHBOARD_METRICS_SNAPSHOT_CMD (optional) — shell command that
#                                 produces the JSON snapshot when run
#                                 with `DASHBOARD_METRICS_SNAPSHOT` as
#                                 its output path. Skipped if the env-var
#                                 is empty.
#
# Run as: bash distribution/run-dashboard-web.sh
#         PORT=8181 bash distribution/run-dashboard-web.sh
#
# Pattern: thin runner / process-launcher script — the I/O boundary that
# binds a port to the pure `createServer` constructor and fronts the
# async snapshot pre-fetch for the (synchronous) `getValue` Strategy.
# Anchors: Martin, *Clean Architecture*, 2017 (I/O at the edge); rule #2
# (every dep behind interface — the value source is a Strategy, the
# snapshot is data passed in); Beck 1999 (CI as the constraint enforcer).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PORT="${PORT:-8080}"
export PORT

# Build is idempotent: if `dist/start.js` is newer than every `src/*.ts`
# file the tsc invocation is essentially a no-op.
pnpm --filter @minsky/dashboard-web build

# Optional async snapshot pre-fetch: only runs when the operator opts in
# with both an output path and a generator command. Failure to produce
# the snapshot is non-fatal — the runner falls back to the null
# Strategy and renders `(stub)` per rule #7 graceful-degrade.
if [[ -n "${DASHBOARD_METRICS_SNAPSHOT:-}" && -n "${DASHBOARD_METRICS_SNAPSHOT_CMD:-}" ]]; then
  bash -c "$DASHBOARD_METRICS_SNAPSHOT_CMD" || true
  export DASHBOARD_METRICS_SNAPSHOT
fi

# `exec` so the supervisor / Lighthouse harness sees the node PID
# directly and a SIGTERM reaches it without a shell-wrapper detour.
exec node novel/dashboard-web/dist/start.js

// no-test: the web-dashboard is deprecated (docs/DEPRECATED.md §4) — "keep for now, do NOT add features"; existing files lack tests by policy
/**
 * `@minsky/dashboard-web` — bin entry. Starts the SSR server on
 * `process.env.PORT` (default `8080`) so `distribution/run-dashboard-web.sh`
 * has a stable command to invoke. This module is the I/O boundary that
 * binds a port; `createServer` from `./server.js` is the in-process app.
 *
 * `dashboard-web-otel-wiring` opens a snapshot-based value Strategy: if
 * `DASHBOARD_METRICS_SNAPSHOT` points at a JSON file shaped
 * `Record<metric-id, string>`, the file is read once at start-time and
 * fed to `createServer({ getValue })` via `snapshotGetValue`. Async
 * pre-fetch belongs to the runner — the render path stays synchronous
 * within the 500-ms per-render budget. Unset env / unreadable file →
 * default null Strategy, `(stub)` rendered (rule #7 graceful-degrade).
 *
 * @otel-exempt thin I/O boundary — `createServer` carries the OTEL span.
 */

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { serve } from "@hono/node-server";

import { loadRecentSpans } from "./activity.js";
import { bindHostnameWarning, resolveBindHostname } from "./bind.js";
import { controlTokenStartupHint, resolveControlToken } from "./control-auth.js";
import type { GetValue } from "./render.js";
import { createServer } from "./server.js";
import { openObserveGetValue, type Snapshot, snapshotGetValue } from "./strategy.js";

const ACTIVITY_LIMIT = 20;

function loadSnapshot(): Snapshot | null {
  const path = process.env["DASHBOARD_METRICS_SNAPSHOT"];
  if (path === undefined || path === "") return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (parsed === null || typeof parsed !== "object") return null;
    return parsed as Snapshot;
    // rule-6: handled-locally — unreadable/malformed snapshot is a graceful-degrade path (chaos row 1)
  } catch {
    return null;
  }
}

async function resolveGetValue(): Promise<GetValue | undefined> {
  // Live OpenObserve PromQL Strategy (observability-backend-deploy).
  if (process.env["OBSERVABILITY_BACKEND"] === "openobserve") {
    const baseUrl = process.env["OPENOBSERVE_BASE_URL"] ?? "http://127.0.0.1:5080";
    const user = process.env["OPENOBSERVE_USER"];
    const password = process.env["OPENOBSERVE_PASSWORD"];
    try {
      return await openObserveGetValue(
        user !== undefined && password !== undefined
          ? { baseUrl, basicAuth: { user, password } }
          : { baseUrl },
      );
      // rule-6: handled-locally — backend down at start graceful-degrades to `(stub)` (chaos row 3)
    } catch {
      return undefined;
    }
  }
  // Snapshot-from-file fallback (shipped by dashboard-web-otel-wiring).
  const snapshot = loadSnapshot();
  if (snapshot !== null) return snapshotGetValue(snapshot);
  return undefined;
}

const port = Number.parseInt(process.env["PORT"] ?? "8080", 10);
const hostname = resolveBindHostname(process.env);
const getValue = await resolveGetValue();
const controlToken = resolveControlToken(process.env, () => randomBytes(32).toString("hex"));

const warning = bindHostnameWarning(hostname);
if (warning !== null) process.stderr.write(`${warning}\n`);
process.stderr.write(`${controlTokenStartupHint(controlToken)}\n`);

// Activity feed reads the supervisor's stdout log on every request —
// O(file-size) per `GET /` but the file is bounded (operator-side, KBs not
// MBs) and the 5-second auto-refresh is the operator's expectation. The
// log path follows `MINSKY_HOME/.minsky/tick-loop.out.log`; if MINSKY_HOME
// is unset we fall back to the dashboard-web package's CWD which is the
// repo root under `pnpm minsky:ui`.
const minskyHome = process.env["MINSKY_HOME"] ?? process.cwd();
const activityLogPath = resolve(minskyHome, ".minsky/tick-loop.out.log");
const getActivity = () => loadRecentSpans(activityLogPath, ACTIVITY_LIMIT);

const args = {
  getActivity,
  controlToken: controlToken.token,
  ...(getValue === undefined ? {} : { getValue }),
};
const { fetch } = createServer(args);

// `serve()` emits an unhandled `error` event on EADDRINUSE — node's default
// handler prints a stack trace and exits non-zero, which surfaces to the
// operator as a confusing crash. Catch the common case (port-already-in-use,
// usually a stale dashboard process) and exit with an actionable message
// instead. The supervisor (if any) sees exit 1 and applies its restart
// policy; the operator running `pnpm minsky:ui` directly sees the hint.
const server = serve({ fetch, hostname, port }, (info) => {
  process.stdout.write(`dashboard-web listening on http://${hostname}:${info.port}/\n`);
});
server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    process.stderr.write(
      `dashboard-web: port ${port} is already in use.
  - Another dashboard is probably running already; open http://localhost:${port}/
  - Or pick a different port: \`PORT=8888 pnpm minsky:ui\`
  - Or free this one: \`lsof -ti :${port} | xargs kill\`
`,
    );
    process.exit(1);
  }
  throw err;
});

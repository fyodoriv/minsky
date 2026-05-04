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

import { readFileSync } from "node:fs";

import { serve } from "@hono/node-server";

import { createServer } from "./server.js";
import { type Snapshot, snapshotGetValue } from "./strategy.js";

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

const port = Number.parseInt(process.env["PORT"] ?? "8080", 10);
const snapshot = loadSnapshot();
const args = snapshot === null ? undefined : { getValue: snapshotGetValue(snapshot) };
const { fetch } = createServer(args);

serve({ fetch, port }, (info) => {
  process.stdout.write(`dashboard-web listening on http://localhost:${info.port}/\n`);
});

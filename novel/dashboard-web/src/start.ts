/**
 * `@minsky/dashboard-web` — bin entry. Starts the SSR server on
 * `process.env.PORT` (default `8080`) so `distribution/run-dashboard-web.sh`
 * has a stable command to invoke. The server itself is `createServer()`
 * from `./server.js` (sub-task 3 wired the 10 vision.md success metrics
 * as the default); this module is the I/O boundary that binds a port.
 *
 * Sub-task 4 (`dashboard-web-lighthouse-ci`) targets this entry point
 * when running Lighthouse Mobile against `http://localhost:8080/`. The
 * follow-up `dashboard-web-otel-wiring` (P3) will pass an OTEL-backed
 * value Strategy in here — opening the seam now keeps that change
 * additive (a new `args` field, not a new entry).
 *
 * @otel-exempt thin I/O boundary — `createServer` carries the OTEL span
 * (`dashboard-web.create-server`) and `render` carries `dashboard-web.render`.
 */

import { serve } from "@hono/node-server";

import { createServer } from "./server.js";

const port = Number.parseInt(process.env["PORT"] ?? "8080", 10);
const { fetch } = createServer();

serve({ fetch, port }, (info) => {
  // Single line on stdout so the runner script's wait-for-port loop can
  // pivot to log-tailing if the curl probe proves flaky.
  process.stdout.write(`dashboard-web listening on http://localhost:${info.port}/\n`);
});

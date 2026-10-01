/**
 * Live OpenObserve integration test — env-gated.
 *
 * Skipped by default. Runs when `OPENOBSERVE_INTEGRATION=1` is set in the
 * environment AND a local OpenObserve daemon is reachable at the
 * `OPENOBSERVE_BASE_URL` (default `http://127.0.0.1:5080`). Round-trips a
 * trace span through the OTLP HTTP receiver and asserts the OTEL adapter's
 * three-signal `selfTest()` returns `green`.
 *
 * Anchor: `distribution/openobserve/README.md` § "Verify"; rule #4
 * (every measurement queryable — this test exercises the queryability
 * contract end-to-end against a real backend).
 */

import { describe, expect, it } from "vitest";

import { OtelObservability } from "../src/otel.js";

const integrationGate = process.env["OPENOBSERVE_INTEGRATION"] === "1";
const baseUrl = process.env["OPENOBSERVE_BASE_URL"] ?? "http://127.0.0.1:5080";

const maybeDescribe = integrationGate ? describe : describe.skip;

maybeDescribe("OpenObserve live OTLP receiver — three-signal round-trip", () => {
  it("selfTest() returns green when pointed at a running OpenObserve daemon", async () => {
    const obs = new OtelObservability({
      endpoint: `${baseUrl}/api/default/v1`,
    });
    try {
      const result = await obs.selfTest();
      expect(result.status).toBe("green");
      expect(result.latencyMs).toBeLessThan(5000);
    } finally {
      await obs.shutdown();
    }
  });
});

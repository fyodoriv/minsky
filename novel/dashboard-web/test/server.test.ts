import { describe, expect, it } from "vitest";

import { SUCCESS_METRICS } from "../src/metrics.js";
import { createServer } from "../src/server.js";

describe("createServer — Hono SSR scaffold", () => {
  it("returns 200 + HTML body for GET /", async () => {
    const { fetch } = createServer({ metrics: SUCCESS_METRICS });
    const res = await fetch(new Request("http://test.local/"));
    expect(res.status).toBe(200);
    const ctype = res.headers.get("content-type") ?? "";
    expect(ctype).toMatch(/text\/html/i);
  });

  it('serves HTML containing the first vision.md metric id (data-metric-id="loop-uptime")', async () => {
    const { fetch } = createServer({ metrics: SUCCESS_METRICS });
    const res = await fetch(new Request("http://test.local/"));
    const body = await res.text();
    expect(body).toContain('data-metric-id="loop-uptime"');
  });

  it("returns 404 for an unknown route (Hono default — let-it-crash equivalent)", async () => {
    const { fetch } = createServer({ metrics: SUCCESS_METRICS });
    const res = await fetch(new Request("http://test.local/does-not-exist"));
    expect(res.status).toBe(404);
  });

  it("renders zero metric rows when given an empty array (cold-start contract)", async () => {
    const { fetch } = createServer({ metrics: [] });
    const res = await fetch(new Request("http://test.local/"));
    const body = await res.text();
    expect(body).not.toContain("data-metric-id=");
    expect(body).toContain('<ul class="metrics"></ul>');
  });
});

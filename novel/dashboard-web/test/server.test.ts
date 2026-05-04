import { describe, expect, it } from "vitest";

import { SUCCESS_METRICS, type SuccessMetric } from "../src/metrics.js";
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

  it("defaults to SUCCESS_METRICS when no metrics arg is supplied (sub-task 3 wiring)", async () => {
    const { fetch } = createServer();
    const res = await fetch(new Request("http://test.local/"));
    const body = await res.text();
    // Exactly 10 data-metric-id attributes — the parent dashboard-web-v0's
    // verification cell.
    expect(body.match(/data-metric-id=/g) ?? []).toHaveLength(10);
  });

  it("renders exactly 10 data-metric-id attributes for the default SUCCESS_METRICS", async () => {
    const { fetch } = createServer({ metrics: SUCCESS_METRICS });
    const res = await fetch(new Request("http://test.local/"));
    const body = await res.text();
    expect(body.match(/data-metric-id=/g) ?? []).toHaveLength(10);
  });

  it("renders all 10 SUCCESS_METRICS ids (set-equality assertion)", async () => {
    const { fetch } = createServer();
    const res = await fetch(new Request("http://test.local/"));
    const body = await res.text();
    const found = new Set<string>();
    for (const match of body.matchAll(/data-metric-id="([^"]+)"/g)) {
      found.add(match[1]);
    }
    const expected = new Set(SUCCESS_METRICS.map((m) => m.id));
    expect(found).toEqual(expected);
    // And belt-and-suspenders: each id explicitly asserted so a regression
    // points at the missing row, not at an opaque set-diff.
    for (const m of SUCCESS_METRICS) {
      expect(body).toContain(`data-metric-id="${m.id}"`);
    }
  });

  it("renders the (stub) value sentinel so operators can distinguish placeholder from live OTEL data (rule #7 risk mitigation)", async () => {
    const { fetch } = createServer();
    const res = await fetch(new Request("http://test.local/"));
    const body = await res.text();
    // One (stub) per row; 10 rows.
    expect(body.match(/\(stub\)/g) ?? []).toHaveLength(10);
  });

  it("live values replace `(stub)` when Strategy returns strings (otel-wiring seam)", async () => {
    const { fetch } = createServer({ getValue: () => "42" });
    const res = await fetch(new Request("http://test.local/"));
    const body = await res.text();
    expect(body.match(/\(stub\)/g) ?? []).toHaveLength(0);
    expect(body).toContain(">42<");
    expect((body.match(/>42</g) ?? []).length).toBe(10);
  });

  it("default Strategy preserves backward compat (no getValue arg → 10 stubs)", async () => {
    const { fetch } = createServer();
    const res = await fetch(new Request("http://test.local/"));
    const body = await res.text();
    expect(body.match(/\(stub\)/g) ?? []).toHaveLength(10);
  });

  it("HTML-escapes Strategy output so a hostile backend cannot inject `<script>` (rule #7 XSS guard)", async () => {
    const { fetch } = createServer({ getValue: () => "<script>alert(1)</script>" });
    const res = await fetch(new Request("http://test.local/"));
    const body = await res.text();
    expect(body).not.toContain("<script>alert(1)</script>");
    expect(body).toContain("&lt;script&gt;");
  });

  it("partial Strategy preserves stub fallback on null returns (mixed live + placeholder)", async () => {
    const getValue = (m: SuccessMetric) => (m.id === "loop-uptime" ? "0.99" : null);
    const { fetch } = createServer({ getValue });
    const res = await fetch(new Request("http://test.local/"));
    const body = await res.text();
    // 10 metrics − 1 live = 9 stubs.
    expect(body.match(/\(stub\)/g) ?? []).toHaveLength(9);
    expect(body).toContain(">0.99<");
  });
});

import { describe, expect, it, vi } from "vitest";

import type { SuccessMetric } from "../src/metrics.js";
import {
  constantGetValue,
  fetchOpenObserveSnapshot,
  openObserveGetValue,
  parsePromqlInstantResponse,
  queryOpenObservePromql,
  snapshotGetValue,
} from "../src/strategy.js";

const sample: SuccessMetric = {
  id: "loop-uptime",
  label: "Loop uptime",
  formula: "x",
  unit: "fraction",
};

describe("snapshotGetValue — JSON-snapshot-backed Strategy", () => {
  it("returns the snapshot value when the metric id is present", () => {
    const lookup = snapshotGetValue({ "loop-uptime": "0.99" });
    expect(lookup(sample)).toBe("0.99");
  });

  it("returns null for unknown metric ids (falls back to `(stub)` upstream)", () => {
    const lookup = snapshotGetValue({ other: "1" });
    expect(lookup(sample)).toBeNull();
  });

  it("returns null on an empty snapshot (cold-start contract)", () => {
    expect(snapshotGetValue({})(sample)).toBeNull();
  });
});

describe("constantGetValue — smoke-test Strategy", () => {
  it("returns the same string for every metric", () => {
    const lookup = constantGetValue("42");
    expect(lookup(sample)).toBe("42");
    expect(lookup({ ...sample, id: "other" })).toBe("42");
  });
});

describe("parsePromqlInstantResponse — Prometheus HTTP API parser", () => {
  it("extracts the value from a vector result", () => {
    const body = JSON.stringify({
      status: "success",
      data: { resultType: "vector", result: [{ metric: {}, value: [1700000000, "0.99"] }] },
    });
    expect(parsePromqlInstantResponse(body)).toBe("0.99");
  });

  it("extracts the value from a scalar result", () => {
    const body = JSON.stringify({
      status: "success",
      data: { resultType: "scalar", result: [1700000000, "42"] },
    });
    expect(parsePromqlInstantResponse(body)).toBe("42");
  });

  it("returns null on a non-success status", () => {
    const body = JSON.stringify({ status: "error", error: "parse error" });
    expect(parsePromqlInstantResponse(body)).toBeNull();
  });

  it("returns null on malformed JSON (chaos row 4 — graceful-degrade)", () => {
    expect(parsePromqlInstantResponse("not json")).toBeNull();
  });

  it("returns null on an empty vector result (no series matched)", () => {
    const body = JSON.stringify({ status: "success", data: { resultType: "vector", result: [] } });
    expect(parsePromqlInstantResponse(body)).toBeNull();
  });
});

describe("queryOpenObservePromql — read-only HTTP GET against OpenObserve", () => {
  it("issues a GET against /api/<org>/prometheus/api/v1/query and returns the parsed value", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain("/api/default/prometheus/api/v1/query");
      expect(url).toContain("query=up");
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            status: "success",
            data: { resultType: "vector", result: [{ metric: {}, value: [1700000000, "1"] }] },
          }),
      };
    });

    const v = await queryOpenObservePromql(
      { baseUrl: "http://127.0.0.1:5080", fetch: fetchMock },
      "up",
    );
    expect(v).toBe("1");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("attaches HTTP Basic auth when basicAuth opt is supplied", async () => {
    const fetchMock = vi.fn(
      async (_url: string, init?: { readonly headers?: Readonly<Record<string, string>> }) => {
        const auth = init?.headers?.["Authorization"] ?? "";
        expect(auth.startsWith("Basic ")).toBe(true);
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              status: "success",
              data: { resultType: "scalar", result: [1700000000, "7"] },
            }),
        };
      },
    );
    const v = await queryOpenObservePromql(
      {
        baseUrl: "http://127.0.0.1:5080",
        basicAuth: { user: "root@minsky.local", password: "Complexpass#123" },
        fetch: fetchMock,
      },
      "up",
    );
    expect(v).toBe("7");
  });

  it("returns null on non-2xx HTTP status (graceful-degrade)", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => "internal server error",
    }));
    const v = await queryOpenObservePromql(
      { baseUrl: "http://127.0.0.1:5080", fetch: fetchMock },
      "up",
    );
    expect(v).toBeNull();
  });

  it("returns null on network failure (chaos row 3 — graceful-degrade)", async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const v = await queryOpenObservePromql(
      { baseUrl: "http://127.0.0.1:5080", fetch: fetchMock },
      "up",
    );
    expect(v).toBeNull();
  });

  it("normalises a trailing-slash baseUrl so the URL has no double slashes", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).not.toContain("//api/default");
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            status: "success",
            data: { resultType: "scalar", result: [1700000000, "1"] },
          }),
      };
    });
    await queryOpenObservePromql({ baseUrl: "http://127.0.0.1:5080/", fetch: fetchMock }, "up");
  });
});

describe("fetchOpenObserveSnapshot — multi-metric Strategy seam", () => {
  it("issues one query per metric id and returns a Snapshot keyed by metric id", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      // Return a different fake value per query string so the test
      // pins the fan-out shape.
      const value = url.includes("token") ? "1234" : "0.97";
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            status: "success",
            data: { resultType: "scalar", result: [1700000000, value] },
          }),
      };
    });
    const snap = await fetchOpenObserveSnapshot({
      baseUrl: "http://127.0.0.1:5080",
      promqlByMetricId: { "tokens-per-story": "token_count", "loop-uptime": "up" },
      fetch: fetchMock,
    });
    expect(snap["tokens-per-story"]).toBe("1234");
    expect(snap["loop-uptime"]).toBe("0.97");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("omits failed reads so snapshotGetValue falls back to `(stub)` for those rows", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("token")) {
        return { ok: false, status: 500, text: async () => "" };
      }
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            status: "success",
            data: { resultType: "scalar", result: [1700000000, "1"] },
          }),
      };
    });
    const snap = await fetchOpenObserveSnapshot({
      baseUrl: "http://127.0.0.1:5080",
      promqlByMetricId: { "tokens-per-story": "token_count", "loop-uptime": "up" },
      fetch: fetchMock,
    });
    expect(snap["tokens-per-story"]).toBeUndefined();
    expect(snap["loop-uptime"]).toBe("1");
  });

  it("applies the format hook to each raw value", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          status: "success",
          data: { resultType: "scalar", result: [1700000000, "0.99"] },
        }),
    }));
    const snap = await fetchOpenObserveSnapshot({
      baseUrl: "http://127.0.0.1:5080",
      promqlByMetricId: { "loop-uptime": "up" },
      format: (raw, id) => `${id}=${raw}`,
      fetch: fetchMock,
    });
    expect(snap["loop-uptime"]).toBe("loop-uptime=0.99");
  });
});

describe("openObserveGetValue — async pre-fetch + sync render-time lookup", () => {
  it("returns a synchronous GetValue backed by the pre-fetched snapshot", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          status: "success",
          data: { resultType: "scalar", result: [1700000000, "0.99"] },
        }),
    }));
    const lookup = await openObserveGetValue({
      baseUrl: "http://127.0.0.1:5080",
      promqlByMetricId: { "loop-uptime": "up" },
      fetch: fetchMock,
    });
    expect(lookup({ id: "loop-uptime", label: "x", formula: "y", unit: "z" })).toBe("0.99");
    // Unmapped row falls through to null → `(stub)` upstream.
    expect(lookup({ id: "extraction-count", label: "x", formula: "y", unit: "z" })).toBeNull();
  });
});

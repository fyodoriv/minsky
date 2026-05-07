// @ts-check
// Tests for `scripts/check-mlx-server.mjs` — slice 1 substrate of
// `local-llm-fallback-on-budget-pause`.

import { describe, expect, it } from "vitest";

import { classifyError, main, parseArgs, probe } from "./check-mlx-server.mjs";

describe("check-mlx-server / parseArgs", () => {
  it("returns defaults when no args", () => {
    expect(parseArgs([])).toEqual({
      url: "http://127.0.0.1:8080/v1/models",
      timeoutMs: 60_000,
    });
  });

  it("--url= overrides default", () => {
    expect(parseArgs(["--url=http://example.com/probe"])).toEqual({
      url: "http://example.com/probe",
      timeoutMs: 60_000,
    });
  });

  it("--timeout-ms= overrides default when positive integer", () => {
    expect(parseArgs(["--timeout-ms=5000"])).toEqual({
      url: "http://127.0.0.1:8080/v1/models",
      timeoutMs: 5_000,
    });
  });

  it("--timeout-ms=0 falls back to default (must be positive)", () => {
    expect(parseArgs(["--timeout-ms=0"])).toEqual({
      url: "http://127.0.0.1:8080/v1/models",
      timeoutMs: 60_000,
    });
  });

  it("--timeout-ms=abc falls back to default", () => {
    expect(parseArgs(["--timeout-ms=abc"])).toEqual({
      url: "http://127.0.0.1:8080/v1/models",
      timeoutMs: 60_000,
    });
  });

  it("ignores unknown args", () => {
    expect(parseArgs(["--unknown=x"])).toEqual({
      url: "http://127.0.0.1:8080/v1/models",
      timeoutMs: 60_000,
    });
  });
});

describe("check-mlx-server / classifyError", () => {
  it("maps undici-style err.cause.code", () => {
    expect(classifyError({ cause: { code: "ECONNREFUSED" } })).toBe("ECONNREFUSED");
  });

  it("maps direct err.code", () => {
    expect(classifyError({ code: "ENOTFOUND" })).toBe("ENOTFOUND");
  });

  it("maps AbortError to 'abort'", () => {
    expect(classifyError({ name: "AbortError" })).toBe("abort");
  });

  it("falls back to message (truncated to 80 chars)", () => {
    expect(classifyError({ message: "boom" })).toBe("boom");
    expect(classifyError({ message: "x".repeat(150) })).toBe("x".repeat(80));
  });

  it("returns 'unknown' for null/undefined/empty", () => {
    expect(classifyError(null)).toBe("unknown");
    expect(classifyError(undefined)).toBe("unknown");
    expect(classifyError({})).toBe("unknown");
  });
});

describe("check-mlx-server / probe", () => {
  it("returns reachable on 200 OK", async () => {
    /** @type {typeof fetch} */
    const fetchFn = /** @type {any} */ (async () => /** @type {any} */ ({ ok: true, status: 200 }));
    const r = await probe({
      url: "http://test/v1/models",
      timeoutMs: 1_000,
      fetchFn,
      now: () => 12345,
    });
    expect(r).toEqual({ reachable: true, observedAtMs: 12345 });
  });

  it("returns unreachable with 'http NNN' on non-2xx", async () => {
    /** @type {typeof fetch} */
    const fetchFn = /** @type {any} */ (
      async () => /** @type {any} */ ({ ok: false, status: 503 })
    );
    const r = await probe({
      url: "http://test/v1/models",
      timeoutMs: 1_000,
      fetchFn,
      now: () => 12345,
    });
    expect(r).toEqual({
      reachable: false,
      observedAtMs: 12345,
      reason: "http 503",
    });
  });

  it("returns unreachable with classified error code on connection refused", async () => {
    const fetchFn = /** @type {typeof fetch} */ (
      async () => {
        const err = new Error("connect ECONNREFUSED");
        /** @type {any} */ (err).cause = { code: "ECONNREFUSED" };
        throw err;
      }
    );
    const r = await probe({
      url: "http://test/v1/models",
      timeoutMs: 1_000,
      fetchFn,
      now: () => 12345,
    });
    expect(r).toEqual({
      reachable: false,
      observedAtMs: 12345,
      reason: "ECONNREFUSED",
    });
  });

  it("returns 'timeout Nms' on AbortError after timeout fires", async () => {
    /** @type {typeof fetch} */
    const fetchFn = /** @type {any} */ (
      /**
       * @param {any} _url
       * @param {any} opts
       */
      async (_url, opts) => {
        await new Promise((_resolve, reject) => {
          /** @type {AbortSignal} */
          const sig = /** @type {any} */ (opts).signal;
          sig.addEventListener("abort", () => {
            const err = new Error("aborted");
            /** @type {any} */ (err).name = "AbortError";
            reject(err);
          });
          // Otherwise hang forever.
        });
        return /** @type {any} */ ({ ok: true, status: 200 });
      }
    );
    const r = await probe({
      url: "http://test/v1/models",
      timeoutMs: 10,
      fetchFn,
      now: () => 12345,
    });
    expect(r.reachable).toBe(false);
    expect(r.observedAtMs).toBe(12345);
    expect(r.reason).toBe("timeout 10ms");
  });
});

describe("check-mlx-server / main", () => {
  it("writes JSON line on stdout and returns 0 on reachable", async () => {
    /** @type {string[]} */
    const out = [];
    /** @type {typeof fetch} */
    const fetchFn = /** @type {any} */ (async () => /** @type {any} */ ({ ok: true, status: 200 }));
    const code = await main({
      argv: ["--timeout-ms=1000"],
      stdout: { write: (s) => out.push(s) },
      fetchFn,
      now: () => 9999,
    });
    expect(code).toBe(0);
    expect(out).toHaveLength(1);
    const first = out[0];
    if (first === undefined) throw new Error("expected one stdout line");
    expect(JSON.parse(first)).toEqual({
      reachable: true,
      observedAtMs: 9999,
    });
  });

  it("writes JSON line and returns 1 on unreachable", async () => {
    /** @type {string[]} */
    const out = [];
    const fetchFn = /** @type {typeof fetch} */ (
      async () => {
        const err = new Error("refused");
        /** @type {any} */ (err).cause = { code: "ECONNREFUSED" };
        throw err;
      }
    );
    const code = await main({
      argv: ["--timeout-ms=1000"],
      stdout: { write: (s) => out.push(s) },
      fetchFn,
      now: () => 9999,
    });
    expect(code).toBe(1);
    const first = out[0];
    if (first === undefined) throw new Error("expected one stdout line");
    const parsed = JSON.parse(first);
    expect(parsed).toEqual({
      reachable: false,
      observedAtMs: 9999,
      reason: "ECONNREFUSED",
    });
  });
});

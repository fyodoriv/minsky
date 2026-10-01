import { describe, expect, it, type Mock, vi } from "vitest";

import type { FetchLike } from "./ntfy.js";
import { NtfyNotifier, PRIORITY_HEADER } from "./ntfy.js";

type FetchMock = Mock<(input: string | URL, init?: RequestInit) => Promise<Response>>;

/**
 * Build a fetch-mock that returns a synthetic `Response`. `vi.fn()` records
 * each call (`.mock.calls`) so tests can assert URL + headers + body. No
 * real network is touched.
 */
function mockFetch(status: number, statusText = ""): FetchMock {
  return vi.fn(async (_input: string | URL, _init?: RequestInit) => {
    return new Response("", { status, statusText });
  }) as FetchMock;
}

/**
 * Build a fetch-mock that rejects (simulates network partition / DNS fail).
 */
function rejectingFetch(message: string): FetchMock {
  return vi.fn(async (_input: string | URL, _init?: RequestInit) => {
    throw new Error(message);
  }) as FetchMock;
}

/** vi.fn() and FetchLike are structurally compatible; the cast is a thin
 * type-system bridge since vi.Mock encodes more than the runtime cares about. */
const asFetch = (m: FetchMock): FetchLike => m as unknown as FetchLike;

/** First-call extractor; throws if no call has been recorded yet so tests fail
 * loudly rather than dereferencing `undefined`. */
function firstCall(m: FetchMock): { url: string | URL; init: RequestInit | undefined } {
  const c = m.mock.calls[0];
  if (c === undefined) throw new Error("expected at least one fetch call");
  return { url: c[0], init: c[1] };
}

describe("NtfyNotifier — request shape", () => {
  it("POSTs to https://ntfy.sh/<topic> by default with body + Title + Priority", async () => {
    const m = mockFetch(200);
    const n = new NtfyNotifier({ topic: "minsky-test", fetchFn: asFetch(m) });
    const r = await n.push({ title: "hello", body: "world", priority: "high" });
    expect(r).toEqual({ ok: true });
    expect(m).toHaveBeenCalledTimes(1);
    const { url, init } = firstCall(m);
    expect(url).toBe("https://ntfy.sh/minsky-test");
    if (init === undefined) throw new Error("init missing");
    expect(init.method).toBe("POST");
    expect(init.body).toBe("world");
    const headers = init.headers as Record<string, string>;
    expect(headers["Title"]).toBe("hello");
    expect(headers[PRIORITY_HEADER]).toBe("5"); // high → 5
  });

  it("respects a self-hosted serverBaseUrl and strips trailing slash", async () => {
    const m = mockFetch(200);
    const n = new NtfyNotifier({
      topic: "alerts",
      serverBaseUrl: "https://ntfy.example.com/",
      fetchFn: asFetch(m),
    });
    await n.push({ title: "t", body: "b" });
    const { url } = firstCall(m);
    expect(url).toBe("https://ntfy.example.com/alerts");
  });

  it("maps priority: low→2, normal→3 (default), high→5", async () => {
    const m = mockFetch(200);
    const n = new NtfyNotifier({ topic: "t", fetchFn: asFetch(m) });
    await n.push({ title: "a", body: "b", priority: "low" });
    await n.push({ title: "a", body: "b" }); // default → normal
    await n.push({ title: "a", body: "b", priority: "high" });
    const calls = m.mock.calls;
    const c0 = calls[0];
    const c1 = calls[1];
    const c2 = calls[2];
    if (c0 === undefined || c1 === undefined || c2 === undefined) {
      throw new Error("expected 3 fetch calls");
    }
    const i0 = c0[1];
    const i1 = c1[1];
    const i2 = c2[1];
    if (i0 === undefined || i1 === undefined || i2 === undefined) {
      throw new Error("init missing on one of the recorded calls");
    }
    expect((i0.headers as Record<string, string>)[PRIORITY_HEADER]).toBe("2");
    expect((i1.headers as Record<string, string>)[PRIORITY_HEADER]).toBe("3");
    expect((i2.headers as Record<string, string>)[PRIORITY_HEADER]).toBe("5");
  });

  it("attaches Authorization: Bearer <token> when authToken is set", async () => {
    const m = mockFetch(200);
    const n = new NtfyNotifier({ topic: "t", authToken: "tk_secret", fetchFn: asFetch(m) });
    await n.push({ title: "a", body: "b" });
    const { init } = firstCall(m);
    if (init === undefined) throw new Error("init missing");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer tk_secret");
  });

  it("omits Authorization header when no authToken is supplied", async () => {
    const m = mockFetch(200);
    const n = new NtfyNotifier({ topic: "t", fetchFn: asFetch(m) });
    await n.push({ title: "a", body: "b" });
    const { init } = firstCall(m);
    if (init === undefined) throw new Error("init missing");
    expect("Authorization" in (init.headers as Record<string, string>)).toBe(false);
  });

  it("joins tags with comma into a single Tags header", async () => {
    const m = mockFetch(200);
    const n = new NtfyNotifier({ topic: "t", fetchFn: asFetch(m) });
    await n.push({ title: "a", body: "b", tags: ["warning", "robot"] });
    const { init } = firstCall(m);
    if (init === undefined) throw new Error("init missing");
    expect((init.headers as Record<string, string>)["Tags"]).toBe("warning,robot");
  });
});

describe("NtfyNotifier — graceful-degrade (rule #7)", () => {
  it("returns { ok: false, reason: 'http 429' } on rate-limited response", async () => {
    const m = mockFetch(429, "Too Many Requests");
    const n = new NtfyNotifier({ topic: "t", fetchFn: asFetch(m) });
    const r = await n.push({ title: "a", body: "b" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("http 429");
  });

  it("returns { ok: false } on a 5xx without throwing", async () => {
    const m = mockFetch(503);
    const n = new NtfyNotifier({ topic: "t", fetchFn: asFetch(m) });
    const r = await n.push({ title: "a", body: "b" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("http 503");
  });

  it("returns { ok: false, reason: 'network: …' } when fetch rejects (network partition)", async () => {
    const m = rejectingFetch("ENOTFOUND ntfy.sh");
    const n = new NtfyNotifier({ topic: "t", fetchFn: asFetch(m) });
    const r = await n.push({ title: "a", body: "b" });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/^network: /);
    expect(r.reason).toContain("ENOTFOUND");
  });
});

describe("NtfyNotifier — selfTest", () => {
  it("returns green against a mock 200", async () => {
    const m = mockFetch(200);
    const n = new NtfyNotifier({ topic: "t", fetchFn: asFetch(m) });
    const r = await n.selfTest();
    expect(r.status).toBe("green");
    expect(r.message).toContain("accepted push");
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(Date.parse(r.lastCheck))).toBe(false);
  });

  it("returns red on a network error", async () => {
    const m = rejectingFetch("ECONNREFUSED");
    const n = new NtfyNotifier({ topic: "t", fetchFn: asFetch(m) });
    const r = await n.selfTest();
    expect(r.status).toBe("red");
    expect(r.message).toContain("ECONNREFUSED");
  });

  it("returns yellow on rate-limit (429) — service is up but we are throttled", async () => {
    const m = mockFetch(429);
    const n = new NtfyNotifier({ topic: "t", fetchFn: asFetch(m) });
    const r = await n.selfTest();
    expect(r.status).toBe("yellow");
    expect(r.message).toContain("http 429");
  });

  it("selfTest sends a low-priority push with a deterministic title", async () => {
    const m = mockFetch(200);
    const n = new NtfyNotifier({ topic: "t", fetchFn: asFetch(m) });
    await n.selfTest();
    const { init } = firstCall(m);
    if (init === undefined) throw new Error("init missing");
    const headers = init.headers as Record<string, string>;
    expect(headers["Title"]).toBe("minsky.notifier.selfTest");
    expect(headers[PRIORITY_HEADER]).toBe("2"); // low
  });
});

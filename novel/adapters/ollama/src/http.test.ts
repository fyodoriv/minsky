import { describe, expect, it, type Mock, vi } from "vitest";

import type { FetchLike } from "./http.js";
import { HttpOllama, stripLitellmPrefix } from "./http.js";

type FetchMock = Mock<(input: string | URL, init?: RequestInit) => Promise<Response>>;

/** Build a fetch-mock that returns a synthetic `Response` with a JSON body. */
function mockFetch(status: number, jsonBody: unknown = {}): FetchMock {
  return vi.fn((_input: string | URL, _init?: RequestInit) =>
    Promise.resolve(
      new Response(JSON.stringify(jsonBody), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  ) as FetchMock;
}

/** Build a fetch-mock that rejects (simulates network partition / DNS fail). */
function rejectingFetch(message: string): FetchMock {
  return vi.fn((_input: string | URL, _init?: RequestInit) =>
    Promise.reject(new Error(message)),
  ) as FetchMock;
}

/** Build a fetch-mock that hangs until its signal aborts — for timeout tests. */
function hangingFetch(): FetchMock {
  return vi.fn(
    (_input: string | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      }),
  ) as FetchMock;
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

describe("stripLitellmPrefix", () => {
  it("strips ollama_chat/ prefix", () => {
    expect(stripLitellmPrefix("ollama_chat/qwen3-coder:30b")).toBe("qwen3-coder:30b");
  });

  it("strips ollama/ prefix", () => {
    expect(stripLitellmPrefix("ollama/qwen3-coder:30b")).toBe("qwen3-coder:30b");
  });

  it("passes through unprefixed model ids", () => {
    expect(stripLitellmPrefix("qwen3-coder:30b")).toBe("qwen3-coder:30b");
  });
});

describe("HttpOllama.warm — request shape", () => {
  it("POSTs to /api/generate with empty prompt + keep_alive 30m by default", async () => {
    const m = mockFetch(200, { response: "", done: true });
    const ollama = new HttpOllama({ fetchFn: asFetch(m) });
    const result = await ollama.warm("qwen3-coder:30b");
    expect(result).toEqual({ ok: true });
    const { url, init } = firstCall(m);
    expect(url).toBe("http://localhost:11434/api/generate");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(
      JSON.stringify({ model: "qwen3-coder:30b", prompt: "", keep_alive: "30m" }),
    );
  });

  it("strips LiteLLM ollama_chat/ prefix before sending", async () => {
    const m = mockFetch(200);
    const ollama = new HttpOllama({ fetchFn: asFetch(m) });
    await ollama.warm("ollama_chat/qwen3-coder:30b");
    const { init } = firstCall(m);
    const parsed = JSON.parse(init?.body as string);
    expect(parsed.model).toBe("qwen3-coder:30b");
  });

  it("respects a custom keep_alive override", async () => {
    const m = mockFetch(200);
    const ollama = new HttpOllama({ fetchFn: asFetch(m) });
    await ollama.warm("qwen3-coder:30b", "1h");
    const { init } = firstCall(m);
    const parsed = JSON.parse(init?.body as string);
    expect(parsed.keep_alive).toBe("1h");
  });

  it("normalises a trailing slash in baseUrl", async () => {
    const m = mockFetch(200);
    const ollama = new HttpOllama({ baseUrl: "http://localhost:11434/", fetchFn: asFetch(m) });
    await ollama.warm("qwen3-coder:30b");
    const { url } = firstCall(m);
    expect(url).toBe("http://localhost:11434/api/generate");
  });

  it("returns ok: false with reason on network rejection — never throws (rule #7)", async () => {
    const m = rejectingFetch("connect ECONNREFUSED 127.0.0.1:11434");
    const ollama = new HttpOllama({ fetchFn: asFetch(m) });
    const result = await ollama.warm("qwen3-coder:30b");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("network:");
    expect(result.reason).toContain("ECONNREFUSED");
  });

  it("returns ok: false with reason on non-2xx response — never throws", async () => {
    const m = mockFetch(503, { error: "service unavailable" });
    const ollama = new HttpOllama({ fetchFn: asFetch(m) });
    const result = await ollama.warm("qwen3-coder:30b");
    expect(result).toEqual({ ok: false, reason: "http 503" });
  });

  it("returns ok: false with reason on 404 model not found", async () => {
    const m = mockFetch(404, { error: "model not found" });
    const ollama = new HttpOllama({ fetchFn: asFetch(m) });
    const result = await ollama.warm("nonexistent:latest");
    expect(result).toEqual({ ok: false, reason: "http 404" });
  });

  it("aborts after the configured timeout and surfaces it as a network reason", async () => {
    const m = hangingFetch();
    const ollama = new HttpOllama({ fetchFn: asFetch(m), timeoutMs: 50 });
    const result = await ollama.warm("qwen3-coder:30b");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("network:");
  });
});

describe("HttpOllama.unload — request shape", () => {
  it("POSTs to /api/generate with keep_alive 0", async () => {
    const m = mockFetch(200, { response: "", done: true, done_reason: "unload" });
    const ollama = new HttpOllama({ fetchFn: asFetch(m) });
    const result = await ollama.unload("qwen3-coder:30b");
    expect(result).toEqual({ ok: true });
    const { url, init } = firstCall(m);
    expect(url).toBe("http://localhost:11434/api/generate");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ model: "qwen3-coder:30b", keep_alive: 0 }));
  });

  it("strips LiteLLM prefix on unload", async () => {
    const m = mockFetch(200, { done_reason: "unload" });
    const ollama = new HttpOllama({ fetchFn: asFetch(m) });
    await ollama.unload("ollama_chat/qwen3-coder:30b");
    const { init } = firstCall(m);
    const parsed = JSON.parse(init?.body as string);
    expect(parsed.model).toBe("qwen3-coder:30b");
    expect(parsed.keep_alive).toBe(0);
  });

  it("returns ok: false on network failure but never throws", async () => {
    const m = rejectingFetch("ECONNREFUSED");
    const ollama = new HttpOllama({ fetchFn: asFetch(m) });
    const result = await ollama.unload("qwen3-coder:30b");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("network:");
  });

  it("returns ok: false on non-2xx response", async () => {
    const m = mockFetch(500);
    const ollama = new HttpOllama({ fetchFn: asFetch(m) });
    const result = await ollama.unload("qwen3-coder:30b");
    expect(result).toEqual({ ok: false, reason: "http 500" });
  });
});

describe("HttpOllama.ps", () => {
  it("GETs /api/ps and returns parsed model list", async () => {
    const m = mockFetch(200, {
      models: [
        {
          name: "qwen3-coder:30b",
          size: 45_157_287_968,
          size_vram: 45_157_287_968,
          expires_at: "2026-05-29T13:30:00Z",
          digest: "06c1097efce0",
        },
      ],
    });
    const ollama = new HttpOllama({ fetchFn: asFetch(m) });
    const result = await ollama.ps();
    expect(result.ok).toBe(true);
    expect(result.models).toEqual([
      {
        name: "qwen3-coder:30b",
        size: 45_157_287_968,
        sizeVram: 45_157_287_968,
        expiresAt: "2026-05-29T13:30:00Z",
      },
    ]);
    const { url, init } = firstCall(m);
    expect(url).toBe("http://localhost:11434/api/ps");
    expect(init?.method).toBe("GET");
  });

  it("returns empty models when /api/ps payload has no models field", async () => {
    const m = mockFetch(200, {});
    const ollama = new HttpOllama({ fetchFn: asFetch(m) });
    const result = await ollama.ps();
    expect(result).toEqual({ ok: true, models: [] });
  });

  it("returns ok: false on network failure with empty models — never throws", async () => {
    const m = rejectingFetch("getaddrinfo ENOTFOUND localhost");
    const ollama = new HttpOllama({ fetchFn: asFetch(m) });
    const result = await ollama.ps();
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("network:");
    expect(result.models).toEqual([]);
  });

  it("skips malformed model rows rather than crashing the parse", async () => {
    const m = mockFetch(200, {
      models: [
        { name: "ok-model", size: 100, size_vram: 100 },
        { not_a_name: true },
        null,
        "string-row",
        { name: "another-ok-model" },
      ],
    });
    const ollama = new HttpOllama({ fetchFn: asFetch(m) });
    const result = await ollama.ps();
    expect(result.ok).toBe(true);
    expect(result.models.map((m) => m.name)).toEqual(["ok-model", "another-ok-model"]);
  });
});

describe("HttpOllama.selfTest", () => {
  it("returns green when ps() succeeds", async () => {
    const m = mockFetch(200, { models: [] });
    const ollama = new HttpOllama({ fetchFn: asFetch(m) });
    const result = await ollama.selfTest();
    expect(result.status).toBe("green");
    expect(result.message).toContain("0 models loaded");
    expect(typeof result.latencyMs).toBe("number");
  });

  it("uses singular 'model' in the message when exactly one is loaded", async () => {
    const m = mockFetch(200, {
      models: [{ name: "qwen3-coder:30b", size: 1, size_vram: 1 }],
    });
    const ollama = new HttpOllama({ fetchFn: asFetch(m) });
    const result = await ollama.selfTest();
    expect(result.message).toContain("1 model loaded");
  });

  it("returns red when ps() fails with a network error", async () => {
    const m = rejectingFetch("ECONNREFUSED");
    const ollama = new HttpOllama({ fetchFn: asFetch(m) });
    const result = await ollama.selfTest();
    expect(result.status).toBe("red");
    expect(result.message).toContain("ollama selfTest failed");
  });

  it("returns red on http 5xx", async () => {
    const m = mockFetch(500);
    const ollama = new HttpOllama({ fetchFn: asFetch(m) });
    const result = await ollama.selfTest();
    expect(result.status).toBe("red");
    expect(result.message).toContain("http 500");
  });
});

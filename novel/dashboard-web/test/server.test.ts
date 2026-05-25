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
    // One `data-metric-id` attribute per SUCCESS_METRIC. Counting
    // from the live array prevents this assertion from rotting every
    // time a tile is added (e.g. #790 added `cross-repo-pr-rate`;
    // PR `feat/m1-2-m1-7-collectors-from-transform-ledger` added 3
    // more — and the assertion would have to be hand-edited each
    // time otherwise).
    expect(body.match(/data-metric-id=/g) ?? []).toHaveLength(SUCCESS_METRICS.length);
  });

  it("renders exactly SUCCESS_METRICS.length data-metric-id attributes for the default SUCCESS_METRICS", async () => {
    const { fetch } = createServer({ metrics: SUCCESS_METRICS });
    const res = await fetch(new Request("http://test.local/"));
    const body = await res.text();
    expect(body.match(/data-metric-id=/g) ?? []).toHaveLength(SUCCESS_METRICS.length);
  });

  it("renders all SUCCESS_METRICS ids (set-equality assertion)", async () => {
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
    // One (stub) per SUCCESS_METRIC row.
    expect(body.match(/\(stub\)/g) ?? []).toHaveLength(SUCCESS_METRICS.length);
  });

  it("live values replace `(stub)` when Strategy returns strings (otel-wiring seam)", async () => {
    const { fetch } = createServer({ getValue: () => "42" });
    const res = await fetch(new Request("http://test.local/"));
    const body = await res.text();
    expect(body.match(/\(stub\)/g) ?? []).toHaveLength(0);
    expect(body).toContain(">42<");
    expect((body.match(/>42</g) ?? []).length).toBe(SUCCESS_METRICS.length);
  });

  it("default Strategy preserves backward compat (no getValue arg → all stubs)", async () => {
    const { fetch } = createServer();
    const res = await fetch(new Request("http://test.local/"));
    const body = await res.text();
    expect(body.match(/\(stub\)/g) ?? []).toHaveLength(SUCCESS_METRICS.length);
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
    // N metrics − 1 live (loop-uptime) = N-1 stubs.
    expect(body.match(/\(stub\)/g) ?? []).toHaveLength(SUCCESS_METRICS.length - 1);
    expect(body).toContain(">0.99<");
  });
});

describe("createServer — GET /watch.json (Apple-Shortcuts surface)", () => {
  it("returns 200 + application/json content-type", async () => {
    const { fetch } = createServer();
    const res = await fetch(new Request("http://test.local/watch.json"));
    expect(res.status).toBe(200);
    const ctype = res.headers.get("content-type") ?? "";
    expect(ctype).toMatch(/application\/json/i);
  });

  it("body is valid JSON with the 3 watch fields + paused boolean + pauseReason", async () => {
    const { fetch } = createServer();
    const res = await fetch(new Request("http://test.local/watch.json"));
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      [
        "constraint-of-the-week",
        "last-task-status",
        "paused",
        "pauseReason",
        "tokens-remaining",
      ].sort(),
    );
    expect(typeof body["tokens-remaining"]).toBe("string");
    expect(typeof body["last-task-status"]).toBe("string");
    expect(typeof body["constraint-of-the-week"]).toBe("string");
    expect(typeof body.paused).toBe("boolean");
    // pauseReason is "operator" | "budget" | null — null when unknown
    // (stub default) or not paused. Tests below exercise the live values.
    expect(body.pauseReason === null || typeof body.pauseReason === "string").toBe(true);
  });

  it("default Strategy → all three readings are the (stub) sentinel, paused=false, pauseReason=null", async () => {
    const { fetch } = createServer();
    const res = await fetch(new Request("http://test.local/watch.json"));
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["tokens-remaining"]).toBe("(stub)");
    expect(body["last-task-status"]).toBe("(stub)");
    expect(body["constraint-of-the-week"]).toBe("(stub)");
    expect(body.paused).toBe(false);
    expect(body.pauseReason).toBeNull();
  });

  it("pauseReason Strategy='budget' surfaces on the envelope alongside paused:true", async () => {
    const { fetch } = createServer({
      getPauseState: () => true,
      getPauseReason: () => "budget",
    });
    const res = await fetch(new Request("http://test.local/watch.json"));
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.paused).toBe(true);
    expect(body.pauseReason).toBe("budget");
  });

  it("live Strategy values flow through to the watch envelope", async () => {
    const getValue = (m: SuccessMetric) => {
      if (m.id === "token-budget-honoring") return "0";
      if (m.id === "task-throughput") return "feat: shipped";
      if (m.id === "self-improvement-velocity") return "rule-2";
      return null;
    };
    const { fetch } = createServer({ getValue });
    const res = await fetch(new Request("http://test.local/watch.json"));
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["tokens-remaining"]).toBe("0");
    expect(body["last-task-status"]).toBe("feat: shipped");
    expect(body["constraint-of-the-week"]).toBe("rule-2");
  });

  it("pause-state Strategy=true surfaces paused:true on the envelope", async () => {
    const { fetch } = createServer({ getPauseState: () => true });
    const res = await fetch(new Request("http://test.local/watch.json"));
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.paused).toBe(true);
  });
});

describe("createServer — POST /control (pause/resume Shortcut endpoint)", () => {
  function postControl(
    fetch: ReturnType<typeof createServer>["fetch"],
    body: unknown,
  ): Promise<Response> {
    const init: RequestInit =
      body === undefined
        ? { method: "POST" }
        : {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: typeof body === "string" ? body : JSON.stringify(body),
          };
    return fetch(new Request("http://test.local/control", init)) as Promise<Response>;
  }

  it("POST /control {paused:true} → 200 {ok:true, paused:true} and Strategy is called once with true", async () => {
    const calls: boolean[] = [];
    const setPaused = (v: boolean) => calls.push(v);
    const { fetch } = createServer({ setPaused });
    const res = await postControl(fetch, { paused: true });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({ ok: true, paused: true });
    expect(calls).toEqual([true]);
  });

  it("POST /control {paused:false} → 200 {ok:true, paused:false} and Strategy is called once with false", async () => {
    const calls: boolean[] = [];
    const setPaused = (v: boolean) => calls.push(v);
    const { fetch } = createServer({ setPaused });
    const res = await postControl(fetch, { paused: false });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, paused: false });
    expect(calls).toEqual([false]);
  });

  it("round-trip: POST /control {paused:true} mutates the next GET /watch.json `paused` field (default in-memory pair)", async () => {
    const { fetch } = createServer();
    const before = (await (
      await fetch(new Request("http://test.local/watch.json"))
    ).json()) as Record<string, unknown>;
    expect(before.paused).toBe(false);
    const post = await postControl(fetch, { paused: true });
    expect(post.status).toBe(200);
    const after = (await (
      await fetch(new Request("http://test.local/watch.json"))
    ).json()) as Record<string, unknown>;
    expect(after.paused).toBe(true);
    // And the inverse: a second POST flips back.
    await postControl(fetch, { paused: false });
    const last = (await (
      await fetch(new Request("http://test.local/watch.json"))
    ).json()) as Record<string, unknown>;
    expect(last.paused).toBe(false);
  });

  it("400 on missing body (no JSON payload)", async () => {
    const calls: boolean[] = [];
    const setPaused = (v: boolean) => calls.push(v);
    const { fetch } = createServer({ setPaused });
    const res = await postControl(fetch, undefined);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "missing body" });
    expect(calls).toEqual([]);
  });

  it("400 on body without `paused` key", async () => {
    const calls: boolean[] = [];
    const setPaused = (v: boolean) => calls.push(v);
    const { fetch } = createServer({ setPaused });
    const res = await postControl(fetch, { other: true });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "missing paused field" });
    expect(calls).toEqual([]);
  });

  it("400 on non-boolean `paused`", async () => {
    const calls: boolean[] = [];
    const setPaused = (v: boolean) => calls.push(v);
    const { fetch } = createServer({ setPaused });
    const res = await postControl(fetch, { paused: "true" });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "paused must be boolean" });
    expect(calls).toEqual([]);
  });

  it("400 on malformed JSON body (graceful-degrade per rule #7)", async () => {
    const calls: boolean[] = [];
    const setPaused = (v: boolean) => calls.push(v);
    const { fetch } = createServer({ setPaused });
    const res = await postControl(fetch, "{not-json");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "missing body" });
    expect(calls).toEqual([]);
  });
});

describe("createServer — POST /control X-Minsky-Token auth (rule #13.4 slice 2)", () => {
  const TOKEN = "abc123def456";

  function postControlWith(
    fetch: ReturnType<typeof createServer>["fetch"],
    headers: Record<string, string>,
    body: unknown,
  ): Promise<Response> {
    return fetch(
      new Request("http://test.local/control", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      }),
    ) as Promise<Response>;
  }

  it("401 + missing-header error when controlToken is configured but no X-Minsky-Token sent", async () => {
    const calls: boolean[] = [];
    const { fetch } = createServer({
      controlToken: TOKEN,
      setPaused: (v) => calls.push(v),
    });
    const res = await postControlWith(fetch, {}, { paused: true });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "missing X-Minsky-Token header" });
    expect(calls).toEqual([]);
  });

  it("401 + wrong-token error when X-Minsky-Token does not match the configured token", async () => {
    const calls: boolean[] = [];
    const { fetch } = createServer({
      controlToken: TOKEN,
      setPaused: (v) => calls.push(v),
    });
    const res = await postControlWith(
      fetch,
      { "x-minsky-token": "wrongtoken000" },
      { paused: true },
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "wrong token" });
    expect(calls).toEqual([]);
  });

  it("401 + wrong-token when token length differs (constant-time length-check path)", async () => {
    const calls: boolean[] = [];
    const { fetch } = createServer({
      controlToken: TOKEN,
      setPaused: (v) => calls.push(v),
    });
    const res = await postControlWith(fetch, { "x-minsky-token": "short" }, { paused: true });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "wrong token" });
    expect(calls).toEqual([]);
  });

  it("200 when X-Minsky-Token matches the configured token (happy path)", async () => {
    const calls: boolean[] = [];
    const { fetch } = createServer({
      controlToken: TOKEN,
      setPaused: (v) => calls.push(v),
    });
    const res = await postControlWith(fetch, { "x-minsky-token": TOKEN }, { paused: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, paused: true });
    expect(calls).toEqual([true]);
  });

  it("header lookup is case-insensitive (X-Minsky-Token vs x-minsky-token, RFC 7230 §3.2)", async () => {
    const calls: boolean[] = [];
    const { fetch } = createServer({
      controlToken: TOKEN,
      setPaused: (v) => calls.push(v),
    });
    const res = await postControlWith(fetch, { "X-Minsky-Token": TOKEN }, { paused: false });
    expect(res.status).toBe(200);
    expect(calls).toEqual([false]);
  });

  it("auth runs BEFORE body parse — bad token + invalid body still returns 401, not 400", async () => {
    const calls: boolean[] = [];
    const { fetch } = createServer({
      controlToken: TOKEN,
      setPaused: (v) => calls.push(v),
    });
    const res = await postControlWith(fetch, { "x-minsky-token": "wrongbutsame" }, { other: 99 });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "wrong token" });
    expect(calls).toEqual([]);
  });

  it("auth runs BEFORE body parse — missing header + missing body returns 401, not 400", async () => {
    const calls: boolean[] = [];
    const { fetch } = createServer({
      controlToken: TOKEN,
      setPaused: (v) => calls.push(v),
    });
    const res = await fetch(new Request("http://test.local/control", { method: "POST" }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "missing X-Minsky-Token header" });
    expect(calls).toEqual([]);
  });

  it("when controlToken is undefined (default), POST /control accepts requests without a token (backward-compat with v0)", async () => {
    const calls: boolean[] = [];
    const { fetch } = createServer({ setPaused: (v) => calls.push(v) });
    const res = await fetch(
      new Request("http://test.local/control", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paused: true }),
      }),
    );
    expect(res.status).toBe(200);
    expect(calls).toEqual([true]);
  });

  it("matching token + valid body round-trips into GET /watch.json (auth doesn't break the pause-state pipeline)", async () => {
    const { fetch } = createServer({ controlToken: TOKEN });
    const before = (await (
      await fetch(new Request("http://test.local/watch.json"))
    ).json()) as Record<string, unknown>;
    expect(before.paused).toBe(false);
    const post = await postControlWith(fetch, { "x-minsky-token": TOKEN }, { paused: true });
    expect(post.status).toBe(200);
    const after = (await (
      await fetch(new Request("http://test.local/watch.json"))
    ).json()) as Record<string, unknown>;
    expect(after.paused).toBe(true);
  });

  it("empty-string X-Minsky-Token is rejected as missing-header (matches validateControlAuth contract)", async () => {
    const calls: boolean[] = [];
    const { fetch } = createServer({
      controlToken: TOKEN,
      setPaused: (v) => calls.push(v),
    });
    const res = await postControlWith(fetch, { "x-minsky-token": "" }, { paused: true });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "missing X-Minsky-Token header" });
    expect(calls).toEqual([]);
  });

  it("GET / and GET /watch.json are NOT gated by controlToken — auth applies only to POST /control", async () => {
    const { fetch } = createServer({ controlToken: TOKEN });
    const html = await fetch(new Request("http://test.local/"));
    expect(html.status).toBe(200);
    const json = await fetch(new Request("http://test.local/watch.json"));
    expect(json.status).toBe(200);
  });
});

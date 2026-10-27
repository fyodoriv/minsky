// Tests for scripts/telemetry.mjs and scripts/usage-events.mjs: content-free
// lines only, no send without a key, DO_NOT_TRACK and `off` honored, a fake
// endpoint only (nothing real is ever sent).
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildBatch, noticeOnce, send, setEnabled, status } from "./telemetry.mjs";
import { buildEvent, FIELDS, readEvents, record } from "./usage-events.mjs";

const CANARY = "canary-secret-task-text-/Users/someone/project";

function env(extra = {}) {
  return {
    MINSKY_STATE_DIR: mkdtempSync(join(tmpdir(), "minsky-tel-")),
    MINSKY_POSTHOG_KEY: "",
    ...extra,
  };
}

describe("usage events", () => {
  it("keep only allowlisted fields and map unknown commands to other", () => {
    const e = env();
    record(buildEvent({ command: CANARY, exitCode: 3, durationMs: 12.6 }), e);
    const raw = readFileSync(join(e.MINSKY_STATE_DIR, "usage.jsonl"), "utf8");
    expect(raw).not.toContain("canary");
    const [ev] = readEvents(e);
    expect(Object.keys(ev ?? {}).sort()).toEqual([...FIELDS].sort());
    expect(ev).toMatchObject({ command: "other", status: "error", exit_code: 3, duration_ms: 13 });
  });

  it("MINSKY_USAGE=off records nothing", () => {
    const e = env({ MINSKY_USAGE: "off" });
    expect(record(buildEvent({ command: "run", exitCode: 0, durationMs: 1 }), e)).toBe(false);
    expect(readEvents(e)).toEqual([]);
  });
});

describe("telemetry", () => {
  it("sends nothing without a key", async () => {
    const e = env();
    record(buildEvent({ command: "run", exitCode: 0, durationMs: 1 }), e);
    let calls = 0;
    const r = await send({ env: e, fetchImpl: async () => (calls++, new Response("{}")) });
    expect(r).toEqual({ sent: 0, skipped: "no key" });
    expect(calls).toBe(0);
  });

  it("DO_NOT_TRACK and `off` stop sending even with a key", async () => {
    const e = env({ MINSKY_POSTHOG_KEY: "phc_fake", DO_NOT_TRACK: "1" });
    expect(status(e).reason).toBe("DO_NOT_TRACK");
    const e2 = env({ MINSKY_POSTHOG_KEY: "phc_fake" });
    setEnabled(false, e2);
    expect(status(e2).reason).toBe("turned off");
  });

  it("sends one batch to the fake endpoint, then at most once a day", async () => {
    const e = env({
      MINSKY_POSTHOG_KEY: "phc_fake",
      MINSKY_TELEMETRY_URL: "http://fake.invalid/batch/",
    });
    record(buildEvent({ command: "solve", exitCode: 0, durationMs: 5 }), e);
    /** @type {{ url: string, body: any }[]} */
    const seen = [];
    const fetchImpl = async (/** @type {any} */ url, /** @type {any} */ init) => {
      seen.push({ url, body: JSON.parse(init.body) });
      return new Response("{}");
    };
    expect(await send({ env: e, fetchImpl, daily: true })).toEqual({ sent: 1 });
    record(buildEvent({ command: "run", exitCode: 0, durationMs: 5 }), e);
    expect(await send({ env: e, fetchImpl, daily: true })).toEqual({
      sent: 0,
      skipped: "sent today",
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe("http://fake.invalid/batch/");
    const props = seen[0]?.body.batch[0].properties;
    expect(props).toMatchObject({
      $geoip_disable: true,
      $process_person_profile: false,
      command: "solve",
    });
  });

  it("a dry run hides the key and holds no content", async () => {
    const e = env({ MINSKY_POSTHOG_KEY: "phc_fake" });
    record(buildEvent({ command: CANARY, exitCode: 0, durationMs: 1 }), e);
    const r = await send({ env: e, dryRun: true });
    const text = JSON.stringify(r.body);
    expect(text).toContain("<posthog_key>");
    expect(text).not.toContain("phc_fake");
    expect(text).not.toContain("canary");
  });

  it("shows the notice once per machine", () => {
    const e = env();
    expect(noticeOnce(e)).toContain("DO_NOT_TRACK=1");
    expect(noticeOnce(e)).toBe("");
  });

  it("batch events carry the install id, not a host or user name", () => {
    const b = buildBatch([{ ts: "t", event: "command", command: "run" }], "k", "abc");
    expect(b.batch[0]).toMatchObject({ event: "minsky.command", distinct_id: "abc" });
  });
});

/**
 * Paired tests for `local-llm-server-status.ts`. Slice 14 of P0 task
 * `minsky-cli-auto-bootstrap-local-llm`.
 *
 * Covers all 5 chaos-table rows from {@link summarizeMlxServerStatus}'s JSDoc:
 *   1. No PID file → not-running
 *   2. PID file unparseable → invalid-pid-file
 *   3. PID dead → stale + stalePid
 *   4. PID alive + reachable → running + pid + url
 *   5. PID alive but unreachable → unhealthy + pid + url
 */

import { describe, expect, it } from "vitest";
import {
  type MlxServerStatus,
  type StatusInput,
  renderMlxServerStatusJson,
  summarizeMlxServerStatus,
} from "./local-llm-server-status.js";

const URL = "http://127.0.0.1:8080/v1/models";

function input(overrides: Partial<StatusInput>): StatusInput {
  return {
    pidPresent: false,
    parsedPid: undefined,
    pidAlive: false,
    serverReachable: false,
    serverUrl: URL,
    ...overrides,
  };
}

describe("summarizeMlxServerStatus — row 1: no pid file", () => {
  it("returns { kind: 'not-running' } when pidPresent is false", () => {
    expect(summarizeMlxServerStatus(input({ pidPresent: false }))).toEqual({
      kind: "not-running",
    });
  });

  it("ignores parsedPid / pidAlive / serverReachable when pidPresent is false", () => {
    const out = summarizeMlxServerStatus(
      input({
        pidPresent: false,
        parsedPid: 999,
        pidAlive: true,
        serverReachable: true,
      }),
    );
    expect(out).toEqual({ kind: "not-running" });
  });
});

describe("summarizeMlxServerStatus — row 2: invalid pid file", () => {
  it("returns invalid-pid-file when pidPresent is true but parsedPid is undefined", () => {
    expect(summarizeMlxServerStatus(input({ pidPresent: true, parsedPid: undefined }))).toEqual({
      kind: "invalid-pid-file",
    });
  });

  it("does NOT collapse to not-running just because PID is missing", () => {
    // The distinction matters: not-running means no file (clean state),
    // invalid-pid-file means there's a stray file the operator should
    // know about and clean up via stop-mlx-server.
    const out = summarizeMlxServerStatus(input({ pidPresent: true, parsedPid: undefined }));
    expect(out.kind).toBe("invalid-pid-file");
    expect(out.kind).not.toBe("not-running");
  });
});

describe("summarizeMlxServerStatus — row 3: stale pid", () => {
  it("returns stale + stalePid when pid is dead", () => {
    expect(
      summarizeMlxServerStatus(input({ pidPresent: true, parsedPid: 12345, pidAlive: false })),
    ).toEqual({ kind: "stale", stalePid: 12345 });
  });

  it("ignores serverReachable when pid is dead", () => {
    // A dead PID can't be answering HTTP — but if some unrelated process
    // happens to be listening on 8080, we still report stale (the PID
    // file is the source of truth for "is OUR server running?").
    const out = summarizeMlxServerStatus(
      input({
        pidPresent: true,
        parsedPid: 99,
        pidAlive: false,
        serverReachable: true,
      }),
    );
    expect(out).toEqual({ kind: "stale", stalePid: 99 });
  });
});

describe("summarizeMlxServerStatus — row 4: running (happy path)", () => {
  it("returns running + pid + url when PID is alive AND server reachable", () => {
    expect(
      summarizeMlxServerStatus(
        input({
          pidPresent: true,
          parsedPid: 4242,
          pidAlive: true,
          serverReachable: true,
        }),
      ),
    ).toEqual({ kind: "running", pid: 4242, url: URL });
  });

  it("threads the supplied serverUrl through verbatim", () => {
    const out = summarizeMlxServerStatus(
      input({
        pidPresent: true,
        parsedPid: 1,
        pidAlive: true,
        serverReachable: true,
        serverUrl: "http://localhost:9999/v1/models",
      }),
    );
    expect(out).toEqual({
      kind: "running",
      pid: 1,
      url: "http://localhost:9999/v1/models",
    });
  });
});

describe("summarizeMlxServerStatus — row 5: unhealthy (alive but unreachable)", () => {
  it("returns unhealthy + pid + url when PID is alive but server NOT reachable", () => {
    // Either mid-load (server warming up) or an unrelated process owns
    // the PID. Either way, the operator's recovery is to wait or run
    // `stop-mlx-server && start-mlx-server`. Distinct from `running` so
    // monitoring scripts can alarm on it.
    expect(
      summarizeMlxServerStatus(
        input({
          pidPresent: true,
          parsedPid: 7777,
          pidAlive: true,
          serverReachable: false,
        }),
      ),
    ).toEqual({ kind: "unhealthy", pid: 7777, url: URL });
  });

  it("does NOT collapse to running just because PID is alive", () => {
    const out = summarizeMlxServerStatus(
      input({
        pidPresent: true,
        parsedPid: 7777,
        pidAlive: true,
        serverReachable: false,
      }),
    );
    expect(out.kind).toBe("unhealthy");
    expect(out.kind).not.toBe("running");
  });
});

describe("summarizeMlxServerStatus — purity", () => {
  it("returns the same output for the same input (idempotent)", () => {
    const sameInput = input({
      pidPresent: true,
      parsedPid: 100,
      pidAlive: true,
      serverReachable: true,
    });
    expect(summarizeMlxServerStatus(sameInput)).toEqual(summarizeMlxServerStatus(sameInput));
  });

  it("never throws for any reasonable input shape", () => {
    const shapes: Partial<StatusInput>[] = [
      {},
      { pidPresent: true },
      { pidPresent: true, parsedPid: 1 },
      { pidPresent: true, parsedPid: 1, pidAlive: true },
      { pidPresent: true, parsedPid: 1, pidAlive: true, serverReachable: true },
    ];
    for (const s of shapes) {
      expect(() => summarizeMlxServerStatus(input(s))).not.toThrow();
    }
  });
});

// Slice 16: paired tests for `renderMlxServerStatusJson`. Each variant
// of {@link MlxServerStatus} must produce stable JSON the operator's
// monitoring scripts can dispatch on via `jq -e '.kind == "X"'` instead
// of regex-parsing the slice-14 prose.
describe("renderMlxServerStatusJson — round-trip per variant", () => {
  it("running → kind + pid + url", () => {
    const out = renderMlxServerStatusJson({ kind: "running", pid: 4321, url: URL });
    expect(JSON.parse(out)).toEqual({ kind: "running", pid: 4321, url: URL });
  });

  it("unhealthy → kind + pid + url", () => {
    const out = renderMlxServerStatusJson({ kind: "unhealthy", pid: 5555, url: URL });
    expect(JSON.parse(out)).toEqual({ kind: "unhealthy", pid: 5555, url: URL });
  });

  it("stale → kind + stalePid (NOT pid)", () => {
    const out = renderMlxServerStatusJson({ kind: "stale", stalePid: 9999 });
    const parsed = JSON.parse(out);
    expect(parsed).toEqual({ kind: "stale", stalePid: 9999 });
    expect(parsed.pid).toBeUndefined();
  });

  it("not-running → kind only", () => {
    const out = renderMlxServerStatusJson({ kind: "not-running" });
    expect(JSON.parse(out)).toEqual({ kind: "not-running" });
  });

  it("invalid-pid-file → kind only", () => {
    const out = renderMlxServerStatusJson({ kind: "invalid-pid-file" });
    expect(JSON.parse(out)).toEqual({ kind: "invalid-pid-file" });
  });

  it("emits a single line (no embedded newlines) so it streams cleanly through jq", () => {
    const samples: MlxServerStatus[] = [
      { kind: "running", pid: 1, url: URL },
      { kind: "unhealthy", pid: 2, url: URL },
      { kind: "stale", stalePid: 3 },
      { kind: "not-running" },
      { kind: "invalid-pid-file" },
    ];
    for (const s of samples) {
      const out = renderMlxServerStatusJson(s);
      expect(out.includes("\n")).toBe(false);
    }
  });

  it("places `kind` first so grep-on-kind still works without jq", () => {
    // Stable key order: `kind` always leads; downstream tooling that
    // uses `head -c` or simple regex against the line gets the
    // discriminator before any variant fields.
    const out = renderMlxServerStatusJson({ kind: "running", pid: 1, url: URL });
    expect(out.startsWith('{"kind":"running"')).toBe(true);
  });
});

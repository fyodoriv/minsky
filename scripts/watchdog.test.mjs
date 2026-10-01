import { describe, expect, it } from "vitest";

import { extractPidsFromEvidence } from "./kill-stuck-iterations.mjs";
import { watchdogTick } from "./watchdog.mjs";

describe("extractPidsFromEvidence", () => {
  it("extracts a single pid", () => {
    expect(extractPidsFromEvidence("pid=1234 etime=2h0m0s (>1800s)")).toEqual([1234]);
  });

  it("extracts multiple pids separated by semicolons", () => {
    const evidence = "pid=1001 etime=31m40s (>1800s); pid=1003 etime=1h0m0s (>1800s)";
    expect(extractPidsFromEvidence(evidence)).toEqual([1001, 1003]);
  });

  it("returns empty for evidence without pids", () => {
    expect(extractPidsFromEvidence("no pids here")).toEqual([]);
  });

  it("ignores malformed pid=0", () => {
    expect(extractPidsFromEvidence("pid=0 etime=2h0m0s")).toEqual([]);
  });
});

describe("watchdogTick", () => {
  it("returns zero kills when no spawn is stuck", async () => {
    const listClaudePrintSpawns = async () => [{ pid: 100, etimeSeconds: 60, ppid: 1 }];
    /** @type {{ pid: number, ok: boolean }[]} */
    const calls = [];
    /** @type {(pid: number) => Promise<{ ok: boolean, reason?: string }>} */
    const killPid = async (pid) => {
      calls.push({ pid, ok: true });
      return { ok: true };
    };
    const result = await watchdogTick({ listClaudePrintSpawns, killPid, thresholdSeconds: 1800 });
    expect(result).toEqual({ checked: 0, killed: 0, failed: 0 });
    expect(calls).toEqual([]);
  });

  it("kills exactly the stuck spawns and emits span-shaped log lines", async () => {
    const listClaudePrintSpawns = async () => [
      { pid: 100, etimeSeconds: 60, ppid: 1 },
      { pid: 101, etimeSeconds: 7200, ppid: 1 },
      { pid: 102, etimeSeconds: 1900, ppid: 1 },
    ];
    /** @type {number[]} */
    const killed = [];
    /** @type {(pid: number) => Promise<{ ok: boolean, reason?: string }>} */
    const killPid = async (pid) => {
      killed.push(pid);
      return { ok: true };
    };
    /** @type {string[]} */
    const lines = [];
    /** @type {(line: string) => void} */
    const log = (line) => {
      lines.push(line);
    };
    const result = await watchdogTick({
      listClaudePrintSpawns,
      killPid,
      log,
      thresholdSeconds: 1800,
    });
    expect(result).toEqual({ checked: 2, killed: 2, failed: 0 });
    expect(killed.sort()).toEqual([101, 102]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("watchdog.kill");
    expect(lines[0]).toContain('"pid":101');
    expect(lines[0]).toContain("daemon-iteration-runtime-exceeded");
    expect(lines[1]).toContain('"pid":102');
  });

  it("counts a kill failure as `failed` and emits kill-failed span", async () => {
    const listClaudePrintSpawns = async () => [{ pid: 999, etimeSeconds: 7200, ppid: 1 }];
    const killPid = async () => ({ ok: false, reason: "no such process" });
    /** @type {string[]} */
    const lines = [];
    const result = await watchdogTick({
      listClaudePrintSpawns,
      killPid,
      log: (line) => lines.push(line),
      thresholdSeconds: 1800,
    });
    expect(result).toEqual({ checked: 1, killed: 0, failed: 1 });
    expect(lines[0]).toContain("watchdog.kill-failed");
    expect(lines[0]).toContain("no such process");
  });
});

import { describe, expect, it } from "vitest";

import { parseMinskyProcs } from "./scan.js";

describe("parseMinskyProcs", () => {
  it("classifies worker / orchestrator / merge-gate by command", () => {
    const raw = [
      "12345 node /x/novel/tick-loop/bin/tick-loop.mjs --repo /Users/a/apps/minsky --model sonnet",
      "678 node /x/scripts/orchestrate.mjs --run-id abc123 --host /Users/a/apps/foo/",
      "90 bash /x/distribution/local-gate-merge.sh --repo /srv/bar",
    ].join("\n");
    const procs = parseMinskyProcs(raw);
    expect(procs).toHaveLength(3);
    expect(procs[0]).toMatchObject({
      pid: 90,
      role: "merge-gate",
      repo: "bar",
      runId: "pid:90",
      model: "—",
    });
    expect(procs[1]).toMatchObject({
      pid: 678,
      role: "orchestrator",
      repo: "foo",
      runId: "abc123",
    });
    expect(procs[2]).toMatchObject({ pid: 12345, role: "worker", repo: "minsky", model: "sonnet" });
  });

  it("sorts by pid ascending for stable selection ordering", () => {
    const raw = [
      "300 node tick-loop.mjs --repo /a",
      "100 node orchestrate.mjs --repo /b",
      "200 node tick-loop.mjs --repo /c",
    ].join("\n");
    expect(parseMinskyProcs(raw).map((p) => p.pid)).toEqual([100, 200, 300]);
  });

  it("falls back to --run and basename-strips trailing slashes", () => {
    const procs = parseMinskyProcs("5 node tick-loop.mjs --run xyz --hosts-dir /Users/a/apps/");
    expect(procs[0]).toMatchObject({ runId: "xyz", repo: "apps" });
  });

  it("treats a flag with no value as absent (next token is a flag)", () => {
    const procs = parseMinskyProcs("7 node tick-loop.mjs --repo --model");
    expect(procs[0]).toMatchObject({ repo: "unknown", model: "—" });
  });

  it("skips blank, separator-less, bad-pid, and non-minsky lines", () => {
    const raw = [
      "",
      "   ",
      "noseparator",
      "abc node tick-loop.mjs --repo /a",
      "-4 node tick-loop.mjs --repo /a",
      "999 grep -fal tick-loop.mjs|orchestrate.mjs",
      "888 node /x/scripts/other-thing.mjs --repo /a",
    ].join("\n");
    expect(parseMinskyProcs(raw)).toHaveLength(0);
  });

  it("drops the scan tooling itself (grep/pgrep/rg/ps) as noise", () => {
    const raw = [
      "11 pgrep -fal scripts/orchestrate.mjs|tick-loop.mjs|local-gate-merge",
      "12 /usr/bin/grep -E tick-loop.mjs",
      "13 rg --no-config orchestrate.mjs",
      "14 ps aux local-gate-merge",
      "15 node tick-loop.mjs --repo /real",
    ].join("\n");
    const procs = parseMinskyProcs(raw);
    expect(procs).toHaveLength(1);
    expect(procs[0]).toMatchObject({ pid: 15, role: "worker", repo: "real" });
  });

  it("retains the raw command for the detail screen", () => {
    const cmd = "node /x/novel/tick-loop/bin/tick-loop.mjs --repo /a --model opus";
    const procs = parseMinskyProcs(`42 ${cmd}`);
    expect(procs[0]?.command).toBe(cmd);
  });

  it("returns an empty list for empty input", () => {
    expect(parseMinskyProcs("")).toEqual([]);
  });
});

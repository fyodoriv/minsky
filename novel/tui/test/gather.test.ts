import { describe, expect, it } from "vitest";
import {
  type LogDirProbe,
  type MachineProbe,
  formatMachineInfo,
  gatherMachineRaw,
  listLogFiles,
} from "../src/index.js";

const GIB = 1024 ** 3;

const machineProbe: MachineProbe = {
  hostname: () => "op-mbp",
  loadavg: () => [2.1, 1.8, 1.55],
  cpuCount: () => 8,
  totalmem: () => 16 * GIB,
  freemem: () => 6.5 * GIB,
  disk: () => ({ totalBytes: 930 * GIB, freeBytes: 518 * GIB }),
  nowMs: () => Date.UTC(2026, 4, 17, 12, 0, 0),
};

describe("gatherMachineRaw", () => {
  it("composes the probe into a MachineRaw the formatter accepts", () => {
    const raw = gatherMachineRaw(3, machineProbe, "/srv/minsky");
    expect(raw).toEqual({
      host: "op-mbp",
      loadavg: [2.1, 1.8, 1.55],
      cpuCount: 8,
      totalMemBytes: 16 * GIB,
      freeMemBytes: 6.5 * GIB,
      diskTotalBytes: 930 * GIB,
      diskFreeBytes: 518 * GIB,
      nowMs: Date.UTC(2026, 4, 17, 12, 0, 0),
      minskyProcCount: 3,
    });
    // The shim's output must satisfy the slice-1 formatter unchanged.
    expect(formatMachineInfo(raw).procs).toBe("3 minsky procs");
  });

  it("threads the caller's scan count, not a re-scan (rule #1)", () => {
    expect(gatherMachineRaw(0, machineProbe).minskyProcCount).toBe(0);
    expect(gatherMachineRaw(7, machineProbe).minskyProcCount).toBe(7);
  });

  it("queries the disk volume the runs live on", () => {
    let asked = "";
    const probe: MachineProbe = {
      ...machineProbe,
      disk: (p) => {
        asked = p;
        return { totalBytes: 0, freeBytes: 0 };
      },
    };
    gatherMachineRaw(1, probe, "/repos/minsky");
    expect(asked).toBe("/repos/minsky");
  });
});

describe("listLogFiles", () => {
  const probe: LogDirProbe = {
    readdir: () => ["tick-loop.log", "README.md", "gate.log", "orchestrate.log"],
    size: (p) => (p.endsWith("gate.log") ? 2048 : 100),
  };

  it("keeps only *.log entries, name-sorted, with sizes", () => {
    expect(listLogFiles("/r/.minsky", probe)).toEqual([
      { name: "gate.log", sizeBytes: 2048 },
      { name: "orchestrate.log", sizeBytes: 100 },
      { name: "tick-loop.log", sizeBytes: 100 },
    ]);
  });

  it("degrades a missing dir to [] (rule #6/#7 — renderer shows the notice)", () => {
    expect(listLogFiles("/nope", { readdir: () => [], size: () => -1 })).toEqual([]);
  });

  it("keeps an un-stat-able file's size as -1 (rule #7 — row renders ?)", () => {
    const r = listLogFiles("/r/.minsky", { readdir: () => ["a.log"], size: () => -1 });
    expect(r).toEqual([{ name: "a.log", sizeBytes: -1 }]);
  });
});

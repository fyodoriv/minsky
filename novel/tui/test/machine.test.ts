import { describe, expect, it } from "vitest";
import { type MachineRaw, formatMachineInfo } from "../src/index.js";

const GIB = 1024 ** 3;

const base: MachineRaw = {
  host: "op-mbp",
  loadavg: [2.1, 1.8, 1.55],
  cpuCount: 8,
  totalMemBytes: 16 * GIB,
  freeMemBytes: 6.5 * GIB,
  diskTotalBytes: 930 * GIB,
  diskFreeBytes: 518 * GIB,
  nowMs: Date.UTC(2026, 4, 17, 12, 0, 0),
  minskyProcCount: 3,
};

describe("formatMachineInfo", () => {
  it("formats every panel field at fixed precision", () => {
    expect(formatMachineInfo(base)).toEqual({
      host: "op-mbp",
      load: "2.10 1.80 1.55",
      cpu: "8 cores",
      mem: "9.5/16.0 GiB (59%)",
      disk: "412.0/930.0 GiB (44%)",
      time: "2026-05-17T12:00:00.000Z",
      procs: "3 minsky procs",
    });
  });

  it("singularises core / proc counts", () => {
    const r = formatMachineInfo({ ...base, cpuCount: 1, minskyProcCount: 1 });
    expect(r.cpu).toBe("1 core");
    expect(r.procs).toBe("1 minsky proc");
  });

  it("degrades a zero total to 0% rather than NaN (rule #7)", () => {
    const r = formatMachineInfo({
      ...base,
      totalMemBytes: 0,
      freeMemBytes: 0,
      diskTotalBytes: 0,
      diskFreeBytes: 0,
    });
    expect(r.mem).toBe("0.0/0.0 GiB (0%)");
    expect(r.disk).toBe("0.0/0.0 GiB (0%)");
  });
});

import { describe, expect, it } from "vitest";

import { type RawMachineReadings, formatMachineInfo } from "./machine.js";

const base: RawMachineReadings = {
  host: "build-01",
  loadAvg: [0.5, 1.2, 2.04],
  cpuCount: 8,
  totalMemBytes: 16 * 1024 ** 3,
  freeMemBytes: 4 * 1024 ** 3,
  diskTotalBytes: 460 * 1024 ** 3,
  diskFreeBytes: 340 * 1024 ** 3,
  nowMs: Date.UTC(2026, 4, 17, 14, 30, 5),
  procCount: 3,
};

describe("formatMachineInfo", () => {
  it("formats the nominal reading set", () => {
    expect(formatMachineInfo(base)).toEqual({
      host: "build-01",
      load: "0.50 1.20 2.04",
      cpu: "8 cores",
      mem: "12.0G / 16.0G (75%)",
      disk: "120.0G / 460.0G (26%)",
      time: "2026-05-17 14:30:05 UTC",
      procs: "3 minsky procs",
    });
  });

  it("singularises 1 core / 1 proc", () => {
    const info = formatMachineInfo({ ...base, cpuCount: 1, procCount: 1 });
    expect(info.cpu).toBe("1 core");
    expect(info.procs).toBe("1 minsky proc");
  });

  it("degrades blank host, bad counts, and skewed free>total", () => {
    const info = formatMachineInfo({
      ...base,
      host: "",
      cpuCount: 0,
      procCount: -2,
      totalMemBytes: 8 * 1024 ** 3,
      freeMemBytes: 99 * 1024 ** 3,
    });
    expect(info.host).toBe("unknown");
    expect(info.cpu).toBe("0 cores");
    expect(info.procs).toBe("0 minsky procs");
    expect(info.mem).toBe("0B / 8.0G (0%)");
  });

  it("renders ? for non-finite load components", () => {
    const info = formatMachineInfo({
      ...base,
      loadAvg: [Number.NaN, -1, Number.POSITIVE_INFINITY],
    });
    expect(info.load).toBe("? ? ?");
  });

  it("handles a zero-total disk without dividing by zero", () => {
    const info = formatMachineInfo({ ...base, diskTotalBytes: 0, diskFreeBytes: 0 });
    expect(info.disk).toBe("0B / 0B (0%)");
  });

  it("falls back to the epoch for a non-finite clock", () => {
    const info = formatMachineInfo({ ...base, nowMs: Number.NaN });
    expect(info.time).toBe("1970-01-01 00:00:00 UTC");
  });
});

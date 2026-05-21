import { describe, expect, it } from "vitest";

import * as tui from "./index.js";

describe("@minsky/tui public surface", () => {
  it("re-exports the pure seam (slice 1) and nothing I/O-bound", () => {
    expect(Object.keys(tui).sort()).toEqual([
      "WIDTH",
      "cell",
      "defaultLogDirProbe",
      "defaultMachineProbe",
      "formatDuration",
      "formatLogRow",
      "formatMachineInfo",
      "gatherMachineRaw",
      "humanBytes",
      "listLogFiles",
      "parseMinskyProcs",
      "renderDashboard",
      "renderDetail",
      "repoBasename",
    ]);
    expect(typeof tui.parseMinskyProcs).toBe("function");
    expect(typeof tui.formatMachineInfo).toBe("function");
    expect(typeof tui.renderDashboard).toBe("function");
    expect(tui.WIDTH).toBe(80);
  });
});

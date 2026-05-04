import { describe, expect, it } from "vitest";

import {
  OMC_SYNC_HEADING,
  OMC_SYNC_MARKER,
  locateOmcSection,
  renderOmcSection,
  syncOmcToTasksMd,
} from "./sync.js";
import type { OmcTeamTask } from "./types.js";

const TASK_A: OmcTeamTask = {
  id: "task-a",
  subject: "Alpha",
  status: "in_progress",
  owner: "executor-a",
  created_at: "2026-05-04T00:00:00.000Z",
  version: 1,
};

const TASK_B: OmcTeamTask = {
  id: "task-b",
  subject: "Bravo",
  status: "completed",
  created_at: "2026-05-04T01:00:00.000Z",
  version: 2,
};

describe("syncOmcToTasksMd", () => {
  it("replace-section is idempotent — re-running yields byte-equal output", () => {
    const existing = "# TASKS\n\n## P0\n\n- [ ] Existing\n  - **ID**: existing-1\n";
    const once = syncOmcToTasksMd({
      omcTasks: [TASK_A, TASK_B],
      existingTasksMd: existing,
      mode: "replace-section",
    });
    const twice = syncOmcToTasksMd({
      omcTasks: [TASK_A, TASK_B],
      existingTasksMd: once,
      mode: "replace-section",
    });
    expect(twice).toBe(once);
    expect(once).toContain(OMC_SYNC_HEADING);
    expect(once).toContain(OMC_SYNC_MARKER);
    expect(once).toContain("  - **ID**: task-a");
    expect(once).toContain("  - **ID**: task-b");
  });

  it("preserves existing non-OMC sections verbatim", () => {
    const existing =
      "# TASKS\n\n## P0\n\n- [ ] Pre-existing top task\n  - **ID**: top-1\n\n## P1\n\n- [ ] Another\n  - **ID**: top-2\n";
    const out = syncOmcToTasksMd({
      omcTasks: [TASK_A],
      existingTasksMd: existing,
      mode: "replace-section",
    });
    expect(out).toContain("- [ ] Pre-existing top task\n  - **ID**: top-1");
    expect(out).toContain("- [ ] Another\n  - **ID**: top-2");
    expect(out).toContain("  - **ID**: task-a");
  });

  it("emits an empty section (heading + marker only) for an empty OMC list", () => {
    const out = syncOmcToTasksMd({
      omcTasks: [],
      existingTasksMd: "",
      mode: "replace-section",
    });
    expect(out).toContain(OMC_SYNC_HEADING);
    expect(out).toContain(OMC_SYNC_MARKER);
    expect(out).not.toContain("- [ ] ");
    expect(out).not.toContain("- [x] ");
  });

  it("replaces an existing OMC Sync section in place (does not duplicate it)", () => {
    const stale = `# TASKS\n\n${OMC_SYNC_HEADING}\n\n${OMC_SYNC_MARKER}\n\n- [ ] STALE\n  - **ID**: stale\n`;
    const out = syncOmcToTasksMd({
      omcTasks: [TASK_A],
      existingTasksMd: stale,
      mode: "replace-section",
    });
    const heads = out.split(OMC_SYNC_HEADING).length - 1;
    expect(heads).toBe(1);
    expect(out).not.toContain("- [ ] STALE");
    expect(out).toContain("  - **ID**: task-a");
  });

  it("merge-by-id mode is reserved for v1+ and throws", () => {
    expect(() =>
      syncOmcToTasksMd({
        omcTasks: [TASK_A],
        existingTasksMd: "",
        mode: "merge-by-id",
      }),
    ).toThrow(/v1\+/);
  });
});

describe("locateOmcSection / renderOmcSection (helpers)", () => {
  it("locateOmcSection returns null when the heading is absent", () => {
    expect(locateOmcSection("# TASKS\n\n## P0\n\n- [ ] foo\n")).toBeNull();
  });

  it("renderOmcSection emits a trailing newline so the file ends cleanly", () => {
    expect(renderOmcSection([]).endsWith("\n")).toBe(true);
    expect(renderOmcSection([TASK_A]).endsWith("\n")).toBe(true);
  });
});

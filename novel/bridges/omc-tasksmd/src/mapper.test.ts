import { describe, expect, it } from "vitest";

import { mapOmcToTasksMd } from "./mapper.js";
import type { OmcTeamTask } from "./types.js";

describe("mapOmcToTasksMd", () => {
  it("renders a minimum-fields task with empty optionals", () => {
    const task: OmcTeamTask = {
      id: "min-001",
      subject: "Minimal task",
      status: "pending",
      created_at: "2026-05-04T00:00:00.000Z",
    };
    const md = mapOmcToTasksMd(task);
    expect(md).toBe(
      [
        "- [ ] Minimal task",
        "  - **ID**: min-001",
        "  - **OMC-Owner**: ",
        "  - **Status**: pending",
        "  - **Created-at**: 2026-05-04T00:00:00.000Z",
        "  - **Description**: ",
        "  - **Blocked by**: ",
        "  - **OMC-Version**: ",
      ].join("\n"),
    );
  });

  it("renders a full task: claim-owner fallback + version + blocked_by joined", () => {
    const task: OmcTeamTask = {
      id: "full-001",
      subject: "Full task",
      description: "A fully-populated record.",
      status: "in_progress",
      blocks: [],
      blocked_by: ["task-x", "task-y"],
      created_at: "2026-05-04T01:00:00.000Z",
      version: 7,
      claim: {
        owner: "executor-a",
        token: "tk-bbbb-2222",
        leased_until: "2026-05-04T01:30:00.000Z",
      },
    };
    const md = mapOmcToTasksMd(task);
    expect(md).toContain("- [ ] Full task");
    expect(md).toContain("  - **OMC-Owner**: executor-a");
    expect(md).toContain("  - **Blocked by**: task-x, task-y");
    expect(md).toContain("  - **OMC-Version**: 7");
    expect(md).toContain("  - **Description**: A fully-populated record.");
  });

  it("renders status='completed' with the [x] checkbox", () => {
    const task: OmcTeamTask = {
      id: "done-001",
      subject: "Already done",
      status: "completed",
      created_at: "2026-05-04T02:00:00.000Z",
      completed_at: "2026-05-04T03:00:00.000Z",
    };
    const md = mapOmcToTasksMd(task);
    expect(md.startsWith("- [x] Already done")).toBe(true);
    expect(md).toContain("  - **Status**: completed");
  });

  it("explicit `owner` wins over `claim.owner` (lossy projection note)", () => {
    const task: OmcTeamTask = {
      id: "own-001",
      subject: "Owner precedence",
      status: "in_progress",
      owner: "explicit-owner",
      claim: {
        owner: "claim-owner",
        token: "tk-cccc-3333",
        leased_until: "2026-05-04T04:30:00.000Z",
      },
      created_at: "2026-05-04T04:00:00.000Z",
    };
    const md = mapOmcToTasksMd(task);
    expect(md).toContain("  - **OMC-Owner**: explicit-owner");
    expect(md).not.toContain("  - **OMC-Owner**: claim-owner");
  });

  it("re-mapping the same task yields byte-equal output (idempotent / referentially transparent)", () => {
    const task: OmcTeamTask = {
      id: "idem-001",
      subject: "Idempotent map",
      description: "Same input, same output.",
      status: "blocked",
      owner: "executor-b",
      blocked_by: ["task-z"],
      created_at: "2026-05-04T05:00:00.000Z",
      version: 1,
      metadata: { tags: ["governance"] },
    };
    expect(mapOmcToTasksMd(task)).toBe(mapOmcToTasksMd(task));
  });
});

// @ts-check
import { describe, expect, it } from "vitest";
import { checkUiTasksPriority } from "./check-ui-tasks-priority.mjs";

/**
 * @param {string} body
 */
function withTasksMd(body) {
  return { tasksMdContent: body };
}

describe("checkUiTasksPriority", () => {
  it("flags a P2 task with the `cli` tag", () => {
    const result = checkUiTasksPriority(
      withTasksMd(
        [
          "## P0",
          "## P1",
          "## P2",
          "",
          "- [ ] `do-something-ui` — a UI thing",
          "  - **ID**: do-something-ui",
          "  - **Tags**: p2, cli, ux",
          "",
        ].join("\n"),
      ),
    );
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toMatch(/do-something-ui/);
    expect(result.violations[0]).toMatch(/in P2/);
  });

  it("flags a P3 task with the `dashboard` tag", () => {
    const result = checkUiTasksPriority(
      withTasksMd(
        [
          "## P0",
          "## P3",
          "",
          "- [ ] `widget-thing` — UI",
          "  - **ID**: widget-thing",
          "  - **Tags**: p3, dashboard, ui",
          "",
        ].join("\n"),
      ),
    );
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toMatch(/widget-thing/);
  });

  it("passes a P2 task with deferral opt-out", () => {
    const result = checkUiTasksPriority(
      withTasksMd(
        [
          "## P2",
          "",
          "- [ ] `legitimately-deferred` — UI",
          "  - **ID**: legitimately-deferred",
          "  - **Tags**: p2, ui",
          "  - **Deferred-because**: legitimate reason given",
          "",
        ].join("\n"),
      ),
    );
    expect(result.ok).toBe(true);
  });

  it("doesn't flag UI tasks at P0/P1 (operator directive is satisfied)", () => {
    const result = checkUiTasksPriority(
      withTasksMd(
        [
          "## P0",
          "",
          "- [ ] `proper-ui-task` — UI",
          "  - **ID**: proper-ui-task",
          "  - **Tags**: p0, cli, ui",
          "",
          "## P1",
          "",
          "- [ ] `another-ui` — UI",
          "  - **ID**: another-ui",
          "  - **Tags**: p1, dashboard",
          "",
        ].join("\n"),
      ),
    );
    expect(result.ok).toBe(true);
  });

  it("detects UI keywords in the task title (not just tags)", () => {
    const result = checkUiTasksPriority(
      withTasksMd(
        [
          "## P3",
          "",
          "- [ ] `keyword-trigger` — fix `bin/minsky doctor` exit codes",
          "  - **ID**: keyword-trigger",
          "  - **Tags**: p3, scout-finding",
          "",
        ].join("\n"),
      ),
    );
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toMatch(/keyword-trigger/);
  });

  it("flags task with `pnpm minsky:logs` in title", () => {
    const result = checkUiTasksPriority(
      withTasksMd(
        [
          "## P2",
          "",
          "- [ ] `improve-logs` — make `pnpm minsky:logs` follow tail format",
          "  - **ID**: improve-logs",
          "  - **Tags**: p2",
          "",
        ].join("\n"),
      ),
    );
    expect(result.ok).toBe(false);
  });

  it("scans 0 tasks when no P2/P3 sections exist", () => {
    const result = checkUiTasksPriority(withTasksMd("## P0\n\n## P1\n\n"));
    expect(result.ok).toBe(true);
    expect(result.scannedCount).toBe(0);
  });

  it("real production TASKS.md passes (smoke after backfill)", () => {
    const result = checkUiTasksPriority();
    expect(result.ok).toBe(true);
  });
});

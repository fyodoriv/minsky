// Paired tests for `check-cloud-audit-gate.mjs`. Pattern: deterministic gate
// (rule #10) over (changedFiles, TASKS.md), pure-function decision table.
// Tests follow the standard positive / negative fixture shape (Meszaros 2007).

import { describe, expect, test } from "vitest";

import {
  BLOCKED_TOKEN,
  CLOUD_TIER_PATH_PREFIXES,
  TASK_ID,
  checkCloudAuditGate,
  extractBlockedLine,
} from "./check-cloud-audit-gate.mjs";

/**
 * @param {{ id?: string, blocked?: string | null }} args
 * @returns {string}
 */
function fixtureTasksMd({ id = TASK_ID, blocked = `${BLOCKED_TOKEN} — operator action` } = {}) {
  const lines = [
    "# Tasks",
    "",
    "## P0",
    "",
    "- [ ] `t` — title",
    `  - **ID**: ${id}`,
    "  - **Tags**: p0",
  ];
  if (blocked !== null) lines.push(`  - **Blocked**: ${blocked}`);
  lines.push("  - **Hypothesis**: H", "");
  return lines.join("\n");
}

describe("checkCloudAuditGate", () => {
  test("passes when no cloud-tier path is touched (gate dormant)", () => {
    const r = checkCloudAuditGate({
      changedFiles: [
        { status: "M", path: "novel/tick-loop/src/daemon.ts" },
        { status: "A", path: "scripts/check-cloud-audit-gate.mjs" },
      ],
      tasksMd: fixtureTasksMd(),
    });
    expect(r.ok).toBe(true);
  });

  test("fires when a cloud-tier path is touched and the block line still names the token", () => {
    const r = checkCloudAuditGate({
      changedFiles: [{ status: "A", path: "novel/cloud-supervisor/src/index.ts" }],
      tasksMd: fixtureTasksMd(),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain("novel/cloud-supervisor/src/index.ts");
    expect(r.errors[0]).toContain(TASK_ID);
    expect(r.errors[0]).toContain(BLOCKED_TOKEN);
  });

  test("passes when the block line has been removed (operator unblocked)", () => {
    const r = checkCloudAuditGate({
      changedFiles: [{ status: "A", path: "novel/cloud-supervisor/src/index.ts" }],
      tasksMd: fixtureTasksMd({ blocked: null }),
    });
    expect(r.ok).toBe(true);
  });

  test("passes when the block line is present but its value no longer contains the gating token", () => {
    const r = checkCloudAuditGate({
      changedFiles: [{ status: "A", path: "novel/cloud-supervisor/src/index.ts" }],
      tasksMd: fixtureTasksMd({ blocked: "audit-cleared (Trail of Bits 2026-09-01)" }),
    });
    expect(r.ok).toBe(true);
  });

  test("fires for every cloud-tier package independently", () => {
    const changedFiles = CLOUD_TIER_PATH_PREFIXES.map((p) => ({
      status: "A",
      path: `${p}src/index.ts`,
    }));
    const r = checkCloudAuditGate({ changedFiles, tasksMd: fixtureTasksMd() });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors).toHaveLength(CLOUD_TIER_PATH_PREFIXES.length);
    for (const pre of CLOUD_TIER_PATH_PREFIXES) {
      expect(r.errors.some((e) => e.includes(pre))).toBe(true);
    }
  });

  test("ignores deletions under cloud-tier prefixes (status === 'D')", () => {
    const r = checkCloudAuditGate({
      changedFiles: [{ status: "D", path: "novel/cloud-supervisor/src/legacy.ts" }],
      tasksMd: fixtureTasksMd(),
    });
    expect(r.ok).toBe(true);
  });

  test("ignores paths that are prefix-similar but outside the gated set", () => {
    const r = checkCloudAuditGate({
      changedFiles: [
        { status: "A", path: "novel/cloud-supervisor-NEXT/src/index.ts" },
        { status: "A", path: "novel/cross-repo-runner/src/index.ts" }, // existing pkg, NOT cross-repo-benchmark
      ],
      tasksMd: fixtureTasksMd(),
    });
    expect(r.ok).toBe(true);
  });

  test("passes when the cloud-tier task block is absent from TASKS.md (block line cannot be read)", () => {
    const r = checkCloudAuditGate({
      changedFiles: [{ status: "A", path: "novel/cloud-supervisor/src/index.ts" }],
      tasksMd: fixtureTasksMd({ id: "some-other-task" }),
    });
    expect(r.ok).toBe(true);
  });
});

describe("extractBlockedLine", () => {
  test("returns the block-line value verbatim when present in the cloud-tier block", () => {
    const v = extractBlockedLine(
      fixtureTasksMd({ blocked: `${BLOCKED_TOKEN} — engaging the audit firm` }),
    );
    expect(v).toBe(`${BLOCKED_TOKEN} — engaging the audit firm`);
  });

  test("returns null when the cloud-tier block has no `**Blocked**:` line", () => {
    expect(extractBlockedLine(fixtureTasksMd({ blocked: null }))).toBeNull();
  });

  test("returns null when the cloud-tier task block is absent", () => {
    expect(extractBlockedLine(fixtureTasksMd({ id: "some-other-task" }))).toBeNull();
  });

  test("does not confuse another task's `**Blocked**:` line with the cloud-tier one", () => {
    const text = [
      "## P0",
      "",
      "- [ ] `other` — different task",
      "  - **ID**: other-task",
      "  - **Blocked**: needs-user-approval — different reason",
      "",
      "- [ ] `t` — cloud audit",
      `  - **ID**: ${TASK_ID}`,
      "  - **Hypothesis**: H",
      "",
    ].join("\n");
    expect(extractBlockedLine(text)).toBeNull();
  });
});

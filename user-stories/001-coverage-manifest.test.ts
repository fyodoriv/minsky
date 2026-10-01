/**
 * User-story 001 — Coverage manifest (sub-task 1/3 of `first-integration-test`).
 *
 * Inventory test that maps each of user-story 001's 12 chaos-table rows
 * (`user-stories/001-loop-runs-overnight.md` § "Failure modes & chaos
 * verification") to either an EXISTING repo test (`status: 'covered'`),
 * a deferred-to-self-hosted-runner row (`status: 'self-hosted'`), or a
 * cross-repo deferred (`status: 'deferred'`).
 *
 * This is NOT an OS-level chaos test — it runs in <1 s on any CI runner.
 * Per the parent `first-integration-test` task's documented Pivot
 * ("reframe as a pair: 10-min smoke in CI + nightly self-hosted"), both
 * `covered` and `self-hosted` count toward the brief's "≥80 % coverage of
 * failure-mode rows" Acceptance.
 *
 * Pattern: chaos-coverage manifest test. Anchors: Basiri et al.,
 * "Principles of Chaos Engineering", *IEEE Software* 2016 (steady-state
 * hypothesis + coverage as the precondition for fault-injection); Beck,
 * *Extreme Programming Explained*, 1999, Ch. 17 (CI as the constraint
 * enforcer — the manifest's existence is mechanically asserted).
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

type CoverageStatus = "covered" | "self-hosted" | "deferred";

interface CoverageEntry {
  readonly row: number;
  readonly description: string;
  readonly status: CoverageStatus;
  /**
   * Path (relative to repo root) of the existing test file that covers this
   * row. Required for `covered`, omitted for `self-hosted` / `deferred`.
   */
  readonly file?: string;
  /**
   * Regex pattern (case-insensitive) the named test file must contain at
   * least once. Acts as a thin semantic check that the cited file is
   * actually about the failure mode declared in this row. Required for
   * `covered`.
   */
  readonly testNamePattern?: RegExp;
  /**
   * For `self-hosted` rows: the TASKS.md sub-task id that, when shipped,
   * will cover this row via the nightly self-hosted runner.
   */
  readonly selfHostedTaskId?: string;
  /**
   * For `deferred` rows: a free-form note explaining the deferral
   * (e.g., cross-repo dependency).
   */
  readonly deferredReason?: string;
}

/**
 * Hand-curated manifest based on the existing-tests inventory at the time
 * of decomposition (parent `first-integration-test` brief). Adding a new
 * row is a deliberate spec change — the parent user-story file's table is
 * the canonical source of truth.
 */
const COVERAGE_MANIFEST: readonly CoverageEntry[] = [
  {
    row: 1,
    description: "tick-loop process killed mid-tool-call (SIGKILL → supervisor respawn)",
    status: "covered",
    file: "distribution/test-supervisor.sh",
    testNamePattern: /SIGKILL.*tick-loop|failure-mode row 1/i,
  },
  {
    row: 2,
    description: "OMC subagent hangs forever (libfaketime clock advance)",
    status: "self-hosted",
    selfHostedTaskId: "first-integration-test-nightly-self-hosted",
  },
  {
    row: 3,
    description: "persona returns malformed handoff JSON (upstream-malformed)",
    status: "deferred",
    deferredReason:
      "M2 multi-persona path absorbed into OpenHands' native persona stack per " +
      "the 2026-05-22 wrap-feasibility reassessment; `novel/handoff-spec/` was " +
      "deleted in Phase 9 (path-a-phase-9-small-package-sweep-delete). The " +
      "upstream-malformed handling now belongs to OpenHands' boundary, not Minsky's.",
  },
  {
    row: 4,
    description: "tasks-mcp server dies between claim and complete (process death)",
    status: "covered",
    file: "distribution/test-supervisor.sh",
    testNamePattern: /budget-guard|row 4|circuit-break/i,
  },
  {
    row: 5,
    description: "network partition to api.anthropic.com (iptables DROP for 60s)",
    status: "self-hosted",
    selfHostedTaskId: "first-integration-test-nightly-self-hosted",
  },
  {
    row: 6,
    description: "slow API response 200ms → 60s (tc qdisc netem delay)",
    status: "self-hosted",
    selfHostedTaskId: "first-integration-test-nightly-self-hosted",
  },
  {
    row: 7,
    description: "disk fills (logs/traces) — dd zero-fill",
    status: "self-hosted",
    selfHostedTaskId: "first-integration-test-nightly-self-hosted",
  },
  {
    row: 8,
    description: "OS sleep / wake mid-tick (pmset / systemctl suspend)",
    status: "self-hosted",
    selfHostedTaskId: "first-integration-test-nightly-self-hosted",
  },
  {
    row: 9,
    description: "token budget exhausted mid-tick (TokenMonitor.remaining() === 0)",
    status: "covered",
    file: "novel/adapters/token-monitor/src/maciek.test.ts",
    testNamePattern: /zero|remaining|budget|plan-cap|cold-start/i,
  },
  {
    row: 10,
    description: "concurrent claim race (two agents pick same task — tasks-mcp lease)",
    status: "deferred",
    deferredReason:
      "tasks-mcp lease semantics live in a third-party repo; cross-repo coordination required.",
  },
  {
    row: 11,
    description: "OTEL collector unreachable (iptables DROP port 4317)",
    status: "self-hosted",
    selfHostedTaskId: "first-integration-test-nightly-self-hosted",
  },
  {
    row: 12,
    description: "clock skew (libfaketime +30 min before launch)",
    status: "self-hosted",
    selfHostedTaskId: "first-integration-test-nightly-self-hosted",
  },
];

describe("user-story 001 — coverage manifest", () => {
  it("declares exactly one entry per chaos-table row (12 rows)", () => {
    expect(COVERAGE_MANIFEST).toHaveLength(12);
    const rowNumbers = COVERAGE_MANIFEST.map((e) => e.row).sort((a, b) => a - b);
    expect(rowNumbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("each `covered` entry points to a real file containing a matching test name", () => {
    const covered = COVERAGE_MANIFEST.filter((e) => e.status === "covered");
    // Sanity: at least one row must be `covered` for the test to be meaningful.
    expect(covered.length).toBeGreaterThan(0);

    for (const entry of covered) {
      expect(entry.file, `row ${entry.row}: \`covered\` requires \`file\``).toBeDefined();
      expect(
        entry.testNamePattern,
        `row ${entry.row}: \`covered\` requires \`testNamePattern\``,
      ).toBeDefined();

      const filePath = resolve(REPO_ROOT, entry.file ?? "");
      expect(existsSync(filePath), `row ${entry.row}: ${entry.file} must exist`).toBe(true);

      const content = readFileSync(filePath, "utf8");
      expect(
        entry.testNamePattern?.test(content),
        `row ${entry.row}: ${entry.file} must contain a test matching ${entry.testNamePattern}`,
      ).toBe(true);
    }
  });

  it("≥80 % of rows are covered or deferred-to-self-hosted (parent task Pivot path)", () => {
    const total = COVERAGE_MANIFEST.length;
    const covered = COVERAGE_MANIFEST.filter((e) => e.status === "covered").length;
    const selfHosted = COVERAGE_MANIFEST.filter((e) => e.status === "self-hosted").length;
    const acceptable = covered + selfHosted;
    const ratio = acceptable / total;
    // Brief: "≥80 % coverage of failure-mode rows"; Pivot path counts both
    // `covered` (existing repo test) and `self-hosted` (deferred to nightly
    // sub-task 3) — see parent `first-integration-test` task's Pivot.
    expect(ratio).toBeGreaterThanOrEqual(0.8);
  });

  it("each `self-hosted` entry references a sub-task id that exists in TASKS.md", () => {
    const selfHosted = COVERAGE_MANIFEST.filter((e) => e.status === "self-hosted");
    expect(selfHosted.length).toBeGreaterThan(0);

    const tasksMd = readFileSync(resolve(REPO_ROOT, "TASKS.md"), "utf8");

    for (const entry of selfHosted) {
      expect(
        entry.selfHostedTaskId,
        `row ${entry.row}: \`self-hosted\` requires \`selfHostedTaskId\``,
      ).toBeDefined();
      const id = entry.selfHostedTaskId ?? "";
      // Match the canonical `**ID**: <id>` block-marker shape used throughout
      // TASKS.md — avoids false matches from prose mentions.
      const idLine = new RegExp(`\\*\\*ID\\*\\*:\\s*${id}\\b`);
      expect(
        idLine.test(tasksMd),
        `row ${entry.row}: TASKS.md must declare \`**ID**: ${id}\``,
      ).toBe(true);
    }
  });
});

// Tests for scripts/generate-heal-coverage-matrix.mjs
//
// Pure-unit tests over the exported helpers. CLI integration is verified
// by calling the script via execFileSync with a fixture failures-dir.
//
// Scenarios:
//   - buildMatrix produces rows for observed + known patterns up to 10
//   - computeCoveragePct returns 0 when no observed class has a handler
//   - computeCoveragePct returns 1 when all observed classes have handlers
//   - parseHealIds extracts IDs from heal-dispatch.mjs source
//   - parseKnownPatterns extracts class names from classify-spawn-failures.py
//   - buildCoverageMatrix returns pending-data when total_classified < 5
//   - renderMarkdown produces a table with ≥5 rows when data is sufficient

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import {
  buildCoverageMatrix,
  buildMatrix,
  computeCoveragePct,
  parseHealIds,
  parseKnownPatterns,
  renderMarkdown,
} from "./generate-heal-coverage-matrix.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, "generate-heal-coverage-matrix.mjs");

// Minimal fake heal-dispatch.mjs source for parseHealIds
const FAKE_DISPATCH_SRC = `
  return [
    { id: "stale-pid", fixApplied: "heal-stale-pid", detect: () => {}, },
    { id: "corrupt-state-json", fixApplied: "heal-corrupt-state-json", detect: () => {}, },
    { id: "partial-config-write", fixApplied: "heal-partial-config-write", detect: () => {}, },
    { id: "missing-node-modules", fixApplied: "heal-worktree-missing-node-modules", detect: () => {}, },
    { id: "stale-tsbuildinfo", fixApplied: "heal-stale-tsbuildinfo", detect: () => {}, },
  ];
`;

// Minimal fake classify-spawn-failures.py source for parseKnownPatterns
const FAKE_CLASSIFIER_SRC = `
PATTERNS = [
    ("ModuleNotFoundError", r"ModuleNotFoundError"),
    ("command not found", r"command not found"),
    ("Killed", r"\\bKilled\\b"),
    ("signal 15", r"signal 15|SIGTERM"),
    ("ENOENT", r"\\bENOENT\\b"),
    ("Not logged in", r"Not logged in"),
]
`;

describe("parseHealIds", () => {
  test("extracts all 5 dispatchable heal IDs from fake source", () => {
    const ids = parseHealIds(FAKE_DISPATCH_SRC);
    expect(ids).toContain("stale-pid");
    expect(ids).toContain("corrupt-state-json");
    expect(ids).toContain("partial-config-write");
    expect(ids).toContain("missing-node-modules");
    expect(ids).toContain("stale-tsbuildinfo");
    expect(ids).toHaveLength(5);
  });

  test("deduplicates IDs", () => {
    const src = `{ id: "stale-pid" }, { id: "stale-pid" }, { id: "other" }`;
    const ids = parseHealIds(src);
    expect(ids.filter((id) => id === "stale-pid")).toHaveLength(1);
  });
});

describe("parseKnownPatterns", () => {
  test("extracts 6 known failure class names from fake source", () => {
    const patterns = parseKnownPatterns(FAKE_CLASSIFIER_SRC);
    expect(patterns).toContain("ModuleNotFoundError");
    expect(patterns).toContain("command not found");
    expect(patterns).toContain("Killed");
    expect(patterns).toContain("signal 15");
    expect(patterns).toContain("ENOENT");
    expect(patterns).toContain("Not logged in");
    expect(patterns).toHaveLength(6);
  });
});

describe("buildMatrix", () => {
  test("includes observed classes with count > 0 first", () => {
    const rows = buildMatrix({
      observedClasses: { unknown: 5, "command not found": 3 },
      healIds: ["stale-pid"],
      knownPatterns: ["ModuleNotFoundError", "command not found", "Killed"],
    });
    expect(rows[0]?.failure_class).toBe("unknown");
    expect(rows[0]?.observed_count).toBe(5);
    expect(rows[1]?.failure_class).toBe("command not found");
  });

  test("pads with unobserved known patterns to reach 10 rows", () => {
    const rows = buildMatrix({
      observedClasses: { unknown: 2 },
      healIds: [],
      knownPatterns: [
        "ModuleNotFoundError",
        "command not found",
        "Killed",
        "signal 15",
        "ENOENT",
        "Not logged in",
      ],
    });
    expect(rows.length).toBeGreaterThanOrEqual(5);
    // "unknown" is observed but not in knownPatterns, so knownPatterns fill the rest
    const hasModuleNotFound = rows.some((r) => r.failure_class === "ModuleNotFoundError");
    expect(hasModuleNotFound).toBe(true);
  });

  test("caps at 10 rows", () => {
    const observedClasses = Object.fromEntries(
      Array.from({ length: 15 }, (_, i) => [`class-${i}`, i + 1]),
    );
    const rows = buildMatrix({ observedClasses, healIds: [], knownPatterns: [] });
    expect(rows.length).toBeLessThanOrEqual(10);
  });

  test("marks heal_exists correctly when heal ID matches failure class", () => {
    const rows = buildMatrix({
      observedClasses: { "stale-pid": 1, unknown: 5 },
      healIds: ["stale-pid", "corrupt-state-json"],
      knownPatterns: [],
    });
    const stalePidRow = rows.find((r) => r.failure_class === "stale-pid");
    expect(stalePidRow?.heal_exists).toBe(true);
    expect(stalePidRow?.heal_handler).toBe("stale-pid");

    const unknownRow = rows.find((r) => r.failure_class === "unknown");
    expect(unknownRow?.heal_exists).toBe(false);
    expect(unknownRow?.heal_handler).toBeNull();
  });
});

describe("computeCoveragePct", () => {
  test("returns 0 when no observed class has a handler", () => {
    const rows = [
      { failure_class: "unknown", observed_count: 5, heal_handler: null, heal_exists: false },
      { failure_class: "Killed", observed_count: 2, heal_handler: null, heal_exists: false },
    ];
    expect(computeCoveragePct(rows)).toBe(0);
  });

  test("returns 1 when all observed classes have handlers", () => {
    const rows = [
      {
        failure_class: "stale-pid",
        observed_count: 3,
        heal_handler: "stale-pid",
        heal_exists: true,
      },
      {
        failure_class: "missing-node-modules",
        observed_count: 2,
        heal_handler: "missing-node-modules",
        heal_exists: true,
      },
    ];
    expect(computeCoveragePct(rows)).toBe(1);
  });

  test("ignores unobserved rows (count = 0) in coverage calculation", () => {
    const rows = [
      { failure_class: "unknown", observed_count: 4, heal_handler: null, heal_exists: false },
      // unobserved known pattern with a handler — should not count
      {
        failure_class: "stale-pid",
        observed_count: 0,
        heal_handler: "stale-pid",
        heal_exists: true,
      },
    ];
    expect(computeCoveragePct(rows)).toBe(0);
  });

  test("returns 0.5 when half of observed classes have handlers", () => {
    const rows = [
      {
        failure_class: "stale-pid",
        observed_count: 3,
        heal_handler: "stale-pid",
        heal_exists: true,
      },
      { failure_class: "unknown", observed_count: 2, heal_handler: null, heal_exists: false },
    ];
    expect(computeCoveragePct(rows)).toBe(0.5);
  });

  test("returns 0 when no observed rows exist", () => {
    const rows = [
      { failure_class: "ENOENT", observed_count: 0, heal_handler: null, heal_exists: false },
    ];
    expect(computeCoveragePct(rows)).toBe(0);
  });
});

describe("renderMarkdown", () => {
  test("produces pending-data output when status is pending-data", () => {
    const md = renderMarkdown([], {
      status: "pending-data",
      coverage_pct: 0,
      total_classified: 2,
      window_hours: 168,
    });
    expect(md).toContain("Pending data");
    expect(md).toContain("Re-run after the next 24h");
  });

  test("produces table with ≥5 rows when 7 rows provided", () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({
      failure_class: `class-${i}`,
      observed_count: i,
      heal_handler: null,
      heal_exists: false,
    }));
    const md = renderMarkdown(rows, {
      status: "ok",
      coverage_pct: 0,
      total_classified: 10,
      window_hours: 168,
    });
    // Should have a table header + 7 data rows
    const tableRows = md.match(/^\|/gm) ?? [];
    expect(tableRows.length).toBeGreaterThanOrEqual(5);
  });

  test("coverage_pct appears in output as integer percentage", () => {
    const rows = [
      {
        failure_class: "stale-pid",
        observed_count: 2,
        heal_handler: "stale-pid",
        heal_exists: true,
      },
    ];
    const md = renderMarkdown(rows, {
      status: "ok",
      coverage_pct: 0.5,
      total_classified: 2,
      window_hours: 168,
    });
    expect(md).toContain("50%");
  });
});

describe("CLI integration", () => {
  /**
   * Create a temporary failures-dir with N stderr.txt files whose content
   * matches the given pattern strings.
   * @param {string[]} stderrContents
   * @returns {string} failures-dir path
   */
  function makeFailuresDir(stderrContents) {
    const dir = mkdtempSync(join(tmpdir(), "heal-cov-matrix-"));
    for (let i = 0; i < stderrContents.length; i++) {
      const entryDir = join(dir, `entry-${i}`);
      mkdirSync(entryDir, { recursive: true });
      writeFileSync(join(entryDir, "stderr.txt"), stderrContents[i]);
    }
    return dir;
  }

  test("returns pending-data JSON when fewer than 5 failures", () => {
    const failuresDir = makeFailuresDir(["ENOENT: no such file", "command not found"]);
    const stdout = execFileSync(
      "node",
      [SCRIPT, "--json", "--failures-dir", failuresDir, "--window", "168h"],
      { encoding: "utf8", timeout: 15_000 },
    );
    const result = JSON.parse(stdout);
    expect(result.status).toBe("pending-data");
    expect(result.total_classified).toBeLessThan(5);
  });

  test("returns ok JSON with top10_rows when ≥5 failures", () => {
    const stderrList = [
      "ENOENT: no such file or directory",
      "command not found: pnpm",
      "Killed",
      "signal 15 SIGTERM received",
      "ModuleNotFoundError: No module named 'foo'",
      "Not logged in. Please run /login",
    ];
    const failuresDir = makeFailuresDir(stderrList);
    const stdout = execFileSync(
      "node",
      [SCRIPT, "--json", "--failures-dir", failuresDir, "--window", "168h"],
      { encoding: "utf8", timeout: 15_000 },
    );
    const result = JSON.parse(stdout);
    expect(result.status).toBe("ok");
    expect(result.top10_rows.length).toBeGreaterThanOrEqual(5);
    // All known patterns should be present (observed or padded)
    const classes = result.top10_rows.map(
      (/** @type {{ failure_class: string }} */ r) => r.failure_class,
    );
    expect(classes).toContain("ENOENT");
    expect(classes).toContain("command not found");
  });

  test("--json output has coverage_pct field", () => {
    const stderrList = Array.from({ length: 6 }, (_, i) => `error-${i}`);
    const failuresDir = makeFailuresDir(stderrList);
    const stdout = execFileSync(
      "node",
      [SCRIPT, "--json", "--failures-dir", failuresDir, "--window", "168h"],
      { encoding: "utf8", timeout: 15_000 },
    );
    const result = JSON.parse(stdout);
    expect(typeof result.coverage_pct).toBe("number");
    expect(result.coverage_pct).toBeGreaterThanOrEqual(0);
    expect(result.coverage_pct).toBeLessThanOrEqual(1);
  });

  test("buildCoverageMatrix with fixtures returns ok when ≥5 entries", () => {
    const stderrList = [
      "Killed",
      "Not logged in",
      "ENOENT: no such file",
      "command not found: node",
      "ModuleNotFoundError: foo",
      "signal 15 received",
    ];
    const failuresDir = makeFailuresDir(stderrList);
    const result = buildCoverageMatrix({
      failuresDir,
      windowSpec: "168h",
    });
    expect(result.status).toBe("ok");
    expect(result.top10_rows.length).toBeGreaterThanOrEqual(5);
    expect(typeof result.coverage_pct).toBe("number");
  });
});

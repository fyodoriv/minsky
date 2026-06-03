// Unit tests for audit-fixtures — pure helpers driven by an injected reader.
// The filesystem edge (defaultReadFile + main's stdout) is exercised through
// the exported pure functions; auditFixtures takes a fake reader so the test
// never touches real repo files.

import { describe, expect, test } from "vitest";

import {
  auditFixtures,
  formatTable,
  hasRealWorldMarker,
  hasSyntheticMarker,
  MIN_REAL_WORLD_FIXTURE_PARSERS,
  PARSER_MANIFEST,
  parseArgs,
  REAL_WORLD_MARKER,
} from "./audit-fixtures.mjs";

describe("hasRealWorldMarker", () => {
  test("true when the marker substring is present", () => {
    expect(hasRealWorldMarker(`# ${REAL_WORLD_MARKER} live TASKS.md`)).toBe(true);
  });

  test("false on a synthetic-only test body", () => {
    expect(hasRealWorldMarker('SAMPLE = """# Tasks"""')).toBe(false);
  });
});

describe("hasSyntheticMarker", () => {
  test("detects a Python heredoc literal", () => {
    expect(hasSyntheticMarker('SAMPLE_TASKS_MD = """# Tasks\n## P0\n"""')).toBe(true);
  });

  test("detects an experiment-record fixture loader", () => {
    expect(hasSyntheticMarker('const r = parse(fx("valid-1.yaml"));')).toBe(true);
  });

  test("detects an inline template-literal parse input", () => {
    expect(hasSyntheticMarker("parse(`\nid: example\n`)")).toBe(true);
  });

  test("false on a body with neither literal shape", () => {
    expect(hasSyntheticMarker("import { parse } from './parse.js';")).toBe(false);
  });
});

describe("auditFixtures (injected reader)", () => {
  /** A two-parser manifest for deterministic assertions. */
  const manifest = [
    { parser: "alpha", source: "scripts/a.py", testFile: "tests/test_a.py" },
    { parser: "beta", source: "scripts/b.py", testFile: "tests/test_b.py" },
  ];

  test("counts a parser with the real-world marker as covered", () => {
    /** @param {string} p */
    const readFile = (p) =>
      p === "tests/test_a.py"
        ? `SAMPLE = """x"""\n# ${REAL_WORLD_MARKER} live TASKS.md`
        : 'SAMPLE = """x"""';
    const report = auditFixtures({ manifest, readFile });
    expect(report.parsersTotal).toBe(2);
    expect(report.parsersWithRealWorldFixture).toBe(1);
    expect(report.parsersSyntheticOnly).toBe(1);
    expect(report.parsers[0]?.hasRealWorldFixture).toBe(true);
    expect(report.parsers[1]?.hasRealWorldFixture).toBe(false);
  });

  test("a missing test file is reported, not crashed on (rule #6)", () => {
    /** @param {string} p */
    const readFile = (p) => (p === "tests/test_a.py" ? 'SAMPLE = """x"""' : null);
    const report = auditFixtures({ manifest, readFile });
    expect(report.parsers[1]?.testFileExists).toBe(false);
    expect(report.parsers[1]?.hasRealWorldFixture).toBe(false);
    expect(report.parsers[1]?.hasSyntheticFixture).toBe(false);
  });

  test("does not double-count: synthetic-only excludes real-world-covered", () => {
    const readFile = () => `# ${REAL_WORLD_MARKER} live`;
    const report = auditFixtures({ manifest, readFile });
    expect(report.parsersWithRealWorldFixture).toBe(2);
    expect(report.parsersSyntheticOnly).toBe(0);
  });
});

describe("auditFixtures over the real repo manifest", () => {
  test("the shipped manifest meets the pre-registered threshold (Measurement)", () => {
    // REAL-WORLD FIXTURE: this asserts the live repo state the task block's
    // Measurement gates on — `parsersWithRealWorldFixture >= 3`. Reads the
    // actual test files via the default reader, so it fails if a future edit
    // strips the marker from one of the three audited parsers.
    const report = auditFixtures();
    expect(report.parsersTotal).toBe(PARSER_MANIFEST.length);
    expect(report.parsersWithRealWorldFixture).toBeGreaterThanOrEqual(
      MIN_REAL_WORLD_FIXTURE_PARSERS,
    );
  });
});

describe("formatTable", () => {
  test("renders a checkmark for covered parsers and the threshold line", () => {
    const report = auditFixtures({
      manifest: [{ parser: "alpha", source: "s", testFile: "t" }],
      readFile: () => `# ${REAL_WORLD_MARKER}`,
    });
    const out = formatTable(report);
    expect(out).toContain("✓ alpha");
    expect(out).toContain(`threshold ${MIN_REAL_WORLD_FIXTURE_PARSERS}`);
  });
});

describe("parseArgs", () => {
  test("defaults to table format, non-strict", () => {
    expect(parseArgs([])).toEqual({ format: "table", strict: false, help: false });
  });

  test("--format=json and --json both select json", () => {
    expect(parseArgs(["--format=json"]).format).toBe("json");
    expect(parseArgs(["--json"]).format).toBe("json");
  });

  test("--strict and --help are recognised", () => {
    expect(parseArgs(["--strict"]).strict).toBe(true);
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
  });
});

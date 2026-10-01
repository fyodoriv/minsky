// Tests for check-mape-k-constraints-md-size.mjs. Pattern: deterministic
// CI gate over an append-only knowledge log size cap (rule #10 ratchet
// applied to `novel/mape-k-loop/constraints.md`'s prose-only 200-entry
// archive cap). Paired positive/negative fixtures (Meszaros 2007, *xUnit
// Test Patterns*) plus boundary-inclusive case at exactly 200 entries
// (Beyer SRE 2016 Ch. 3 — "you have used X % of your budget" is not a
// violation until X *exceeds* it).

import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  checkConstraintsMdSize,
  DEFAULT_CAP_ENTRIES,
  ENTRY_HEADING_RE,
} from "./check-mape-k-constraints-md-size.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = resolve(HERE, "check-mape-k-constraints-md-size.mjs");

/**
 * Helper: build a constraints.md-shaped buffer with `n` `## <date>`
 * sections. Mirrors the heading shape the live file uses today.
 *
 * @param {number} n
 * @returns {string}
 */
function buildConstraintsWithEntries(n) {
  const header = [
    "# `constraints.md` — append-only knowledge log",
    "",
    "Per Helland, *CIDR* 2007. Every tick appends a `## <ISO-8601 date>` section.",
    "",
  ].join("\n");
  /** @type {string[]} */
  const sections = [];
  for (let i = 0; i < n; i += 1) {
    // Use distinct (synthetic) dates so the entries are visibly separate.
    // The day rolls past 31 freely — the lint regex doesn't validate
    // calendar correctness, only the YYYY-MM-DD shape.
    const day = String((i % 28) + 1).padStart(2, "0");
    const month = String((((i / 28) | 0) % 12) + 1).padStart(2, "0");
    const year = 2026 + ((((i / 28) | 0) / 12) | 0);
    sections.push(
      [
        `## ${year}-${month}-${day}`,
        "",
        "- **Top constraint**: `(synthetic)`",
        "- **Decision**: no-op",
        "- **Reason**: synthetic test fixture.",
        "",
      ].join("\n"),
    );
  }
  return header + sections.join("\n");
}

describe("checkConstraintsMdSize (pure)", () => {
  test("199 entries → ok (under cap)", () => {
    const result = checkConstraintsMdSize({
      content: buildConstraintsWithEntries(199),
    });
    expect(result.ok).toBe(true);
    expect(result.count).toBe(199);
  });

  test("exactly 200 entries → ok (boundary inclusive)", () => {
    // Locks the inclusive-at-cap semantics documented in the script
    // header (Beyer SRE 2016 Ch. 3 — exceeded ≠ used). Pairs with the
    // identical boundary case in scripts/check-mape-k-budget-cap.test.mjs.
    const result = checkConstraintsMdSize({
      content: buildConstraintsWithEntries(200),
    });
    expect(result.ok).toBe(true);
    expect(result.count).toBe(200);
  });

  test("201 entries → fail with archive-split suggestion in reason", () => {
    const result = checkConstraintsMdSize({
      content: buildConstraintsWithEntries(201),
    });
    expect(result.ok).toBe(false);
    expect(result.count).toBe(201);
    expect(result.reason).toBeDefined();
    if (result.reason !== undefined) {
      expect(result.reason).toContain("201");
      expect(result.reason).toContain("200");
      expect(result.reason).toMatch(/archive/i);
      expect(result.reason).toMatch(/Helland/);
    }
  });

  test("null content → ok (dormant state, 0 entries)", () => {
    const result = checkConstraintsMdSize({ content: null });
    expect(result.ok).toBe(true);
    expect(result.count).toBe(0);
  });

  test("empty string → ok (treated identically to missing file)", () => {
    const result = checkConstraintsMdSize({ content: "" });
    expect(result.ok).toBe(true);
    expect(result.count).toBe(0);
  });

  test("explicit capEntries override is honoured", () => {
    // 5 entries is over a cap of 3 but under a cap of 10.
    const overTight = checkConstraintsMdSize({
      content: buildConstraintsWithEntries(5),
      capEntries: 3,
    });
    expect(overTight.ok).toBe(false);
    const underLoose = checkConstraintsMdSize({
      content: buildConstraintsWithEntries(5),
      capEntries: 10,
    });
    expect(underLoose.ok).toBe(true);
  });

  test("zero / negative / non-integer capEntries → fail (malformed input)", () => {
    const zero = checkConstraintsMdSize({ content: "## 2026-05-03\n", capEntries: 0 });
    expect(zero.ok).toBe(false);
    const neg = checkConstraintsMdSize({ content: "## 2026-05-03\n", capEntries: -1 });
    expect(neg.ok).toBe(false);
    const frac = checkConstraintsMdSize({ content: "## 2026-05-03\n", capEntries: 1.5 });
    expect(frac.ok).toBe(false);
  });

  test("DEFAULT_CAP_ENTRIES matches the constraints.md preamble (200)", () => {
    // Locks the constant so a silent edit to the default is a loud test
    // failure — same pattern as `check-mape-k-budget-cap`'s
    // DEFAULT_CAP_FRACTION lock.
    expect(DEFAULT_CAP_ENTRIES).toBe(200);
  });

  test("prose mentioning `## <ISO-8601 date>` in backticks is NOT counted", () => {
    // The live constraints.md preamble references the heading shape
    // inside backticks; the strict YYYY-MM-DD regex must not count it.
    const content = [
      "# preamble",
      "",
      "Every tick appends a `## <ISO-8601 date>` section.",
      "Another mention: ## YYYY-MM-DD heading shape.",
      "",
      "## 2026-05-03",
      "Real entry.",
      "",
      "## 2026-05-04",
      "Real entry.",
      "",
    ].join("\n");
    const result = checkConstraintsMdSize({ content });
    expect(result.ok).toBe(true);
    expect(result.count).toBe(2);
  });

  test("the live novel/mape-k-loop/constraints.md passes the gate", async () => {
    // Reads the real file from disk so this test catches in-repo drift
    // past the cap before CI does. Same precedent as
    // `check-skill-rule-cap.test.mjs`'s live-file assertion.
    const { readFile } = await import("node:fs/promises");
    const livePath = resolve(HERE, "..", "novel", "mape-k-loop", "constraints.md");
    const content = await readFile(livePath, "utf8");
    const result = checkConstraintsMdSize({ content });
    expect(result.ok).toBe(true);
    expect(result.count).toBeLessThanOrEqual(DEFAULT_CAP_ENTRIES);
  });

  test("ENTRY_HEADING_RE shape is locked (single-match form mirrors the global form)", () => {
    expect("## 2026-05-03").toMatch(ENTRY_HEADING_RE);
    expect("##  2026-05-03").toMatch(ENTRY_HEADING_RE);
    expect("## 2026-05-03 — extra prose after the date").toMatch(ENTRY_HEADING_RE);
    expect("## entry").not.toMatch(ENTRY_HEADING_RE);
    expect("# 2026-05-03").not.toMatch(ENTRY_HEADING_RE);
    expect("### 2026-05-03").not.toMatch(ENTRY_HEADING_RE);
  });
});

describe("CLI (I/O boundary)", () => {
  /** @type {string} */
  let dir;

  beforeEach(() => {
    dir = join(
      tmpdir(),
      `mape-k-constraints-md-size-test-${process.pid}-${Date.now()}-${Math.random()}`,
    );
    mkdirSync(dir, { recursive: true });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /**
   * @param {string[]} args
   * @returns {{ status: number, stdout: string, stderr: string }}
   */
  function runCli(args) {
    const r = spawnSync("node", [SCRIPT_PATH, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return {
      status: typeof r.status === "number" ? r.status : 1,
      stdout: r.stdout ?? "",
      stderr: r.stderr ?? "",
    };
  }

  test("199 entries → exit 0", () => {
    const path = join(dir, "constraints.md");
    writeFileSync(path, buildConstraintsWithEntries(199));
    const result = runCli([path]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/199/);
  });

  test("exactly 200 entries → exit 0 (boundary inclusive)", () => {
    const path = join(dir, "constraints.md");
    writeFileSync(path, buildConstraintsWithEntries(200));
    const result = runCli([path]);
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/200/);
  });

  test("201 entries → exit 1 with `split into archive` suggestion in stderr", () => {
    const path = join(dir, "constraints.md");
    writeFileSync(path, buildConstraintsWithEntries(201));
    const result = runCli([path]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/201/);
    expect(result.stderr).toMatch(/archive/i);
  });

  test("missing file → exit 0 with dormant advisory in stderr", () => {
    const path = join(dir, "does-not-exist.md");
    const result = runCli([path]);
    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(/dormant/);
  });
});

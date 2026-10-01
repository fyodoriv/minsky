// @ts-check
import { describe, expect, it } from "vitest";
import {
  checkCliIntegrationTestCoverage,
  extractSubcommands,
} from "./check-cli-integration-test-coverage.mjs";

describe("extractSubcommands", () => {
  it("parses bash case branches like `  status)`", () => {
    const src = ["case $1 in", "  status)", "    echo ok", "    ;;", "esac"].join("\n");
    expect(extractSubcommands(src)).toEqual(["status"]);
  });

  it("extracts multiple subcommands", () => {
    const src = ["  status)", "  stop)", "  reset-host-if-crashed)", "  init)"].join("\n");
    expect(extractSubcommands(src)).toEqual(["init", "reset-host-if-crashed", "status", "stop"]);
  });

  it("ignores inner case branches (>2 indent)", () => {
    const src = ["  status)", "    --quiet)", "      _q=1 ;;"].join("\n");
    expect(extractSubcommands(src)).toEqual(["status"]);
  });

  it("returns empty on no case statements", () => {
    expect(extractSubcommands("# just comments")).toEqual([]);
  });
});

describe("checkCliIntegrationTestCoverage", () => {
  it("passes when all subcommands are grandfathered or have tests", () => {
    const result = checkCliIntegrationTestCoverage({
      repoRoot: "/repo",
      binPath: "/repo/bin/minsky",
      fileExists: () => false, // no tests exist
      readText: () => "  status)\n  stop)\n", // both grandfathered
    });
    expect(result.ok).toBe(true);
  });

  it("flags a NEW subcommand without a test", () => {
    const result = checkCliIntegrationTestCoverage({
      repoRoot: "/repo",
      binPath: "/repo/bin/minsky",
      fileExists: () => false,
      readText: () => "  brand-new-verb)\n",
    });
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toMatch(/brand-new-verb/);
  });

  it("passes a NEW subcommand if a test exists", () => {
    const result = checkCliIntegrationTestCoverage({
      repoRoot: "/repo",
      binPath: "/repo/bin/minsky",
      fileExists: (p) => p === "/repo/test/integration/brand-new-verb.test.ts",
      readText: () => "  brand-new-verb)\n",
    });
    expect(result.ok).toBe(true);
  });

  it("handles bin file read failure", () => {
    const result = checkCliIntegrationTestCoverage({
      repoRoot: "/repo",
      binPath: "/repo/bin/missing",
      fileExists: () => false,
      readText: () => {
        throw new Error("ENOENT");
      },
    });
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toMatch(/Cannot read/);
  });

  it("real production scan passes (smoke)", () => {
    const result = checkCliIntegrationTestCoverage();
    expect(result.ok).toBe(true);
  });
});

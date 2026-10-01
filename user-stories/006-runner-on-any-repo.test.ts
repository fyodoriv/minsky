/**
 * User-story 006 — "Runner on any repo: one-command install + run"
 * (`user-stories/006-runner-on-any-repo.md`).
 *
 * Integration test for M1.3 (one-command install). The full
 * acceptance criterion in the user-story is "any host repo → bootstrap +
 * iterate without operator intervention beyond `./setup.sh --setup`".
 * This file pins the SUBSTRATE-LEVEL invariants of that surface:
 *   - `setup.sh` exists at repo root
 *   - `setup.sh --setup` is the canonical entry-point flag
 *   - `setup.sh --doctor` exists for health probes
 *   - `bin/minsky setup` is a subcommand alias (Phase 2 CLI overhaul, 2026-05-26)
 *   - `pnpm minsky:setup` deprecation-stub still works
 *
 * The end-to-end install (`./setup.sh --setup` against a fixture repo)
 * is gated by macOS launchctl access — covered by the operator-side
 * smoke test in `pnpm minsky:setup`, not vitest. This file is the
 * structural lint that catches any future drift in the install surface
 * shape (rule #10 — deterministic substrate invariants).
 *
 * Hypothesis (rule #9): if these 4 invariants hold, the operator-side
 * `./setup.sh --setup` continues to work.
 * Success: every test below passes.
 * Pivot: if the test passes but operator-side setup breaks, add the
 * specific failing surface as a new invariant here.
 * Measurement: this file.
 * Anchor: rule #10 (deterministic substrate invariants); rule #6 (loud-
 * crash > silent failure — missing install surfaces fail loud here).
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..");

describe("user-story 006 — one-command install (M1.3) substrate", () => {
  test("setup.sh exists at repo root", () => {
    expect(existsSync(join(REPO_ROOT, "setup.sh"))).toBe(true);
  });

  test("setup.sh --help advertises the --setup canonical flag", () => {
    const helpOutput = execFileSync("bash", [join(REPO_ROOT, "setup.sh"), "--help"], {
      encoding: "utf8",
    });
    expect(helpOutput).toMatch(/--setup/);
  });

  test("setup.sh --doctor is the canonical health probe", () => {
    const helpOutput = execFileSync("bash", [join(REPO_ROOT, "setup.sh"), "--help"], {
      encoding: "utf8",
    });
    expect(helpOutput).toMatch(/--doctor/);
  });

  test("bin/minsky setup subcommand exists (Phase 2 CLI overhaul, 2026-05-26)", () => {
    const binMinsky = readFileSync(join(REPO_ROOT, "bin/minsky"), "utf8");
    // `setup)` is the canonical case branch in bin/minsky's command dispatch
    expect(binMinsky).toMatch(/^\s+setup\)/m);
  });

  test("pnpm minsky:setup deprecation alias still works (until 2026-06-26)", () => {
    const packageJson = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
    expect(packageJson.scripts).toHaveProperty("minsky:setup");
  });
});

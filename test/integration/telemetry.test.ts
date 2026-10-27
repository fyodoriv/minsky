// Integration tests for `bin/minsky telemetry` and field recording, run
// against the real binary with a temporary MINSKY_STATE_DIR.
//
// Hypothesis (rule #9): the CLI seam reports status, honors `off`, prints a
// dry-run body with the key hidden, and records one content-free usage line
// per run, so the README Proof section rests on real data.
// Success: every test below passes. Pivot: if the wrapper cannot record
// exit codes reliably, move recording into the Node runner.
// Measurement: this test file. Anchor: AGENTS.md §3b; Homebrew analytics
// (docs.brew.sh/Analytics).

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const MINSKY_BIN = join(import.meta.dirname, "..", "..", "bin", "minsky");

function run(args: string[], env: Record<string, string>) {
  return spawnSync("bash", [MINSKY_BIN, ...args], {
    encoding: "utf8",
    env: { ...process.env, MINSKY_POSTHOG_KEY: "", ...env },
  });
}

describe("bin/minsky telemetry", () => {
  test("status says off with no key, and off/on persist", () => {
    const dir = mkdtempSync(join(tmpdir(), "minsky-tel-int-"));
    expect(run(["telemetry", "status"], { MINSKY_STATE_DIR: dir }).stdout).toContain(
      "off (no key)",
    );
    run(["telemetry", "off"], { MINSKY_STATE_DIR: dir });
    const r = run(["telemetry", "status"], {
      MINSKY_STATE_DIR: dir,
      MINSKY_POSTHOG_KEY: "phc_fake",
    });
    expect(r.stdout).toContain("off (turned off)");
  });

  test("send --dry-run hides the key", () => {
    const dir = mkdtempSync(join(tmpdir(), "minsky-tel-int-"));
    const r = run(["telemetry", "send", "--dry-run"], {
      MINSKY_STATE_DIR: dir,
      MINSKY_POSTHOG_KEY: "phc_fake",
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("<posthog_key>");
    expect(r.stdout).not.toContain("phc_fake");
  });

  test("a real run outside vitest records one content-free usage line", () => {
    const dir = mkdtempSync(join(tmpdir(), "minsky-tel-int-"));
    const env = { MINSKY_STATE_DIR: dir, VITEST: "", DO_NOT_TRACK: "1" };
    const r = run(["telemetry", "status", "/secret/canary-path"], env);
    expect(r.status).toBe(0);
    const text = readFileSync(join(dir, "usage.jsonl"), "utf8");
    expect(text).not.toContain("canary");
    expect(JSON.parse(text.trim())).toMatchObject({
      command: "telemetry",
      status: "ok",
      exit_code: 0,
    });
  });
});

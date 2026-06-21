// Pins `minsky enable-autostart` — opt-in bootstrap of all com.minsky.*
// LaunchAgents after endpoint-ready + EPM-safe jq gate. Shipped in PR #1240.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const MINSKY_BIN = join(REPO_ROOT, "bin", "minsky");

describe("bin/minsky enable-autostart", () => {
  test("requires endpoint-ready sentinel before bootstrap", () => {
    const src = readFileSync(MINSKY_BIN, "utf8");
    expect(src).toMatch(/enable-autostart\)/);
    expect(src).toMatch(/endpoint-ready sentinel missing/);
    expect(src).toMatch(/no EPM-safe jq found/);
  });

  test("writes autostart + tick-loop sentinels and bootstraps com.minsky.* plists", () => {
    const src = readFileSync(MINSKY_BIN, "utf8");
    expect(src).toMatch(/_autostart_sentinel/);
    expect(src).toMatch(/tick-loop-enabled/);
    expect(src).toMatch(/launchctl bootstrap "gui\/\$\(id -u\)"/);
    expect(src).toMatch(/minsky autostart enabled/);
  });
});

// Pins `minsky disable-autostart` — bootout all com.minsky.* agents,
// set Disabled=true, remove opt-in sentinels. Shipped in PR #1240.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const MINSKY_BIN = join(REPO_ROOT, "bin", "minsky");

describe("bin/minsky disable-autostart", () => {
  test("bootouts agents, disables plists, and removes sentinels", () => {
    const src = readFileSync(MINSKY_BIN, "utf8");
    expect(src).toMatch(/disable-autostart\)/);
    expect(src).toMatch(/_minsky_bootout_all_launchagents/);
    expect(src).toMatch(/_minsky_set_all_plists_disabled true/);
    expect(src).toMatch(/rm -f "\$_autostart_sentinel" "\$_tick_sentinel"/);
    expect(src).toMatch(/minsky autostart disabled/);
  });
});

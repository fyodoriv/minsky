// Pins deprecated `minsky disable-tick-loop` alias → disable-autostart.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const MINSKY_BIN = join(REPO_ROOT, "bin", "minsky");

describe("bin/minsky disable-tick-loop (deprecated alias)", () => {
  test("delegates to disable-autostart with deprecation notice", () => {
    const src = readFileSync(MINSKY_BIN, "utf8");
    expect(src).toMatch(/disable-tick-loop\)/);
    expect(src).toMatch(/disable-tick-loop is deprecated/);
    expect(src).toMatch(/exec "\$0" disable-autostart/);
  });
});

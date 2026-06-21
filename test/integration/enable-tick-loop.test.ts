// Pins deprecated `minsky enable-tick-loop` alias → enable-autostart.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const MINSKY_BIN = join(REPO_ROOT, "bin", "minsky");

describe("bin/minsky enable-tick-loop (deprecated alias)", () => {
  test("delegates to enable-autostart with deprecation notice", () => {
    const src = readFileSync(MINSKY_BIN, "utf8");
    expect(src).toMatch(/enable-tick-loop\)/);
    expect(src).toMatch(/enable-tick-loop is deprecated/);
    expect(src).toMatch(/exec "\$0" enable-autostart/);
  });
});

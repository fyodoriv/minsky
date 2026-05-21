// Smoke tests for `install-lefthook-best-effort.mjs`. The script's
// contract: ALWAYS exit 0, even when lefthook install fails (the
// fallback-friendly variant for `pnpm install` lifecycles per the
// 2026-05-08 fresh-clone-bootstrap operator directive). Lifts L6
// coverage.
//
// Source: rule #6 (stay alive — never fail-open noisily during install
// scripts); rule #17 (proactive healing — observed L6 gap is a fix).

import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, "install-lefthook-best-effort.mjs");

describe("install-lefthook-best-effort smoke", () => {
  test("script always exits 0 (the rule-#6 contract)", () => {
    // Exit code MUST be 0 regardless of whether lefthook is installable
    // — the script is designed to never break `pnpm install`.
    const result = execFileSync("node", [SCRIPT], {
      encoding: "utf8",
      timeout: 30_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    // `execFileSync` throws on non-zero exit; reaching this line
    // proves exit was 0.
    expect(typeof result).toBe("string");
  });
});

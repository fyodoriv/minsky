// Paired tests for `check-sandbox-env-declared.mjs`. Pattern: deterministic
// gate over the `MINSKY_SANDBOX` substrate cohesion (resolver source ↔ unit-
// file templates). Tests follow the standard positive / negative fixture
// shape (Meszaros 2007).

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import {
  LAUNCHD_PLIST_PATH,
  REQUIRED_ENV_VAR,
  SANDBOX_MODE_TS_PATH,
  SYSTEMD_UNIT_PATH,
  UNIT_FILE_PATHS,
  checkAll,
  checkResolverSource,
  checkUnitFile,
} from "./check-sandbox-env-declared.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

describe("REQUIRED_ENV_VAR", () => {
  test("is the documented MINSKY_SANDBOX literal", () => {
    expect(REQUIRED_ENV_VAR).toBe("MINSKY_SANDBOX");
  });
});

describe("UNIT_FILE_PATHS", () => {
  test("covers both supervisor unit-file templates", () => {
    expect(UNIT_FILE_PATHS).toEqual([SYSTEMD_UNIT_PATH, LAUNCHD_PLIST_PATH]);
  });
});

describe("checkResolverSource", () => {
  test("passes when SANDBOX_MODE_ENV is declared with the required literal", () => {
    const source = `export const SANDBOX_MODE_ENV = "MINSKY_SANDBOX";\n`;
    expect(checkResolverSource(source)).toEqual({ ok: true });
  });

  test("fails when SANDBOX_MODE_ENV is missing", () => {
    const source = `export const SOMETHING_ELSE = "MINSKY_SANDBOX";\n`;
    const result = checkResolverSource(source);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toContain("missing");
    expect(result.errors[0]).toContain("SANDBOX_MODE_ENV");
  });

  test("fails when SANDBOX_MODE_ENV is declared with a different literal", () => {
    const source = `export const SANDBOX_MODE_ENV = "MINSKY_BOX";\n`;
    const result = checkResolverSource(source);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toContain('"MINSKY_BOX"');
    expect(result.errors[0]).toContain('"MINSKY_SANDBOX"');
  });
});

describe("checkUnitFile", () => {
  test("passes when the unit text declares MINSKY_SANDBOX and cites § 13.3", () => {
    const unit = [
      "[Service]",
      "# vision.md § 13.3 — supervisor sandbox",
      "# Environment=MINSKY_SANDBOX=off",
    ].join("\n");
    expect(checkUnitFile(unit, SYSTEMD_UNIT_PATH)).toEqual({ ok: true });
  });

  test("passes when the citation uses `rule #13.3` instead of `§ 13.3`", () => {
    const unit = [
      "<dict>",
      "<!-- rule #13.3 supervisor sandbox -->",
      "<!-- <key>MINSKY_SANDBOX</key><string>off</string> -->",
      "</dict>",
    ].join("\n");
    expect(checkUnitFile(unit, LAUNCHD_PLIST_PATH)).toEqual({ ok: true });
  });

  test("fails when MINSKY_SANDBOX is absent", () => {
    const unit = "# § 13.3 supervisor sandbox\nEnvironment=OTHER=1\n";
    const result = checkUnitFile(unit, SYSTEMD_UNIT_PATH);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toContain("MINSKY_SANDBOX");
    expect(result.errors[0]).toContain("missing");
  });

  test("fails when the citation is missing", () => {
    const unit = "# Environment=MINSKY_SANDBOX=off\n";
    const result = checkUnitFile(unit, SYSTEMD_UNIT_PATH);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toContain("13.3");
  });

  test("aggregates both errors when env-var and citation are absent", () => {
    const unit = "# unrelated comment\n";
    const result = checkUnitFile(unit, SYSTEMD_UNIT_PATH);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(2);
  });
});

describe("checkAll", () => {
  test("returns ok for all entries when every file passes", () => {
    const contents = new Map([
      [SANDBOX_MODE_TS_PATH, `export const SANDBOX_MODE_ENV = "MINSKY_SANDBOX";\n`],
      [SYSTEMD_UNIT_PATH, "# § 13.3\n# Environment=MINSKY_SANDBOX=off\n"],
      [LAUNCHD_PLIST_PATH, "<!-- rule #13.3 -->\n<!-- MINSKY_SANDBOX -->\n"],
    ]);
    const { resolverResult, unitResults } = checkAll(contents);
    expect(resolverResult).toEqual({ ok: true });
    expect(unitResults).toHaveLength(2);
    expect(unitResults.every((r) => r.result.ok)).toBe(true);
  });

  test("flags the resolver as missing when the file is absent from the map", () => {
    const contents = new Map([
      [SYSTEMD_UNIT_PATH, "# § 13.3\n# Environment=MINSKY_SANDBOX=off\n"],
      [LAUNCHD_PLIST_PATH, "<!-- rule #13.3 -->\n<!-- MINSKY_SANDBOX -->\n"],
    ]);
    const { resolverResult } = checkAll(contents);
    expect(resolverResult.ok).toBe(false);
    if (resolverResult.ok) return;
    expect(resolverResult.errors[0]).toContain("file missing on disk");
  });

  test("flags an individual unit file when its content is missing the env var", () => {
    const contents = new Map([
      [SANDBOX_MODE_TS_PATH, `export const SANDBOX_MODE_ENV = "MINSKY_SANDBOX";\n`],
      [SYSTEMD_UNIT_PATH, "# § 13.3\nEnvironment=OTHER=1\n"],
      [LAUNCHD_PLIST_PATH, "<!-- rule #13.3 -->\n<!-- MINSKY_SANDBOX -->\n"],
    ]);
    const { resolverResult, unitResults } = checkAll(contents);
    expect(resolverResult).toEqual({ ok: true });
    const systemd = unitResults.find((r) => r.path === SYSTEMD_UNIT_PATH);
    expect(systemd?.result.ok).toBe(false);
    const launchd = unitResults.find((r) => r.path === LAUNCHD_PLIST_PATH);
    expect(launchd?.result.ok).toBe(true);
  });
});

describe("the gate against the live repo", () => {
  test("the resolver source on disk satisfies checkResolverSource", async () => {
    const text = await readFile(resolve(REPO_ROOT, SANDBOX_MODE_TS_PATH), "utf8");
    expect(checkResolverSource(text)).toEqual({ ok: true });
  });

  test("each unit-file template on disk satisfies checkUnitFile", async () => {
    for (const path of UNIT_FILE_PATHS) {
      const text = await readFile(resolve(REPO_ROOT, path), "utf8");
      const result = checkUnitFile(text, path);
      expect(result.ok, `${path}: ${result.ok ? "" : result.errors.join("; ")}`).toBe(true);
    }
  });
});

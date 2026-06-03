// Tests for check-supervisor-sandbox-hardening.mjs. Pattern: paired
// positive/negative fixtures (Meszaros 2007, *xUnit Test Patterns*) over
// a deterministic CI gate. Plus an in-tree fixture: the real unit files
// shipped under `distribution/systemd/` must pass — otherwise the gate
// is broken on main.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

import {
  checkMacosSandboxProfile,
  checkSupervisorSandboxHardening,
  MACOS_SANDBOX_PROFILE,
  MACOS_TICK_LOOP_PLIST,
  REQUIRED_DIRECTIVES,
  REQUIRED_UNIT_FILES,
  readUnitContents,
  SBPL_DENY_DEFAULT,
} from "./check-supervisor-sandbox-hardening.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const SYSTEMD_DIR = resolve(REPO_ROOT, "distribution", "systemd");
const LAUNCHD_DIR = resolve(REPO_ROOT, "distribution", "launchd");

const GOOD_PROFILE = `(version 1)\n${SBPL_DENY_DEFAULT}\n(allow process-fork)\n`;
const GOOD_PLIST = [
  "<array>",
  "  <string>/usr/bin/sandbox-exec</string>",
  "  <string>-f</string>",
  `  <string>\${MINSKY_HOME}/distribution/launchd/${MACOS_SANDBOX_PROFILE}</string>`,
  "  <string>/bin/bash</string>",
  "</array>",
].join("\n");

/**
 * Fabricates a unit-file body that contains every directive in the
 * provided set inside a `[Service]` block.
 * @param {ReadonlyArray<string>} directives
 */
function unitWithDirectives(directives) {
  return ["[Unit]", "Description=fixture", "", "[Service]", "Type=simple", ...directives, ""].join(
    "\n",
  );
}

describe("checkSupervisorSandboxHardening (pure)", () => {
  test("every required directive present in every required unit → ok", () => {
    /** @type {Record<string, string>} */
    const unitContents = {};
    for (const unit of REQUIRED_UNIT_FILES) {
      unitContents[unit] = unitWithDirectives(REQUIRED_DIRECTIVES);
    }
    const result = checkSupervisorSandboxHardening({ unitContents });
    expect(result.ok).toBe(true);
  });

  test("one missing directive in one unit → fail with that exact pair", () => {
    const targetUnit = REQUIRED_UNIT_FILES[0] ?? "";
    /** @type {Record<string, string>} */
    const unitContents = {};
    for (const unit of REQUIRED_UNIT_FILES) {
      unitContents[unit] = unitWithDirectives(REQUIRED_DIRECTIVES);
    }
    const partial = REQUIRED_DIRECTIVES.filter((d) => d !== "PrivateTmp=yes");
    unitContents[targetUnit] = unitWithDirectives(partial);

    const result = checkSupervisorSandboxHardening({ unitContents });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toEqual([{ unit: targetUnit, directive: "PrivateTmp=yes" }]);
    }
  });

  test("entire unit missing → every directive reported missing for that unit", () => {
    const targetUnit = REQUIRED_UNIT_FILES[0] ?? "";
    /** @type {Record<string, string>} */
    const unitContents = {};
    for (const unit of REQUIRED_UNIT_FILES.slice(1)) {
      unitContents[unit] = unitWithDirectives(REQUIRED_DIRECTIVES);
    }
    const result = checkSupervisorSandboxHardening({ unitContents });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toHaveLength(REQUIRED_DIRECTIVES.length);
      for (const item of result.missing) {
        expect(item.unit).toBe(targetUnit);
      }
    }
  });

  test("directive appears with extra leading/trailing whitespace → still recognised", () => {
    /** @type {Record<string, string>} */
    const unitContents = {};
    for (const unit of REQUIRED_UNIT_FILES) {
      const body = REQUIRED_DIRECTIVES.map((d) => `   ${d}   `).join("\n");
      unitContents[unit] = `[Service]\n${body}\n`;
    }
    const result = checkSupervisorSandboxHardening({ unitContents });
    expect(result.ok).toBe(true);
  });

  test("near-miss directive (`PrivateTmp=true` instead of `PrivateTmp=yes`) → fail", () => {
    // `yes` and `true` are both valid systemd booleans but we pin the
    // canonical form so visual scans of the unit file don't have to do
    // the boolean-equivalence reasoning.
    /** @type {Record<string, string>} */
    const unitContents = {};
    const tweaked = REQUIRED_DIRECTIVES.map((d) =>
      d === "PrivateTmp=yes" ? "PrivateTmp=true" : d,
    );
    for (const unit of REQUIRED_UNIT_FILES) {
      unitContents[unit] = unitWithDirectives(tweaked);
    }
    const result = checkSupervisorSandboxHardening({ unitContents });
    expect(result.ok).toBe(false);
  });

  test("REQUIRED_DIRECTIVES contains the documented safe set, in the documented order", () => {
    expect(Array.from(REQUIRED_DIRECTIVES)).toEqual([
      "NoNewPrivileges=yes",
      "PrivateTmp=yes",
      "ProtectControlGroups=yes",
      "RestrictSUIDSGID=yes",
      "LockPersonality=yes",
      "RestrictRealtime=yes",
    ]);
  });

  test("REQUIRED_DIRECTIVES excludes the user-mode-incompatible ProtectKernel triple", () => {
    // Dropping CAP_SYS_RAWIO / CAP_SYS_MODULE / CAP_SYSLOG via
    // PR_CAPBSET_DROP requires CAP_SETPCAP, which user-mode systemd
    // sessions lack. Including these directives causes the unit to
    // fail start with status=218/CAPABILITIES (observed: PR #347
    // linux-supervisor-integration CI 2026-05-07). Pin the exclusion
    // so a future drift-fix PR doesn't silently re-add them.
    const directives = Array.from(REQUIRED_DIRECTIVES);
    expect(directives).not.toContain("ProtectKernelTunables=yes");
    expect(directives).not.toContain("ProtectKernelModules=yes");
    expect(directives).not.toContain("ProtectKernelLogs=yes");
  });

  test("REQUIRED_UNIT_FILES covers all three supervisor units", () => {
    expect(Array.from(REQUIRED_UNIT_FILES)).toEqual([
      "minsky-tick-loop.service",
      "minsky-budget-guard.service",
      "minsky-watchdog.service",
    ]);
  });
});

describe("real unit files under distribution/systemd/", () => {
  test("every shipped unit carries the full required directive set", () => {
    const unitContents = readUnitContents(SYSTEMD_DIR, REQUIRED_UNIT_FILES);
    const result = checkSupervisorSandboxHardening({ unitContents });
    if (!result.ok) {
      const summary = result.missing
        .map(({ unit, directive }) => `${unit} missing ${directive}`)
        .join("; ");
      throw new Error(`shipped unit files fail the gate: ${summary}`);
    }
    expect(result.ok).toBe(true);
  });

  test("unit-file contents are non-empty (sanity)", () => {
    for (const unit of REQUIRED_UNIT_FILES) {
      const body = readFileSync(resolve(SYSTEMD_DIR, unit), "utf8");
      expect(body.length).toBeGreaterThan(0);
    }
  });
});

describe("checkMacosSandboxProfile (pure)", () => {
  test("deny-default profile + plist that wraps it via sandbox-exec → ok", () => {
    const result = checkMacosSandboxProfile({ profileBody: GOOD_PROFILE, plistBody: GOOD_PLIST });
    expect(result.ok).toBe(true);
  });

  test("missing profile body → fail naming the absent profile", () => {
    const result = checkMacosSandboxProfile({ profileBody: undefined, plistBody: GOOD_PLIST });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems.some((p) => p.includes("missing or empty"))).toBe(true);
    }
  });

  test("allow-default profile (no `(deny default)`) → fail (fail-safe defaults)", () => {
    const allowDefault = "(version 1)\n(allow default)\n";
    const result = checkMacosSandboxProfile({ profileBody: allowDefault, plistBody: GOOD_PLIST });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems.some((p) => p.includes(SBPL_DENY_DEFAULT))).toBe(true);
    }
  });

  test("plist that does not invoke sandbox-exec → fail", () => {
    const barePlist = [
      "<array>",
      "  <string>/bin/bash</string>",
      `  <string>\${MINSKY_HOME}/distribution/launchd/${MACOS_SANDBOX_PROFILE}</string>`,
      "</array>",
    ].join("\n");
    const result = checkMacosSandboxProfile({ profileBody: GOOD_PROFILE, plistBody: barePlist });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems.some((p) => p.includes("sandbox-exec"))).toBe(true);
    }
  });

  test("plist invokes sandbox-exec but references a different profile → fail", () => {
    const wrongRef = [
      "<array>",
      "  <string>/usr/bin/sandbox-exec</string>",
      "  <string>-f</string>",
      `  <string>\${MINSKY_HOME}/distribution/launchd/com.minsky.OTHER.sb</string>`,
      "  <string>/bin/bash</string>",
      "</array>",
    ].join("\n");
    const result = checkMacosSandboxProfile({ profileBody: GOOD_PROFILE, plistBody: wrongRef });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems.some((p) => p.includes("does not reference"))).toBe(true);
    }
  });

  test("exported constants name the macOS slice's files", () => {
    expect(MACOS_SANDBOX_PROFILE).toBe("com.minsky.tick-loop.sb");
    expect(MACOS_TICK_LOOP_PLIST).toBe("com.minsky.tick-loop.plist");
    expect(SBPL_DENY_DEFAULT).toBe("(deny default)");
  });
});

describe("real macOS sandbox slice under distribution/launchd/", () => {
  test("shipped .sb profile + plist pass the macOS gate", () => {
    const profileBody = readFileSync(resolve(LAUNCHD_DIR, MACOS_SANDBOX_PROFILE), "utf8");
    const plistBody = readFileSync(resolve(LAUNCHD_DIR, MACOS_TICK_LOOP_PLIST), "utf8");
    const result = checkMacosSandboxProfile({ profileBody, plistBody });
    if (!result.ok) {
      throw new Error(`shipped macOS sandbox slice fails the gate: ${result.problems.join("; ")}`);
    }
    expect(result.ok).toBe(true);
  });

  test("shipped .sb profile opens with the SBPL version + deny-default header", () => {
    const profileBody = readFileSync(resolve(LAUNCHD_DIR, MACOS_SANDBOX_PROFILE), "utf8");
    expect(profileBody).toContain("(version 1)");
    expect(profileBody).toContain(SBPL_DENY_DEFAULT);
  });
});

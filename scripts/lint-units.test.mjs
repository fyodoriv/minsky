// Test harness for `distribution/lint-units.sh`.
//
// Pattern: shell-script smoke test — a fixture-based unit test that
// invokes the script under different inputs and asserts on the exit code
// and stderr/stdout. Conformance: full (Bashir et al. *Software Engineering
// at Google* 2020, ch. "Testing Overview", §"Testing Shell Scripts").
//
// Why this exists: `lint-units.sh` regressed twice in 2026-05 — first by
// demanding `Restart=` on Type=oneshot services (which by design exit and
// must NOT be restarted), then by rejecting `${HOME}` in plists (which is
// a documented placeholder substituted by setup.sh + launchd). Both
// regressions broke CI on main for hours because no test pinned the
// expected behaviour. This file pins it.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SCRIPT_PATH = fileURLToPath(new URL("../distribution/lint-units.sh", import.meta.url));

/**
 * Run `lint-units.sh` against a synthetic distribution/ tree.
 * Returns { exitCode, stdout, stderr }.
 *
 * The script computes ROOT from `$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)`
 * — so to exercise it against a fixture, we symlink the script into the
 * fixture directory and run it from there.
 */
function runAgainstFixture({ systemd = {}, launchd = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "lint-units-fixture-"));
  try {
    mkdirSync(join(dir, "systemd"));
    mkdirSync(join(dir, "launchd"));
    for (const [name, content] of Object.entries(systemd)) {
      writeFileSync(join(dir, "systemd", name), content);
    }
    for (const [name, content] of Object.entries(launchd)) {
      writeFileSync(join(dir, "launchd", name), content);
    }
    // Read the real script and write a copy into the fixture so ROOT
    // resolves to `dir`.
    const scriptCopy = join(dir, "lint-units.sh");
    const original = execFileSync("cat", [SCRIPT_PATH], { encoding: "utf-8" });
    writeFileSync(scriptCopy, original, { mode: 0o755 });
    try {
      const stdout = execFileSync("bash", [scriptCopy], {
        encoding: "utf-8",
      });
      return { exitCode: 0, stdout, stderr: "" };
    } catch (/** @type {any} */ err) {
      return {
        exitCode: err.status ?? 1,
        stdout: err.stdout?.toString() ?? "",
        stderr: err.stderr?.toString() ?? "",
      };
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const SERVICE_TEMPLATE = `[Unit]
Description=Test service
[Service]
Type=simple
ExecStart=/bin/true
Restart=always
`;

const ONESHOT_TEMPLATE = `[Unit]
Description=Test oneshot
[Service]
Type=oneshot
ExecStart=/bin/true
`;

const PLIST_TEMPLATE = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.test.thing</string>
</dict>
</plist>
`;

describe("lint-units.sh", () => {
  it("passes a well-formed simple service with Restart=", () => {
    const result = runAgainstFixture({
      systemd: { "test.service": SERVICE_TEMPLATE },
    });
    expect(result.exitCode).toBe(0);
  });

  it("passes a Type=oneshot service WITHOUT Restart= (regression: main 2026-05-21)", () => {
    // The previous lint demanded Restart= on every .service, which is wrong
    // for oneshots. Pinning the corrected behaviour here.
    const result = runAgainstFixture({
      systemd: { "oneshot.service": ONESHOT_TEMPLATE },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("✓ oneshot.service");
  });

  it("fails a simple (non-oneshot) service WITHOUT Restart=", () => {
    const noRestart = SERVICE_TEMPLATE.replace("Restart=always\n", "");
    const result = runAgainstFixture({
      systemd: { "no-restart.service": noRestart },
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("missing Restart=");
  });

  it("passes ${MINSKY_HOME} placeholder", () => {
    const plistWithMinskyHome = PLIST_TEMPLATE.replace(
      "</dict>",
      "    <key>WorkingDirectory</key>\n    <string>${MINSKY_HOME}</string>\n</dict>",
    );
    const result = runAgainstFixture({
      launchd: { "minsky-home.plist": plistWithMinskyHome },
    });
    expect(result.exitCode).toBe(0);
  });

  it("passes ${HOME} placeholder (regression: main 2026-05-21)", () => {
    // The previous lint only allowed ${MINSKY_HOME} and rejected ${HOME},
    // breaking the auto-merge plist that uses ${HOME}/.minsky/auto-merge.log.
    const plistWithHome = PLIST_TEMPLATE.replace(
      "</dict>",
      "    <key>StandardOutPath</key>\n    <string>${HOME}/.minsky/log</string>\n</dict>",
    );
    const result = runAgainstFixture({
      launchd: { "with-home.plist": plistWithHome },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("✓ with-home.plist");
  });

  it("fails an undocumented placeholder like ${USER}", () => {
    const plistWithUser = PLIST_TEMPLATE.replace(
      "</dict>",
      "    <key>UserName</key>\n    <string>${USER}</string>\n</dict>",
    );
    const result = runAgainstFixture({
      launchd: { "with-user.plist": plistWithUser },
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("undocumented placeholder");
  });
});

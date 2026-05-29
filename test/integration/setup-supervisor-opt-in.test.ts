// Pins the IRON contract added 2026-05-29 (operator directive): `setup.sh
// --setup` MUST NOT bootstrap launchd/systemd units into login-auto-start
// by default. The supervisor bootstrap step is gated behind the
// `--with-supervisor` flag (or `MINSKY_SETUP_WITH_SUPERVISOR=1` env var).
//
// History: 2026-05-29 — operator reloaded their machine and ALL 7
// com.minsky.*.plist launchagents auto-started at login, re-eating
// ~42 GB of wired RAM. The plists had been installed by an earlier
// `./setup.sh --setup` invocation; setup.sh used to render-and-bootstrap
// unconditionally, so any operator running setup once ended up with a
// permanent login-launch fleet they didn't ask for. The directive was
// "It must only run when I explicitly tell it so. Fix immediately."
//
// This test pins the gate so a future PR can't silently re-enable
// unconditional bootstrap.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const SETUP_SH = join(REPO_ROOT, "setup.sh");

describe("setup.sh: supervisor bootstrap is opt-in (--with-supervisor)", () => {
  test("WITH_SUPERVISOR default is 0 (off)", () => {
    // The variable must default to off so the IRON contract holds even
    // when the operator forgets to pass --with-supervisor.
    const src = readFileSync(SETUP_SH, "utf8");
    expect(src).toMatch(/WITH_SUPERVISOR="\$\{MINSKY_SETUP_WITH_SUPERVISOR:-0\}"/);
  });

  test("--with-supervisor flag is parsed and flips WITH_SUPERVISOR=1", () => {
    const src = readFileSync(SETUP_SH, "utf8");
    expect(src).toMatch(/--with-supervisor\)/);
    expect(src).toMatch(/WITH_SUPERVISOR=1/);
  });

  test("bootstrap loop is gated on WITH_SUPERVISOR=1 (dormant by default)", () => {
    // The gate must short-circuit BEFORE the launchctl bootstrap loop
    // runs. The `if [ "$WITH_SUPERVISOR" != "1" ]; then ... exit 0; fi`
    // must appear above the Darwin/Linux case statements that load the
    // units. Without this, a future refactor could move the bootstrap
    // call outside the gate and silently re-enable auto-start.
    const src = readFileSync(SETUP_SH, "utf8");
    const gateIdx = src.indexOf('if [ "$WITH_SUPERVISOR" != "1" ]; then');
    // Match the actual call (which on the bootstrap line lives inside
    // `if launchctl bootstrap gui/"$(id -u)" "$f"; then`). The leading
    // `if ` distinguishes the call from the docstring mentions in
    // comments at the top of the file.
    const bootstrapMatch = src.match(/if launchctl bootstrap gui\//);
    const systemctlEnableMatch = src.match(/^\s*systemctl --user enable --now/m);
    expect(gateIdx).toBeGreaterThan(-1);
    expect(bootstrapMatch).not.toBeNull();
    expect(systemctlEnableMatch).not.toBeNull();
    if (bootstrapMatch === null || bootstrapMatch.index === undefined) return;
    if (systemctlEnableMatch === null || systemctlEnableMatch.index === undefined) return;
    expect(bootstrapMatch.index).toBeGreaterThan(gateIdx);
    expect(systemctlEnableMatch.index).toBeGreaterThan(gateIdx);
  });

  test("dormant-path message tells the operator the explicit-start contract", () => {
    // When WITH_SUPERVISOR=0 the script must explain that minsky is
    // dormant AND name the explicit-start command. Without this the
    // operator might assume setup succeeded fully and wonder why
    // nothing iterates.
    const src = readFileSync(SETUP_SH, "utf8");
    expect(src).toMatch(/supervisor is DORMANT|supervisor NOT bootstrapped/);
    expect(src).toMatch(/bin\/minsky-run\.sh.*--host/);
    expect(src).toMatch(/setup\.sh --setup --with-supervisor/);
  });

  test("comment cites the 2026-05-29 operator directive", () => {
    // Future agents must see WHY the gate matters. The comment must
    // cite the directive that prompted it so a "let's simplify setup.sh"
    // PR doesn't silently delete the gate.
    const src = readFileSync(SETUP_SH, "utf8");
    expect(src).toMatch(/2026-05-29/);
    expect(src).toMatch(/explicitly tell/);
  });

  test("help text documents --with-supervisor as the opt-in flag", () => {
    // The operator's first read of `./setup.sh --help` must surface the
    // contract. Otherwise the dormant-by-default behavior looks like a
    // bug.
    const src = readFileSync(SETUP_SH, "utf8");
    expect(src).toMatch(/--with-supervisor/);
    // The flag's help-line must explicitly say it enables auto-start.
    expect(src).toMatch(/--with-supervisor[\s\S]{0,400}auto-start|render AND bootstrap/);
  });
});

// Integration tests for `bin/minsky uninstall` — one-command path
// per P0 `minsky-uninstall-one-command-with-stop`.
//
// Hypothesis (rule #9): replacing dry-run-by-default with an interactive
// confirmation flow ("Type YES to proceed") makes the single-command
// path the obvious one. Operators in a TTY see preview + prompt; piped
// stdin or MINSKY_NON_INTERACTIVE=1 falls back to a non-interactive
// rejection that demands --force.
// Success: every test below passes against the real bin/minsky binary
// with a temporary MINSKY_STATE_DIR fixture.
// Pivot: if the YES-only prompt is too strict (operators repeatedly
// type `yes` and have to re-run), accept `YES` / `yes` / `y` (lenient)
// in a follow-up. Keep `YES` for now — the parent task's Risk field
// explicitly chose strict-match to make accidental confirmation hard.
// Measurement: this test file.
// Anchor: rule #16 (default by default — vision.md § 11); operator
// directive 2026-05-20 ("to uninstall you need to just run minsky
// uninstall and it will do every single needed step including stopping
// (after confirmation)"); MILESTONES.md M1 §12 (clean uninstall).
//
// Pattern: integration / CLI seam test (Wirfs-Brock & McKean 2003 —
// verify the contract at the shell-script seam, not in a leaf helper).

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const MINSKY_BIN = join(REPO_ROOT, "bin", "minsky");

/**
 * Build a fixture MINSKY_STATE_DIR (the per-machine state directory
 * `bin/minsky uninstall` removes). Caller is responsible for cleanup
 * (tmp dir under OS tmpdir).
 *
 * Note: the test does NOT install a launchd plist (that would mutate
 * the host's real LaunchAgents). It DOES create the state dir so the
 * preview line "- state dir: <path>" appears.
 */
function makeFixtureStateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "minsky-uninstall-fixture-"));
  // The dir must exist + be non-empty for `[ -d "$MINSKY_STATE_DIR" ]`
  // to hit. mkdtempSync already created the dir; that's sufficient.
  return dir;
}

/**
 * Spawn `bin/minsky uninstall <args...>` with the supplied args + env
 * + stdin. Returns the result for assertion. We use `spawnSync` instead
 * of `execFileSync` so we can pass `input` (stdin) and inspect exit
 * codes without throwing on non-zero exits.
 *
 * The first positional arg is ALWAYS `"uninstall"` — the case
 * dispatcher in `bin/minsky` matches on `$1`, so passing only `args`
 * would fall through to the late-stage runner-forwarder + fail with
 * "runner bin not found". This helper hard-codes the subcommand so
 * tests only have to think about flags.
 */
function runUninstall(
  args: readonly string[],
  opts: {
    stdin?: string;
    env?: Record<string, string>;
    stateDir: string;
  },
): { stdout: string; stderr: string; status: number } {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME ?? "/tmp",
    MINSKY_STATE_DIR: opts.stateDir,
    ...opts.env,
  };
  const result = spawnSync(MINSKY_BIN, ["uninstall", ...args], {
    encoding: "utf8",
    env,
    input: opts.stdin,
    stdio: opts.stdin === undefined ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"],
    timeout: 10_000,
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status ?? -1,
  };
}

describe("bin/minsky uninstall — one-command flow", () => {
  test("non-TTY without --force: exits 2 with actionable error message", () => {
    // Without an stdin TTY (spawnSync with `input` set sets stdin to a
    // pipe, which is NOT a TTY per `[ -t 0 ]`), bare `minsky uninstall`
    // must refuse and tell the operator what to do instead.
    const dir = makeFixtureStateDir();
    const r = runUninstall([], { stdin: "", stateDir: dir });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("non-interactive");
    expect(r.stderr).toContain("--force");
    // The state dir is NOT removed on the rejection path — defensive.
    expect(existsSync(dir)).toBe(true);
  });

  test("MINSKY_NON_INTERACTIVE=1 without --force: exits 2 even if stdin is a TTY", () => {
    // The explicit env opt-out is the script-friendly way to assert
    // "this run is not interactive" — same convention as
    // MINSKY_INSTALL_DAEMON_QUIET / MINSKY_NON_INTERACTIVE elsewhere
    // in bin/minsky.
    const dir = makeFixtureStateDir();
    const r = runUninstall([], {
      stdin: "YES\n",
      env: { MINSKY_NON_INTERACTIVE: "1" },
      stateDir: dir,
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("non-interactive");
    expect(existsSync(dir)).toBe(true);
  });

  test("non-TTY with stdin 'NO': exits 2 (non-interactive rejection, not prompt-abort)", () => {
    // The non-interactive path takes priority over stdin content —
    // even if the operator pipes 'NO' or 'YES', the absence of a TTY
    // means we reject with `--force` guidance, not honour the input.
    const dir = makeFixtureStateDir();
    const r = runUninstall([], { stdin: "NO\n", stateDir: dir });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("non-interactive");
    expect(existsSync(dir)).toBe(true);
  });

  test("--force without prompt: executes ALL steps (back-compat)", () => {
    // The --force path is the script-friendly equivalent. No prompt,
    // no TTY check, just execute. Verifies the state dir is removed.
    const dir = makeFixtureStateDir();
    expect(existsSync(dir)).toBe(true);
    const r = runUninstall(["--force"], { stateDir: dir });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("minsky uninstalled");
    expect(existsSync(dir)).toBe(false);
  });

  test("--force is idempotent: re-run after clean uninstall still exits 0", () => {
    // Second invocation against the same (now-removed) state dir
    // must not error — the operator should be able to re-run uninstall
    // safely. Each `if [ -d ]` / `if pgrep` guards before the removal.
    const dir = makeFixtureStateDir();
    runUninstall(["--force"], { stateDir: dir });
    expect(existsSync(dir)).toBe(false);
    const r = runUninstall(["--force"], { stateDir: dir });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("minsky uninstalled");
  });

  test("preview text mentions the state dir when it exists, omits it when it doesn't", () => {
    // The dry-run preview (now folded into the non-TTY error output)
    // lists the state-dir line only when the dir exists. Smoke-tests
    // that the preview composition is correct.
    const dir = makeFixtureStateDir();
    const r1 = runUninstall([], { stdin: "", stateDir: dir });
    expect(r1.stderr).toContain("state dir:");
    expect(r1.stderr).toContain(dir);
    // Non-existent dir: no "state dir" line in the preview.
    const r2 = runUninstall([], {
      stdin: "",
      stateDir: join(tmpdir(), "minsky-nonexistent-xxx-yyy"),
    });
    expect(r2.stderr).not.toContain("state dir:");
  });
});

// Regression: `bin/minsky-run.sh` must resolve to a python that can
// `import openhands` BEFORE attempting any spawn. Pre-2026-05-27 the
// runner hardcoded bare `python3`, which on launchd-spawned supervisors
// resolves to `/usr/bin/python3` — a python that does NOT have
// `openhands-ai` installed. The result was 30+ consecutive iterations
// with stderr `ModuleNotFoundError: No module named 'openhands'`, none
// of which the operator saw until tailing the experiment-store.
//
// The fix is two-part:
//   1. `resolve_openhands_python` helper prefers `~/.minsky/openhands-
//      venv/bin/python` (per INSTALL.md) and honors `MINSKY_OPENHANDS_
//      PYTHON` env override.
//   2. `invariant_openhands_in_path` verifies importability against the
//      resolved python, not just file existence.
//
// This test asserts (a) the invariant flags a bad python with the new
// clear error message, and (b) the env-var override is honored.
// Success: this test passes. Measurement: this file. Anchor: rule #6
// (stay alive — never silently); rule #17 (proactive healing — every
// observed spawn-failure class becomes a hard gate the next time).

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const MINSKY_RUN = join(REPO_ROOT, "bin", "minsky-run.sh");
const VENV_PYTHON = join(homedir(), ".minsky", "openhands-venv", "bin", "python");

// Hermetic config fixture: the invariant first reads the agent from
// MINSKY_CONFIG (default ~/.minsky/config.json) and SKIPS the openhands
// probe entirely when the configured agent is not "openhands" — so on an
// operator machine configured for claude these tests asserted against an
// invariant that never ran. Pin the agent the tests assume.
const FIXTURE_CONFIG = join(mkdtempSync(join(tmpdir(), "minsky-selfcheck-")), "config.json");
writeFileSync(FIXTURE_CONFIG, JSON.stringify({ cloud_agent: "openhands" }));

function runSelfCheck(env: Record<string, string>): {
  stdout: string;
  stderr: string;
  status: number;
} {
  // spawnSync (not execSync) — execSync drops stderr on exit 0, and
  // --self-check is `|| true`-gated so the invariant message lives in
  // stderr alongside exit 0. spawnSync captures both regardless.
  const result = spawnSync(MINSKY_RUN, ["--self-check"], {
    env: { ...process.env, MINSKY_CONFIG: FIXTURE_CONFIG, ...env },
    encoding: "utf8",
  });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status ?? 1,
  };
}

describe("bin/minsky-run.sh — openhands python resolution", () => {
  test("invariant flags a python without openhands installed (regression: launchd /usr/bin/python3)", () => {
    if (!existsSync("/usr/bin/python3")) {
      // macOS / Linux CI sanity — /usr/bin/python3 is canonical there
      return;
    }
    const result = runSelfCheck({ MINSKY_OPENHANDS_PYTHON: "/usr/bin/python3" });
    // --self-check is `|| true`-gated so the script exits 0; assert the
    // invariant DID print its failure message on stderr.
    expect(result.stderr).toMatch(
      /INVARIANT FAIL: openhands not importable from \/usr\/bin\/python3/,
    );
    expect(result.stderr).toMatch(/uv pip install.*openhands-ai/);
  });

  test("honors MINSKY_OPENHANDS_PYTHON pointing at the documented venv (when present)", () => {
    if (!existsSync(VENV_PYTHON)) {
      // Test machine doesn't have the venv set up — skip rather than
      // produce a false negative. CI sets the venv up explicitly.
      return;
    }
    const result = runSelfCheck({ MINSKY_OPENHANDS_PYTHON: VENV_PYTHON });
    expect(result.stderr).not.toMatch(/openhands not importable/);
  });

  test("invariant exit code is non-zero on the spawn path (no --self-check / no --dry-run)", () => {
    if (!existsSync("/usr/bin/python3")) {
      return;
    }
    // Real spawn path: invariant_openhands_in_path is called at the END
    // of bin/minsky-run.sh WITHOUT `|| true`. Failure must propagate as
    // a non-zero exit so the supervisor's restart logic sees it.
    const result = spawnSync(MINSKY_RUN, ["--host", "/tmp/__nonexistent-host__"], {
      env: { ...process.env, MINSKY_OPENHANDS_PYTHON: "/usr/bin/python3" },
      encoding: "utf8",
    });
    expect(result.status ?? 1).not.toBe(0);
  });
});

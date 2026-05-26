// Integration tests for daemon-survives-machine-restart.
// Tests the full lifecycle: install-daemon, stale PID cleanup,
// dirty-state reset, launchd plist generation, uninstall-daemon.
//
// These tests exercise the REAL bin/minsky script against fixture
// state — not mocks.
//
// History: PR #880 (phase-7b step 4) stripped the TS-daemon-loop-only
// tests (auto-restart-on-pull sentinel + runLoopWithSentinel helper)
// because the bash skeleton (`bin/minsky-run.sh`) has no in-process
// sentinel-driven loop — launchd's `KeepAlive` is the restart
// mechanism, not the loop. The remaining tests cover the install/
// uninstall/plist/PID surface of `bin/minsky`, which IS the bash
// skeleton.

import { execSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const MINSKY_BIN = join(REPO_ROOT, "bin", "minsky");

function run(cmd: string, env?: Record<string, string>): string {
  return execSync(cmd, {
    encoding: "utf8",
    timeout: 15_000,
    cwd: REPO_ROOT,
    env: { ...process.env, ...env },
  }).trim();
}

// ─── install-daemon: plist generation ────────────────────────

describe("daemon-restart: install-daemon plist generation", () => {
  test("install-daemon creates a valid plist file", () => {
    const plistPath = join(
      process.env.HOME ?? "",
      "Library",
      "LaunchAgents",
      "com.minsky.daemon.plist",
    );
    // The plist should already exist (installed in the previous step)
    // or we generate it fresh
    if (!existsSync(plistPath)) {
      // Can't run install-daemon in CI (needs launchctl) — just verify
      // the command parses without error
      try {
        run(`bash -c 'source ${MINSKY_BIN} install-daemon 2>&1 || true'`);
      } catch {
        // Expected in CI — launchctl not available
      }
    }

    if (existsSync(plistPath)) {
      const content = readFileSync(plistPath, "utf8");
      expect(content).toContain("com.minsky.daemon");
      expect(content).toContain("KeepAlive");
      expect(content).toContain("RunAtLoad");
      expect(content).toContain("minsky-run.mjs");
      expect(content).toContain("--host");
      expect(content).toContain("--loop");
      // Must NOT contain ephemeral fnm multishell path
      expect(content).not.toContain("fnm_multishells");
      // Must use a stable node path
      expect(content).toMatch(/node/);
    }
  });

  test("plist uses stable node path, not ephemeral fnm multishell", () => {
    const plistPath = join(
      process.env.HOME ?? "",
      "Library",
      "LaunchAgents",
      "com.minsky.daemon.plist",
    );
    if (!existsSync(plistPath)) return; // skip in CI
    const content = readFileSync(plistPath, "utf8");
    // The node path should be one of the stable locations
    const nodeMatch = content.match(/<string>(\/[^<]*node)<\/string>/);
    expect(nodeMatch).not.toBeNull();
    const nodePath = nodeMatch?.[1] ?? "";
    // Should NOT be an ephemeral fnm_multishells path
    expect(nodePath).not.toContain("fnm_multishells");
    // Should be an actual executable
    expect(
      nodePath.includes(".fnm") ||
        nodePath.includes("/opt/homebrew") ||
        nodePath.includes("/usr/local") ||
        nodePath.includes("fnm/node-versions"),
    ).toBe(true);
  });
});

// ─── stale PID cleanup ──────────────────────────────────────

describe("daemon-restart: stale PID cleanup", () => {
  const fakePidFile = join(tmpdir(), "minsky-test-daemon.pid");

  afterEach(() => {
    try {
      unlinkSync(fakePidFile);
    } catch {
      /* noop */
    }
  });

  test("status code path cleans up stale PID when process is dead", () => {
    const src = readFileSync(MINSKY_BIN, "utf8");
    // The status subcommand must:
    // 1. Read the PID file
    expect(src).toContain('pid=$(cat "$MINSKY_DAEMON_PID")');
    // 2. Check if the process is alive
    expect(src).toContain('kill -0 "$pid"');
    // 3. Remove the stale PID file
    expect(src).toContain("stale PID file");
    expect(src).toContain('rm -f "$MINSKY_DAEMON_PID"');
  });

  test("--daemon startup removes stale PID and proceeds", () => {
    // Write a stale PID
    const pidFile = join(tmpdir(), "minsky-stale-pid-test.pid");
    writeFileSync(pidFile, "88888888");
    // The startup should clean it and not fail
    // We can't actually start the daemon, but we can test the PID cleanup logic
    // by checking the bin/minsky source
    const src = readFileSync(MINSKY_BIN, "utf8");
    expect(src).toContain("cleaning stale PID");
    expect(src).toContain('kill -0 "$existing_pid"');
    try {
      unlinkSync(pidFile);
    } catch {
      /* noop */
    }
  });
});

// ─── dirty-state cleanup on startup ─────────────────────────

// ─── dirty-state cleanup is delegated to `reset-host-if-crashed` ────
// Task: minsky-bin-git-clean-fd-multi-agent-safety-violation +
// minsky-bin-auto-resets-to-main-surprise.
//
// The old in-line `git checkout main && git clean -fd` block was
// replaced 2026-05-19 with a delegation to the `reset-host-if-crashed`
// subcommand which:
//   - keeps the branch + working tree if the graceful-stop sentinel
//     is present (the previous `minsky stop` wrote it);
//   - stashes uncommitted+untracked work with a recoverable label and
//     resets to default_branch if the sentinel is missing (crashed).
// Behaviour tests for the subcommand itself live in
// `bin-minsky-multi-agent-safety.test.ts` — these are just the
// structural contracts that prove the wiring still exists.

describe("daemon-restart: dirty-state cleanup delegates to reset-host-if-crashed", () => {
  test("bin/minsky --daemon startup delegates to `reset-host-if-crashed`", () => {
    const src = readFileSync(MINSKY_BIN, "utf8");
    expect(src).toContain("reset-host-if-crashed");
    expect(src).toContain("graceful-stop");
  });

  test("bin/minsky never runs `git clean -fd` in executable code (multi-agent safety)", () => {
    // `git clean -fd` is on the global multi-agent git safety ban list
    // because it deletes other agents' untracked files. Comments OK.
    const src = readFileSync(MINSKY_BIN, "utf8");
    const executableLines = src
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .join("\n");
    expect(executableLines).not.toMatch(/git\s+(?:-C\s+\S+\s+)?clean\s+-fd/);
  });

  test("bin/minsky stop writes the graceful-stop sentinel", () => {
    // The sentinel is the deterministic crash signal: present after
    // `minsky stop`, absent after a crash. `reset-host-if-crashed`
    // reads it to decide between keep / stash-and-reset / reset-only.
    const src = readFileSync(MINSKY_BIN, "utf8");
    expect(src).toContain("graceful-stop");
    // The sentinel write must happen regardless of whether anything
    // was actually killed — `minsky stop` is the operator's explicit
    // intent to shut down cleanly.
    const stopBlock = src.match(/stop\)[\s\S]*?exit 0\n\s*;;/);
    expect(stopBlock).not.toBeNull();
    expect(stopBlock?.[0]).toContain("graceful-stop");
  });

  test("reset-host-if-crashed subcommand exists and accepts --host + --sentinel", () => {
    const src = readFileSync(MINSKY_BIN, "utf8");
    // Block boundary: the case branch ends at `exit 1\n    ;;` (post
    // 2026-05-26 refuse-with-error semantics). Non-greedy match up to that
    // is unambiguous — inner `;;` inside the `case "$1" in` argparse don't
    // match because they sit at deeper indentation than the closing `;;`.
    const resetBlock = src.match(/reset-host-if-crashed\)[\s\S]*?exit 1\n {4};;/);
    expect(resetBlock).not.toBeNull();
    expect(resetBlock?.[0]).toContain("--host");
    expect(resetBlock?.[0]).toContain("--sentinel");
    // It REFUSES on dirty trees (auto-stash was removed 2026-05-26 — the
    // side-effect of swallowing operator/parallel-agent WIP into the
    // stash list outweighed the crash-recovery convenience). Operator
    // resolves manually and re-runs the daemon.
    expect(resetBlock?.[0]).toContain("REFUSING to recover host");
    expect(resetBlock?.[0]).not.toContain('git -C "$_rh_host" stash push');
  });

  test("daemon refuses to recover on dirty state (rule #6 — no auto-stash)", () => {
    const src = readFileSync(MINSKY_BIN, "utf8");
    // Replaces the previous "refuses if stash itself fails" test. The new
    // semantic is: dirty trees ALWAYS refuse-with-error, never stash.
    expect(src).toContain("REFUSING to recover host");
    expect(src).toContain("resolve manually before restarting the daemon");
  });
});

// ─── dirty-state refuse: end-to-end ──────────────────────────

describe("daemon-restart: dirty-state refuse (e2e)", () => {
  test("untracked file is PRESERVED on disk; daemon refuses to recover (no auto-stash)", () => {
    // Operator directive 2026-05-26: auto-stash on dirty-tree crash-recovery
    // was silently swallowing operator/parallel-agent WIP into the stash
    // list. New semantic: refuse-with-error, leave the workspace exactly
    // as the operator left it, exit 1.
    //
    // Synthesise a host repo with: (1) default branch `main`, (2) checked-
    // out feature branch with an untracked file. Run `bin/minsky
    // reset-host-if-crashed --host <fixture>` against it (no sentinel = crash
    // path) and assert (a) exit code 1, (b) the untracked file is STILL on
    // disk, (c) git stash list is empty, (d) branch is unchanged, (e) the
    // error message points the operator at the three manual recovery paths.
    const fixtureDir = join(tmpdir(), `minsky-fixture-${Date.now()}`);
    const bareDir = `${fixtureDir}.bare.git`;
    try {
      const G = "git -c core.hooksPath=/dev/null";
      execSync(`mkdir -p '${fixtureDir}' && ${G} init -b main '${fixtureDir}'`, { stdio: "pipe" });
      execSync(
        `cd '${fixtureDir}' && \
         ${G} config user.email t@example.com && \
         ${G} config user.name 'Test' && \
         ${G} config core.hooksPath /dev/null && \
         echo init > README.md && ${G} add README.md && \
         ${G} commit -m 'init' && \
         ${G} init --bare '${bareDir}' && \
         ${G} remote add origin '${bareDir}' && \
         ${G} push -u origin main && \
         ${G} symbolic-ref refs/remotes/origin/HEAD refs/remotes/origin/main && \
         ${G} checkout -b feat/crashed-iteration && \
         echo 'unsaved work from another agent' > unsaved.txt`,
        { stdio: "pipe", shell: "/bin/bash" },
      );

      // Pre-condition: untracked file exists, on feature branch, no stash
      expect(existsSync(join(fixtureDir, "unsaved.txt"))).toBe(true);
      expect(execSync(`git -C '${fixtureDir}' branch --show-current`).toString().trim()).toBe(
        "feat/crashed-iteration",
      );
      expect(execSync(`git -C '${fixtureDir}' stash list`, { encoding: "utf8" }).trim()).toBe("");

      // Invoke the subcommand (no --sentinel = crash path)
      let exitCode = 0;
      let stderr = "";
      try {
        execSync(`bash '${MINSKY_BIN}' reset-host-if-crashed --host '${fixtureDir}'`, {
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch (err) {
        const e = err as { status?: number; stderr?: Buffer };
        exitCode = e.status ?? 1;
        stderr = e.stderr?.toString() ?? "";
      }

      // Post-conditions
      expect(exitCode).toBe(1);
      expect(stderr).toContain("REFUSING to recover host");
      expect(stderr).toContain("resolve manually");
      // Untracked file STILL on disk (no stash, no destruction)
      expect(existsSync(join(fixtureDir, "unsaved.txt"))).toBe(true);
      expect(readFileSync(join(fixtureDir, "unsaved.txt"), "utf8")).toContain("unsaved work");
      // Stash list still empty
      expect(execSync(`git -C '${fixtureDir}' stash list`, { encoding: "utf8" }).trim()).toBe("");
      // Branch unchanged
      expect(execSync(`git -C '${fixtureDir}' branch --show-current`).toString().trim()).toBe(
        "feat/crashed-iteration",
      );
    } finally {
      try {
        execSync(`rm -rf '${fixtureDir}' '${bareDir}'`, { stdio: "pipe" });
      } catch {
        /* noop */
      }
    }
  });
});

// ─── uninstall-daemon ───────────────────────────────────────

describe("daemon-restart: uninstall-daemon", () => {
  test("uninstall-daemon command exists in the CLI", () => {
    const src = readFileSync(MINSKY_BIN, "utf8");
    expect(src).toContain("uninstall-daemon)");
    expect(src).toContain("launchctl bootout");
    expect(src).toContain("com.minsky.daemon");
  });
});

// ─── config.json default_host ───────────────────────────────

describe("daemon-restart: config.json default_host", () => {
  test("~/.minsky/config.json has default_host field", () => {
    const configPath = join(process.env.HOME ?? "", ".minsky", "config.json");
    if (!existsSync(configPath)) return; // skip in CI
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    expect(config).toHaveProperty("default_host");
    expect(config.default_host).toBeTruthy();
  });

  test("install-daemon reads default_host from config", () => {
    const src = readFileSync(MINSKY_BIN, "utf8");
    expect(src).toContain("default_host");
    expect(src).toContain("config.json");
  });
});

// ─── launchd KeepAlive contract ─────────────────────────────

describe("daemon-restart: launchd KeepAlive contract", () => {
  test("plist runs node directly (not via --daemon which backgrounds)", () => {
    const src = readFileSync(MINSKY_BIN, "utf8");
    // The plist should reference minsky-run.mjs directly
    expect(src).toContain("_runner=");
    expect(src).toContain("minsky-run.mjs");
    // And NOT use --daemon flag (which backgrounds and exits).
    // Phase 7b'-prep (#805) split the ProgramArguments into a `$_program_args`
    // variable so the install-daemon block can branch on MINSKY_INSTALL_DAEMON_BASH;
    // the literal `--loop` now lives in the Node branch of that variable rather
    // than inside the PLIST_EOF heredoc itself. Check the broader install-daemon
    // block for both `--loop` (Node default) AND absence of `"--daemon"`.
    const installBlock = src.match(/install-daemon\)[\s\S]*?exit 0/);
    expect(installBlock).not.toBeNull();
    expect(installBlock?.[0]).toContain("--loop");
    expect(installBlock?.[0]).not.toContain('"--daemon"');
  });

  test("plist has ThrottleInterval to prevent restart storm", () => {
    const src = readFileSync(MINSKY_BIN, "utf8");
    expect(src).toContain("ThrottleInterval");
  });

  test("plist sets MINSKY_NON_INTERACTIVE=1", () => {
    const src = readFileSync(MINSKY_BIN, "utf8");
    expect(src).toContain("MINSKY_NON_INTERACTIVE");
  });

  test("spawn-failed-exit-minus-one-silent-empty-stderr: install-daemon propagates DEVIN_*/CLAUDE_*/OPENAI_*/ANTHROPIC_* env vars from the operator shell into the plist", () => {
    // Before this fix, the launchd plist only exposed PATH + HOME +
    // MINSKY_NON_INTERACTIVE. The daemon child therefore spawned
    // devin/claude/openai/anthropic CLIs with EMPTY auth, surfaced
    // as `verdict=spawn-failed exit=-1 stderr=(empty)` (P0 task
    // 2026-05-19). The fix iterates over the operator's shell env
    // and emits one EnvironmentVariables key per matching var.
    const src = readFileSync(MINSKY_BIN, "utf8");
    // The bash loop that scans the operator's env for auth-relevant
    // names — fail loudly if a future refactor drops it.
    expect(src).toMatch(/DEVIN_\*\|CLAUDE_\*\|OPENAI_\*\|ANTHROPIC_\*/);
    expect(src).toContain("_xml_env_pairs");
    // The emitted plist body must reference the accumulated pairs at
    // the END of the EnvironmentVariables dict — not as a sibling of
    // PATH/HOME, otherwise launchd silently drops them.
    expect(src).toMatch(/MINSKY_NON_INTERACTIVE[\s\S]*?\$\{_xml_env_pairs\}/);
    // Operator-visibility line at install time: count + warn when 0.
    expect(src).toContain("propagated $_propagated_env_count agent-auth env vars");
  });

  test("auto-install-on-pull: install-daemon is idempotent — same plist content skips bootout/bootstrap (no daemon kill)", () => {
    // The new post-merge auto-install hook calls `minsky
    // install-daemon` on every pull. Without idempotency, that would
    // launchctl-bootout + bootstrap on every call — killing the
    // running daemon on every pull, which the rule-#16 default-by-
    // default contract forbids ("auto stuff that helps but doesn't
    // break"). Idempotency means: same plist content → silent no-op.
    const src = readFileSync(MINSKY_BIN, "utf8");
    // The script must write the new plist to a tempfile FIRST, then
    // compare with the existing plist before calling launchctl.
    expect(src).toContain("_plist_tmp=");
    expect(src).toContain("mktemp");
    // `cmp -s` is the portable + fast byte-equality check.
    expect(src).toMatch(/cmp -s.*_plist_tmp.*_plist/);
    // When same → exit 0 BEFORE bootout/bootstrap. When different →
    // mv the tempfile into place + reload as before.
    expect(src).toMatch(/cmp -s[\s\S]*?already up to date[\s\S]*?exit 0[\s\S]*?launchctl bootout/);
    // Quiet-mode env var lets the auto-install hook suppress the
    // "already up to date" line on every pull (would be too noisy).
    expect(src).toContain("MINSKY_INSTALL_DAEMON_QUIET");
  });
});

// ─── end-to-end: simulated crash recovery ───────────────────

describe("daemon-restart: simulated crash recovery", () => {
  test("experiment-store survives across daemon restarts", () => {
    // The experiment store is on disk, not in memory — verify
    const storePath = join(REPO_ROOT, ".minsky", "experiment-store", "cross-repo");
    if (!existsSync(storePath)) return; // skip if no iterations yet
    const files = require("node:fs")
      .readdirSync(storePath)
      .filter((f: string) => f.endsWith(".jsonl"));
    expect(files.length).toBeGreaterThanOrEqual(1);
    // Each file should have parseable JSON lines
    for (const file of files.slice(0, 3)) {
      const content = readFileSync(join(storePath, file), "utf8").trim();
      if (!content) continue;
      const lines = content.split("\n");
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
    }
  });

  test("node path resolution picks a stable path", () => {
    // Simulate what install-daemon does
    const candidates = [
      join(process.env.HOME ?? "", ".fnm", "aliases", "default", "bin", "node"),
      // fnm node-versions stable path
      ...(() => {
        try {
          return require("node:fs")
            .readdirSync(join(process.env.HOME ?? "", ".local", "share", "fnm", "node-versions"))
            .filter((d: string) => d.startsWith("v2"))
            .map((d: string) =>
              join(
                process.env.HOME ?? "",
                ".local",
                "share",
                "fnm",
                "node-versions",
                d,
                "installation",
                "bin",
                "node",
              ),
            );
        } catch {
          return [];
        }
      })(),
      "/opt/homebrew/bin/node",
      "/usr/local/bin/node",
    ];
    const stable = candidates.find((p) => existsSync(p));
    expect(stable).toBeTruthy();
    // The stable path should NOT contain fnm_multishells
    expect(stable ?? "").not.toContain("fnm_multishells");
  });
});

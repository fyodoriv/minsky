// Unit tests for `scripts/post-merge-auto-install.mjs`. The script is a
// pure decision function (`decideActions`) over an env+filesystem
// snapshot + a thin I/O wrapper. Tests inject the snapshot directly;
// the wrapper itself is exercised by an integration smoke test.
//
// Pattern: pure decision over a snapshot, mirrors `auto-merge-clean-prs`
// (rule #2 + rule #10). Source: 2026-05-20 operator request "let's
// get stuff auto-installed on pull unless you override it".
//
// Hypothesis (rule #9): every operator who pulls a commit that touches
// `bin/minsky`'s install-daemon section gets the new plist deployed
// without a manual `minsky install-daemon` step. Success: 100% of
// post-merge runs that detect a relevant change emit the matching
// action; 100% of post-merge runs with `MINSKY_NO_AUTO_INSTALL=1`
// emit zero actions. Pivot: if the auto-install surfaces ≥1 broken
// install per month (e.g. plist regenerates wrong because we didn't
// account for a new auth env-var family), gate auto-install behind
// an opt-in env-var flip.

import { describe, expect, test } from "vitest";

import { decideActions } from "./post-merge-auto-install.mjs";

/** @typedef {import("./post-merge-auto-install.mjs").DecideInput} DecideInput */

/** Minimal `decideActions` input — every test starts here and overrides
 *  the fields it cares about. Pure data — no spies, no I/O. */
const baseInput = Object.freeze(
  /** @type {DecideInput} */ ({
    changedFiles: [],
    env: {},
    sentinelExists: false,
    daemonRunning: false,
    plistExists: false,
    platform: "darwin",
  }),
);

describe("decideActions — override semantics", () => {
  test("MINSKY_NO_AUTO_INSTALL=1 → skip with reason, zero actions", () => {
    const result = decideActions({
      ...baseInput,
      env: { MINSKY_NO_AUTO_INSTALL: "1" },
      changedFiles: ["bin/minsky", "pnpm-lock.yaml"], // would normally fire
    });
    expect(result.skip).toBe(true);
    expect(result.skipReason).toMatch(/MINSKY_NO_AUTO_INSTALL/);
    expect(result.actions).toEqual([]);
  });

  test("CI=true → skip (auto-install is for operator machines, not CI)", () => {
    const result = decideActions({
      ...baseInput,
      env: { CI: "true" },
      changedFiles: ["bin/minsky"],
    });
    expect(result.skip).toBe(true);
    expect(result.skipReason).toMatch(/CI/);
    expect(result.actions).toEqual([]);
  });

  test("sentinel file exists (~/.minsky/no-auto-install) → skip", () => {
    const result = decideActions({
      ...baseInput,
      sentinelExists: true,
      changedFiles: ["bin/minsky"],
    });
    expect(result.skip).toBe(true);
    expect(result.skipReason).toMatch(/no-auto-install/);
    expect(result.actions).toEqual([]);
  });

  test("MINSKY_NO_AUTO_INSTALL takes precedence over sentinel + CI", () => {
    const result = decideActions({
      ...baseInput,
      env: { MINSKY_NO_AUTO_INSTALL: "1", CI: "true" },
      sentinelExists: true,
      changedFiles: ["bin/minsky"],
    });
    expect(result.skip).toBe(true);
    expect(result.skipReason).toMatch(/MINSKY_NO_AUTO_INSTALL/);
  });

  test("MINSKY_NO_AUTO_INSTALL=0 / unset → does NOT skip (allow-by-default)", () => {
    const result = decideActions({
      ...baseInput,
      env: { MINSKY_NO_AUTO_INSTALL: "0" },
      changedFiles: ["pnpm-lock.yaml"],
    });
    expect(result.skip).toBe(false);
  });
});

describe("decideActions — pnpm install trigger", () => {
  test("pnpm-lock.yaml changed → emits pnpm-install action", () => {
    const result = decideActions({ ...baseInput, changedFiles: ["pnpm-lock.yaml"] });
    expect(result.skip).toBe(false);
    expect(result.actions).toContainEqual({ kind: "pnpm-install" });
  });

  test("package.json changed → emits pnpm-install action", () => {
    const result = decideActions({ ...baseInput, changedFiles: ["package.json"] });
    expect(result.actions).toContainEqual({ kind: "pnpm-install" });
  });

  test("nested package.json (workspace) changed → emits pnpm-install action", () => {
    const result = decideActions({
      ...baseInput,
      changedFiles: ["novel/cross-repo-runner/package.json"],
    });
    expect(result.actions).toContainEqual({ kind: "pnpm-install" });
  });

  test("only README.md changed → no pnpm-install", () => {
    const result = decideActions({ ...baseInput, changedFiles: ["README.md"] });
    expect(result.actions).not.toContainEqual({ kind: "pnpm-install" });
  });
});

describe("decideActions — plist regeneration trigger", () => {
  test("bin/minsky changed + plist exists + macOS → emits regen-plist", () => {
    const result = decideActions({
      ...baseInput,
      changedFiles: ["bin/minsky"],
      plistExists: true,
      platform: "darwin",
    });
    expect(result.actions).toContainEqual(
      expect.objectContaining({ kind: "regen-plist", warnDaemonRunning: false }),
    );
  });

  test("bin/minsky changed + plist exists + daemon running → warnDaemonRunning=true", () => {
    const result = decideActions({
      ...baseInput,
      changedFiles: ["bin/minsky"],
      plistExists: true,
      daemonRunning: true,
      platform: "darwin",
    });
    expect(result.actions).toContainEqual({ kind: "regen-plist", warnDaemonRunning: true });
  });

  test("bin/minsky changed + plist does NOT exist → no regen (operator hasn't installed)", () => {
    const result = decideActions({
      ...baseInput,
      changedFiles: ["bin/minsky"],
      plistExists: false,
      platform: "darwin",
    });
    expect(result.actions).not.toContainEqual(expect.objectContaining({ kind: "regen-plist" }));
  });

  test("bin/minsky changed on Linux → no regen-plist (launchd is macOS-only)", () => {
    const result = decideActions({
      ...baseInput,
      changedFiles: ["bin/minsky"],
      plistExists: true, // even if a stale plist sits on disk somehow
      platform: "linux",
    });
    expect(result.actions).not.toContainEqual(expect.objectContaining({ kind: "regen-plist" }));
  });
});

describe("decideActions — systemd reload trigger", () => {
  test("distribution/systemd/*.service changed + Linux → emits systemctl-reload", () => {
    const result = decideActions({
      ...baseInput,
      changedFiles: ["distribution/systemd/minsky-daemon.service"],
      platform: "linux",
    });
    expect(result.actions).toContainEqual({ kind: "systemctl-reload" });
  });

  test("distribution/systemd/*.target changed + Linux → emits systemctl-reload", () => {
    const result = decideActions({
      ...baseInput,
      changedFiles: ["distribution/systemd/minsky-supervisor.target"],
      platform: "linux",
    });
    expect(result.actions).toContainEqual({ kind: "systemctl-reload" });
  });

  test("distribution/systemd/*.sh changed → no systemctl-reload (run script, not unit)", () => {
    const result = decideActions({
      ...baseInput,
      changedFiles: ["distribution/systemd/run-daemon.sh"],
      platform: "linux",
    });
    expect(result.actions).not.toContainEqual({ kind: "systemctl-reload" });
  });

  test("systemd unit changed on macOS → no systemctl-reload", () => {
    const result = decideActions({
      ...baseInput,
      changedFiles: ["distribution/systemd/minsky-daemon.service"],
      platform: "darwin",
    });
    expect(result.actions).not.toContainEqual({ kind: "systemctl-reload" });
  });
});

describe("decideActions — pre-pr-lint sanity check trigger", () => {
  test("any material change → emits pre-pr-lint-fast at the END", () => {
    const result = decideActions({
      ...baseInput,
      changedFiles: ["pnpm-lock.yaml"],
    });
    expect(result.actions).toContainEqual({ kind: "pre-pr-lint-fast" });
    // pre-pr-lint must run AFTER the install steps (rebuilt dist/ + reloaded
    // plist need to be in place for the lint to see the real state).
    const lintIndex = result.actions.findIndex((a) => a.kind === "pre-pr-lint-fast");
    const installIndex = result.actions.findIndex((a) => a.kind === "pnpm-install");
    expect(lintIndex).toBeGreaterThan(installIndex);
  });

  test("doc-only change (README.md) → no pre-pr-lint (nothing to check that matters)", () => {
    const result = decideActions({
      ...baseInput,
      changedFiles: ["README.md", "docs/intro.md"],
    });
    expect(result.actions).toEqual([]);
  });

  test("only TASKS.md changed → no pre-pr-lint (TASKS.md edits are operator-driven, not code)", () => {
    const result = decideActions({ ...baseInput, changedFiles: ["TASKS.md"] });
    expect(result.actions).toEqual([]);
  });
});

describe("decideActions — empty changeset", () => {
  test("no changed files → zero actions, not skipped", () => {
    const result = decideActions({ ...baseInput, changedFiles: [] });
    expect(result.skip).toBe(false);
    expect(result.actions).toEqual([]);
  });
});

describe("decideActions — composite scenarios (the realistic case)", () => {
  test("PR #666-shape pull (bin/minsky + lock + tests) → pnpm-install + regen-plist + lint-fast, in that order", () => {
    const result = decideActions({
      ...baseInput,
      changedFiles: [
        "bin/minsky",
        "pnpm-lock.yaml",
        "novel/cross-repo-runner/src/runner.ts",
        "test/integration/daemon-restart.test.ts",
      ],
      plistExists: true,
      daemonRunning: false,
      platform: "darwin",
    });
    expect(result.skip).toBe(false);
    const kinds = result.actions.map((a) => a.kind);
    expect(kinds).toEqual(["pnpm-install", "regen-plist", "pre-pr-lint-fast"]);
  });

  test("Linux equivalent of the same pull → pnpm-install + (no regen-plist) + lint-fast", () => {
    const result = decideActions({
      ...baseInput,
      changedFiles: ["bin/minsky", "pnpm-lock.yaml", "distribution/systemd/minsky-daemon.service"],
      plistExists: false,
      daemonRunning: false,
      platform: "linux",
    });
    const kinds = result.actions.map((a) => a.kind);
    expect(kinds).toEqual(["pnpm-install", "systemctl-reload", "pre-pr-lint-fast"]);
  });
});

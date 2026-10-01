// Tests for launcher-agnostic-feature-parity-chaos-test
// Chaos test for user-story 014 (launcher-agnostic feature parity). The
// task ID above is a self-doc header (matched by check-task-block-
// citations' SELF_DOC_LINE_RE), not a freeform citation — the TASKS.md
// block is closed in this same commit.
//
// Hypothesis (rule #9): today the daemon's runtime behavior is *believed*
// launcher-agnostic but not *verified* — nothing catches a future PR that
// adds `if (process.env.CLAUDE_CODE) { ... }` to runtime code. This chaos
// test installs Minsky twice through the SAME INSTALL.md steps, driven by
// two launchers (fake-claude, fake-cursor) that differ ONLY in their
// launcher-identifying env vars, then diffs the resulting install
// snapshots. Steady-state hypothesis: zero non-allowlisted deltas. The
// only permitted delta is `telemetryConsent.agent` (story 014 § Metric,
// threshold 0, iron).
//
// Success: the parity diff is empty (modulo the allowlist) on a clean
// tree. Falsifiability: a synthetic launcher-coupling leak injected into
// one install's config makes the diff non-empty with a per-field message
// naming the divergent field — proving the test is not a tautology
// (Popper 1959 — a test that can't fail proves nothing).
//
// Measurement: `pnpm vitest run test/chaos/launcher-agnostic-feature-
//   parity.test.ts` exits 0 on main; the injection case asserts a
//   non-empty diff. Wired into `pnpm pre-pr-lint --stage=full` via the
//   stack's `vitest` step (which globs `test/**/*.test.ts`).
//
// Pattern: chaos engineering (Basiri et al. 2016) + golden-master
//   snapshot (Feathers 2004) — see scripts/snapshot-minsky-install.mjs.
// Anchor: user-story 014 § "Integration test"; rule #9; Nygard, *Release
//   It!* 2nd ed. 2018 (chaos at the launcher↔runtime seam).

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildOpenHandsInvocation } from "@minsky/agent-runtime-openhands";
import { describe, expect, test } from "vitest";
import {
  buildSnapshot,
  diffSnapshots,
  extractSubcommands,
  normalizeOpenhandsEnvelope,
  normalizeTelemetryConsent,
  PERMITTED_DELTAS,
} from "../../scripts/snapshot-minsky-install.mjs";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const FAKE_CLAUDE = join(REPO_ROOT, "test", "fixtures", "launchers", "fake-claude.mjs");
const FAKE_CURSOR = join(REPO_ROOT, "test", "fixtures", "launchers", "fake-cursor.mjs");

interface InstallResult {
  ok: boolean;
  helpText: string;
  stateDir: string;
  steps: { name: string; status: number }[];
}

/** A single config-derived OpenHands envelope snapshot field type. */
type Json = Record<string, unknown>;

/**
 * Build a fresh tmp git host with a trivial P3 TASKS.md task (story 014 §
 * "Integration test" step 1). `minsky init` refuses non-repos, so the
 * fixture must be a real git repo.
 */
function makeFixtureRepo(): string {
  const repo = mkdtempSync(join(tmpdir(), "minsky-launcher-fixture-"));
  // `-c core.hooksPath=/dev/null` disables any globally-configured git hooks
  // (the dev machine sets a global `core.hooksPath`); without this the inner
  // `git commit` runs the operator's commit-msg/pre-commit hooks and fails
  // on the test's synthetic message. Same isolation discipline as the
  // GIT_DIR-stripping in run-pre-pr-lint-stack.mjs.
  const git = (args: string[]): void => {
    execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args], { cwd: repo });
  };
  git(["init", "--quiet"]);
  git(["config", "user.email", "test@example.com"]);
  git(["config", "user.name", "test"]);
  writeFileSync(
    join(repo, "TASKS.md"),
    [
      "# Tasks",
      "",
      "## P3",
      "",
      "- [ ] Trivial fixture task for the launcher-parity chaos test",
      "  - **ID**: launcher-parity-fixture-trivial",
      "  - **Tags**: p3, fixture",
      "  - **Details**: a no-op task so the picker has something to chew on.",
      "  - **Files**: none",
      "  - **Acceptance**: never picked in this test (snapshot only).",
      "",
    ].join("\n"),
  );
  // `-f`: a global ~/.gitignore may ignore TASKS.md on the dev machine.
  git(["add", "-f", "TASKS.md"]);
  git(["commit", "-m", "fixture", "--quiet", "--no-verify"]);
  return repo;
}

/** Fresh isolated HOME so the install never touches the real ~/.minsky. */
function makeIsolatedHome(label: string): string {
  return mkdtempSync(join(tmpdir(), `minsky-launcher-home-${label}-`));
}

/**
 * Drive one launcher against the fixture and return its install result.
 * The launcher script prints a single JSON line (InstallResult).
 */
function runLauncher(launcherScript: string, fixtureRepo: string, home: string): InstallResult {
  const r = spawnSync("node", [launcherScript, fixtureRepo, home], {
    encoding: "utf8",
    env: { PATH: process.env["PATH"] ?? "/usr/bin:/bin" },
    timeout: 60_000,
  });
  const stdout = r.stdout ?? "";
  // The launcher's last stdout line is the JSON result.
  const lastLine = stdout.trim().split("\n").filter(Boolean).at(-1) ?? "{}";
  return JSON.parse(lastLine) as InstallResult;
}

/**
 * Build the launcher-invariant OpenHands spawn envelope from an install's
 * config.json. The envelope is a pure function of config — so if a
 * launcher branch leaked a different `cloud_agent_model` (or any other
 * config value) into one install, the envelope diverges and the chaos
 * test catches it. We normalize out the per-call temp brief path.
 */
function envelopeFromConfig(stateDir: string): Json {
  const configPath = join(stateDir, "config.json");
  const config: Json = existsSync(configPath)
    ? (JSON.parse(readFileSync(configPath, "utf8")) as Json)
    : {};
  const model =
    typeof config["cloud_agent_model"] === "string"
      ? config["cloud_agent_model"]
      : "ollama_chat/qwen3-coder:30b";
  const inv = buildOpenHandsInvocation({
    brief: "snapshot-only brief (no real spawn)",
    repoRoot: typeof config["default_host"] === "string" ? config["default_host"] : "/tmp/fixture",
    model,
    baseUrl: "http://localhost:11434",
    reasoningEffort: "none",
    disableExtendedThinking: true,
  });
  // Cast to the snapshot's Json shape and normalize volatile fields.
  return normalizeOpenhandsEnvelope({
    command: inv.command,
    argv: inv.argv,
    cwd: inv.cwd,
    stdin: inv.stdin,
  });
}

/** Read + build a full install snapshot from an install's state dir. */
function snapshotInstall(install: InstallResult): ReturnType<typeof buildSnapshot> {
  const configPath = join(install.stateDir, "config.json");
  const consentPath = join(install.stateDir, "telemetry-consent.json");
  const config: Json = existsSync(configPath)
    ? (JSON.parse(readFileSync(configPath, "utf8")) as Json)
    : {};
  const telemetryConsent: Json = existsSync(consentPath)
    ? (JSON.parse(readFileSync(consentPath, "utf8")) as Json)
    : {};
  return buildSnapshot({
    config,
    telemetryConsent,
    helpText: install.helpText,
    openhandsEnvelope: envelopeFromConfig(install.stateDir),
  });
}

// ---- pure-unit slice (always runs; fast; no process spawn) ------------------

describe("snapshot-minsky-install — pure diff substrate", () => {
  test("identical snapshots produce zero deltas", () => {
    const snap = buildSnapshot({
      config: { default_host: "/r", cloud_agent: "openhands" },
      telemetryConsent: { consent: true, agent: "claude", timestamp: "T", host_path_hash: "H" },
      helpText: "minsky init\nminsky run\nminsky daemon\n",
      openhandsEnvelope: { command: "python3", argv: ["s", "--model", "m"] },
    });
    expect(diffSnapshots(snap, snap)).toEqual([]);
  });

  test("the agent string is the ONLY permitted cross-launcher delta", () => {
    const a = buildSnapshot({
      config: { default_host: "/r" },
      telemetryConsent: { consent: true, agent: "claude", timestamp: "T1", host_path_hash: "H1" },
      helpText: "minsky init\nminsky run\n",
      openhandsEnvelope: { command: "python3", argv: ["s", "--model", "m"] },
    });
    const b = buildSnapshot({
      config: { default_host: "/r" },
      // Different agent + different volatile fields — all permitted/normalized.
      telemetryConsent: { consent: true, agent: "cursor", timestamp: "T2", host_path_hash: "H2" },
      helpText: "minsky init\nminsky run\n",
      openhandsEnvelope: { command: "python3", argv: ["s", "--model", "m"] },
    });
    expect(diffSnapshots(a, b)).toEqual([]);
    expect(PERMITTED_DELTAS).toContain("telemetryConsent.agent");
  });

  test("a launcher leak into config IS caught (falsifiability)", () => {
    const base = buildSnapshot({
      config: { default_host: "/r", cloud_agent: "openhands" },
      telemetryConsent: { consent: true, agent: "claude" },
      helpText: "minsky init\n",
      openhandsEnvelope: { command: "python3", argv: ["s", "--model", "m"] },
    });
    // Simulate `if (process.env.CLAUDE_CODE) { config.cloud_agent = "claude" }`
    // — the exact regression class from the task's Acceptance #2.
    const leaked = buildSnapshot({
      config: { default_host: "/r", cloud_agent: "claude" },
      telemetryConsent: { consent: true, agent: "cursor" },
      helpText: "minsky init\n",
      openhandsEnvelope: { command: "python3", argv: ["s", "--model", "m"] },
    });
    const deltas = diffSnapshots(base, leaked);
    expect(deltas.length).toBeGreaterThan(0);
    expect(deltas.map((d) => d.field)).toContain("config.cloud_agent");
  });

  test("a leak into the OpenHands envelope (e.g. model) IS caught", () => {
    const a = buildSnapshot({
      config: { default_host: "/r" },
      telemetryConsent: { consent: true, agent: "claude" },
      helpText: "minsky init\n",
      openhandsEnvelope: { command: "python3", argv: ["s", "--model", "model-A"] },
    });
    const b = buildSnapshot({
      config: { default_host: "/r" },
      telemetryConsent: { consent: true, agent: "cursor" },
      helpText: "minsky init\n",
      openhandsEnvelope: { command: "python3", argv: ["s", "--model", "model-B"] },
    });
    const deltas = diffSnapshots(a, b);
    expect(deltas.length).toBeGreaterThan(0);
    expect(deltas.some((d) => d.field.startsWith("openhandsEnvelope."))).toBe(true);
  });

  test("a divergent subcommand set IS caught", () => {
    const a = buildSnapshot({
      config: {},
      telemetryConsent: { agent: "claude" },
      helpText: "minsky init\nminsky run\n",
      openhandsEnvelope: {},
    });
    const b = buildSnapshot({
      config: {},
      telemetryConsent: { agent: "cursor" },
      // Cursor-only secret subcommand — a launcher-conditional feature.
      helpText: "minsky init\nminsky run\nminsky cursor-only\n",
      openhandsEnvelope: {},
    });
    const deltas = diffSnapshots(a, b);
    expect(deltas.some((d) => d.field.startsWith("subcommands"))).toBe(true);
  });

  test("normalizeTelemetryConsent drops volatile fields, keeps consent+agent", () => {
    const norm = normalizeTelemetryConsent({
      consent: true,
      agent: "claude",
      timestamp: "2026-01-01T00:00:00Z",
      host_path_hash: "deadbeef",
    });
    expect(norm).toEqual({ consent: true, agent: "claude" });
  });

  test("extractSubcommands de-dupes + sorts the advertised verbs", () => {
    const verbs = extractSubcommands("minsky run\nminsky init\nminsky run --once\n");
    expect(verbs).toEqual(["init", "run"]);
  });
});

// ---- end-to-end chaos slice (real installs; opt-in / CI) --------------------

const RUN_INTEGRATION =
  process.env["MINSKY_RUN_INTEGRATION"] === "1" ||
  process.env["CI"] === "true" ||
  process.env["VITEST_INTEGRATION"] === "1";

describe.skipIf(!RUN_INTEGRATION)("launcher-agnostic feature parity (real installs)", () => {
  test("two launchers, same fixture → only telemetryConsent.agent differs", () => {
    const fixture = makeFixtureRepo();
    const claudeHome = makeIsolatedHome("claude");
    const cursorHome = makeIsolatedHome("cursor");

    const claudeInstall = runLauncher(FAKE_CLAUDE, fixture, claudeHome);
    const cursorInstall = runLauncher(FAKE_CURSOR, fixture, cursorHome);

    // Both installs must have completed every step cleanly.
    expect(claudeInstall.ok, JSON.stringify(claudeInstall.steps)).toBe(true);
    expect(cursorInstall.ok, JSON.stringify(cursorInstall.steps)).toBe(true);

    const claudeSnap = snapshotInstall(claudeInstall);
    const cursorSnap = snapshotInstall(cursorInstall);

    // The permitted delta really did differ (the test fixtures are honest).
    expect(claudeSnap.telemetryConsent["agent"]).toBe("claude");
    expect(cursorSnap.telemetryConsent["agent"]).toBe("cursor");

    // The iron assertion: zero non-allowlisted deltas.
    const deltas = diffSnapshots(claudeSnap, cursorSnap);
    expect(
      deltas,
      `launcher-agnostic parity violated — non-allowlisted deltas:\n${deltas
        .map((d) => `  ${d.field}: claude=${d.a} cursor=${d.b}`)
        .join("\n")}`,
    ).toEqual([]);
  });

  test("falsifiability — a forced config leak makes the parity diff non-empty", () => {
    const fixture = makeFixtureRepo();
    const claudeHome = makeIsolatedHome("claude-leak");
    const cursorHome = makeIsolatedHome("cursor-leak");

    const claudeInstall = runLauncher(FAKE_CLAUDE, fixture, claudeHome);
    const cursorInstall = runLauncher(FAKE_CURSOR, fixture, cursorHome);
    expect(claudeInstall.ok).toBe(true);
    expect(cursorInstall.ok).toBe(true);

    // Inject the exact regression the task names in Acceptance #2:
    // `if (process.env.CLAUDE_CODE) { config.cloud_agent = "claude" }`.
    // We mutate the claude install's config post-hoc to simulate a runtime
    // launcher branch having written it, then confirm the diff catches it.
    const claudeConfigPath = join(claudeInstall.stateDir, "config.json");
    const claudeConfig = JSON.parse(readFileSync(claudeConfigPath, "utf8")) as Json;
    claudeConfig["cloud_agent"] = "claude";
    writeFileSync(claudeConfigPath, JSON.stringify(claudeConfig, null, 2));

    const claudeSnap = snapshotInstall(claudeInstall);
    const cursorSnap = snapshotInstall(cursorInstall);
    const deltas = diffSnapshots(claudeSnap, cursorSnap);
    expect(deltas.length).toBeGreaterThan(0);
    expect(deltas.map((d) => d.field)).toContain("config.cloud_agent");
  });
});

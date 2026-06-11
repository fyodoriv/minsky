// Tests for daily-metrics-regen.mjs. Pattern: paired positive/negative
// cases over the pure decision core (Meszaros 2007; rule #10 — same
// input, same output) + a fixture-repo integration pass over the CLI's
// plumbing-commit path with stub `gh` / pipeline scripts on PATH (the
// lint-units.test.mjs tmpdir recipe). No real PRs are opened — `gh` is
// a recording stub.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, test } from "vitest";

import {
  alreadyRenderedForDate,
  buildCommitMessage,
  buildPrBody,
  decideRegen,
  METRICS_RELATIVE,
  regenBranchName,
} from "./daily-metrics-regen.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = resolve(HERE, "daily-metrics-regen.mjs");

describe("regenBranchName", () => {
  test("dated chore branch", () => {
    expect(regenBranchName("2026-06-12")).toBe("chore/metrics-daily-regen-2026-06-12");
  });
});

describe("alreadyRenderedForDate", () => {
  test("true when the snapshot-source path for the date is present", () => {
    const md = "…\n_Source: .minsky/metric-snapshots/2026-06-12.json_\n";
    expect(alreadyRenderedForDate(md, "2026-06-12")).toBe(true);
  });

  test("false when only an older date is present", () => {
    const md = "…\n_Source: .minsky/metric-snapshots/2026-06-11.json_\n";
    expect(alreadyRenderedForDate(md, "2026-06-12")).toBe(false);
  });
});

describe("buildCommitMessage", () => {
  test("conventional header ≤72 chars", () => {
    const header = buildCommitMessage("2026-06-12").split("\n")[0] ?? "";
    expect(header).toMatch(/^chore\(metrics\): daily regen 2026-06-12/);
    expect(header.length).toBeLessThanOrEqual(72);
  });
});

describe("buildPrBody", () => {
  const body = buildPrBody({
    dateUtc: "2026-06-12",
    freshnessOutput: "metric-freshness ok: 20 section(s) verified.\n",
  });

  test("carries the four required blocks", () => {
    expect(body).toContain("## Why needed");
    expect(body).toContain("## Hypothesis self-grade");
    expect(body).toContain("<!-- security: not-applicable — generated metrics doc refresh -->");
    expect(body).toContain("## Vision trace");
  });

  test("self-grade has Predicted/Observed/Match/Lesson with live freshness output", () => {
    expect(body).toMatch(/^- Predicted: /m);
    expect(body).toMatch(/^- Observed: /m);
    expect(body).toMatch(/^- Match: /m);
    expect(body).toMatch(/^- Lesson: /m);
    expect(body).toContain("metric-freshness ok: 20 section(s) verified.");
  });

  test("vision-trace fields are substantive", () => {
    expect(body).toMatch(/\*\*Vision goal\*\*: .{3,}/);
    expect(body).toMatch(/\*\*User story\*\*: N\/A — .{3,}/);
    expect(body).toMatch(/\*\*Competitor prior art\*\*: N\/A — .{3,}/);
  });
});

describe("decideRegen", () => {
  const base = {
    todayUtc: "2026-06-12",
    mainMetricsMd: "_Source: .minsky/metric-snapshots/2026-06-11.json_\n",
    renderedMetricsMd: null,
    remoteBranchExists: false,
  };

  test("skips when main already carries today's render", () => {
    expect(
      decideRegen({
        ...base,
        mainMetricsMd: "_Source: .minsky/metric-snapshots/2026-06-12.json_\n",
      }),
    ).toEqual({ action: "skip", reason: "already-rendered-today" });
  });

  test("skips when the dated branch already exists on origin", () => {
    expect(decideRegen({ ...base, remoteBranchExists: true })).toEqual({
      action: "skip",
      reason: "branch-exists",
    });
  });

  test("skips when the render is byte-identical to main's copy", () => {
    expect(decideRegen({ ...base, renderedMetricsMd: base.mainMetricsMd })).toEqual({
      action: "skip",
      reason: "no-change",
    });
  });

  test("publishes with dated branch + conventional message otherwise", () => {
    const d = decideRegen({ ...base, renderedMetricsMd: "fresh content\n" });
    expect(d.action).toBe("publish");
    if (d.action === "publish") {
      expect(d.branch).toBe("chore/metrics-daily-regen-2026-06-12");
      expect(d.commitMessage).toMatch(/^chore\(metrics\): daily regen 2026-06-12/);
    }
  });

  test("publishes before the pipeline ran (renderedMetricsMd null) when main is stale", () => {
    expect(decideRegen(base).action).toBe("publish");
  });
});

describe("CLI integration (fixture repo, stub gh on PATH)", () => {
  /** @type {string} */
  let dir;
  /** @type {string} */
  let repo;
  /** @type {string} */
  let origin;
  /** @type {string} */
  let stubBin;
  const today = new Date().toISOString().slice(0, 10);

  /**
   * @param {string} cwd
   * @param {string[]} args
   * @returns {string}
   */
  function git(cwd, args) {
    return execFileSync("git", args, { cwd, encoding: "utf8" });
  }

  /**
   * Run the real CLI inside the fixture repo with the stub dir prepended
   * to PATH.
   *
   * @returns {{ status: number, stdout: string, stderr: string }}
   */
  function runCli() {
    try {
      const stdout = execFileSync(process.execPath, [SCRIPT_PATH], {
        cwd: repo,
        encoding: "utf8",
        env: { ...process.env, PATH: `${stubBin}:${process.env["PATH"]}` },
      });
      return { status: 0, stdout, stderr: "" };
    } catch (/** @type {any} */ err) {
      return {
        status: err.status ?? 1,
        stdout: err.stdout?.toString() ?? "",
        stderr: err.stderr?.toString() ?? "",
      };
    }
  }

  /** @param {string} renderedContent — what the metrics-render stub writes */
  function seedFixture(renderedContent) {
    origin = join(dir, "origin.git");
    repo = join(dir, "repo");
    stubBin = join(dir, "bin");
    mkdirSync(stubBin, { recursive: true });

    // Recording `gh` stub — appends argv to gh-calls.log and copies the
    // --body-file content next to it. Never talks to GitHub.
    writeFileSync(
      join(stubBin, "gh"),
      [
        "#!/bin/sh",
        `echo "$@" >> "${join(dir, "gh-calls.log")}"`,
        'prev=""; for a in "$@"; do',
        `  if [ "$prev" = "--body-file" ]; then cp "$a" "${join(dir, "gh-pr-body.md")}"; fi`,
        '  prev="$a"',
        "done",
        "echo https://example.com/pr/1",
      ].join("\n"),
      { mode: 0o755 },
    );

    execFileSync("git", ["init", "--bare", "--initial-branch=main", origin], { encoding: "utf8" });
    execFileSync("git", ["init", "--initial-branch=main", repo], { encoding: "utf8" });
    git(repo, ["config", "user.name", "fixture"]);
    git(repo, ["config", "user.email", "fixture@example.com"]);
    // Hermetic against the operator's GLOBAL hooks (lefthook commit-msg /
    // pre-push) — point hooksPath at an empty dir inside the fixture.
    const noHooks = join(dir, "no-hooks");
    mkdirSync(noHooks, { recursive: true });
    git(repo, ["config", "core.hooksPath", noHooks]);
    git(repo, ["remote", "add", "origin", origin]);

    mkdirSync(join(repo, "docs"), { recursive: true });
    mkdirSync(join(repo, "scripts"), { recursive: true });
    // Committed surface references YESTERDAY's snapshot → stale today.
    writeFileSync(
      join(repo, METRICS_RELATIVE),
      "# Metrics\n\n_Source: .minsky/metric-snapshots/2020-01-01.json_\n",
    );
    // Pipeline stubs — the CLI invokes these via process.execPath, cwd=repo.
    writeFileSync(join(repo, "scripts/collect-metrics.mjs"), "process.exit(0);\n");
    writeFileSync(
      join(repo, "scripts/metrics-render.mjs"),
      [
        'import { writeFileSync } from "node:fs";',
        'const i = process.argv.indexOf("--output");',
        `writeFileSync(process.argv[i + 1], ${JSON.stringify(renderedContent)});`,
      ].join("\n"),
    );
    writeFileSync(
      join(repo, "scripts/check-metric-freshness.mjs"),
      'process.stdout.write("metric-freshness ok: 1 section(s) verified.\\n");\n',
    );
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "fixture: seed"]);
    git(repo, ["push", "origin", "main"]);
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "daily-metrics-regen-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("publishes a single-file plumbing commit + branch and calls gh pr create", () => {
    seedFixture(`# Metrics\n\n_Source: .minsky/metric-snapshots/${today}.json_\n`);
    const result = runCli();
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);

    const branch = `chore/metrics-daily-regen-${today}`;
    const heads = execFileSync("git", ["ls-remote", "--heads", origin, branch], {
      encoding: "utf8",
    });
    expect(heads).toContain(branch);

    // The pushed commit sits on top of origin/main and touches ONLY
    // docs/METRICS.md.
    const changed = execFileSync("git", ["diff", "--name-only", `main..refs/heads/${branch}`], {
      cwd: origin,
      encoding: "utf8",
    });
    expect(changed.trim()).toBe(METRICS_RELATIVE);
    const header = execFileSync("git", ["log", "-1", "--format=%s", `refs/heads/${branch}`], {
      cwd: origin,
      encoding: "utf8",
    }).trim();
    expect(header).toBe(`chore(metrics): daily regen ${today} — keep metric-freshness green`);

    // gh was invoked with pr create and the templated body blocks.
    const ghCalls = readFileSync(join(dir, "gh-calls.log"), "utf8");
    expect(ghCalls).toContain("pr create --base main --head");
    const prBody = readFileSync(join(dir, "gh-pr-body.md"), "utf8");
    expect(prBody).toContain("## Why needed");
    expect(prBody).toContain("## Hypothesis self-grade");
    expect(prBody).toContain("metric-freshness ok: 1 section(s) verified.");
    expect(prBody).toContain("<!-- security: not-applicable — generated metrics doc refresh -->");
    expect(prBody).toContain("## Vision trace");

    // The shared working tree was never touched.
    const status = git(repo, ["status", "--porcelain"]);
    expect(status.trim()).toBe("");
  });

  it("no-change render → exit 0, no branch pushed, gh never called", () => {
    // Render stub reproduces the committed content byte-for-byte.
    seedFixture("# Metrics\n\n_Source: .minsky/metric-snapshots/2020-01-01.json_\n");
    const result = runCli();
    expect(result.status).toBe(0);

    const heads = execFileSync("git", ["ls-remote", "--heads", origin], { encoding: "utf8" });
    expect(heads).not.toContain("metrics-daily-regen");
    expect(() => readFileSync(join(dir, "gh-calls.log"), "utf8")).toThrow();
  });

  it("dirty docs/METRICS.md in the working tree → loud exit 3, no publish", () => {
    seedFixture(`# Metrics\n\n_Source: .minsky/metric-snapshots/${today}.json_\n`);
    writeFileSync(join(repo, METRICS_RELATIVE), "# locally edited\n");
    const result = runCli();
    expect(result.status).toBe(3);
    expect(result.stderr).toContain("uncommitted changes");
    const heads = execFileSync("git", ["ls-remote", "--heads", origin], { encoding: "utf8" });
    expect(heads).not.toContain("metrics-daily-regen");
  });
});

// Tests for run-pre-pr-lint-stack.mjs. The runner is a pure orchestrator over
// the manifest + an injected `runStep`; tests stub `runStep` and assert the
// stage filter + green/red verdict logic.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import {
  appendBodyChecks,
  buildSkippedBodyChecksWarning,
  buildStepResult,
  CI_BASH_GATE_BUCKETS,
  CI_ENV_DEPENDENT_JOBS,
  CI_TO_MANIFEST_ALIAS,
  parseArgs,
  renderJson,
  resolveBodyPath,
  resolveDiffBase,
  runStack,
  STACK_MANIFEST,
  selectSteps,
  stripGitHookEnv,
  withResolvedDiffBase,
} from "./run-pre-pr-lint-stack.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ---- ci.yml parsers (shared across the four parity describes below) -----
// Lifted to module scope (slice 15) so the bash-loop drift test can reuse the
// same `needs:` parser the slice-5 manifest-vs-CI test was already using —
// keeps a single source of truth for "what the aggregator's `needs:` list is".

/**
 * @param {string} block
 * @returns {string[]}
 */
function parseNeedsBlockLines(block) {
  /** @type {string[]} */
  const names = [];
  for (const line of block.split("\n")) {
    const m = /^ {6}- ([a-z][a-z0-9-]*)$/.exec(line);
    if (m !== null && m[1] !== undefined) names.push(m[1]);
  }
  return names;
}

/**
 * Extract the `needs:` list under the top-level `ci:` aggregator job from
 * `.github/workflows/ci.yml`. Pure string parse — the workflow file's shape
 * is owned by this repo, so the regex contract is stable. Avoids pulling
 * `yaml` into `scripts/` just for one drift test.
 *
 * @param {string} yml
 * @returns {string[]}
 */
function extractCiAggregatorNeeds(yml) {
  const ciStart = yml.search(/^ {2}ci:$/m);
  if (ciStart < 0) throw new Error("ci.yml has no top-level `ci:` job");
  const needsBlock = yml.slice(ciStart).match(/^ {4}needs:\n([\s\S]*?)(?=^ {4}[a-z])/m);
  if (needsBlock === null || needsBlock[1] === undefined) {
    throw new Error("`ci:` job has no `needs:` block");
  }
  return parseNeedsBlockLines(needsBlock[1]);
}

describe("STACK_MANIFEST", () => {
  test("every entry has name / cmd / args / stages", () => {
    for (const step of STACK_MANIFEST) {
      expect(typeof step.name).toBe("string");
      expect(step.name.length).toBeGreaterThan(0);
      expect(typeof step.cmd).toBe("string");
      expect(Array.isArray(step.args)).toBe(true);
      expect(Array.isArray(step.stages)).toBe(true);
      expect(step.stages.length).toBeGreaterThan(0);
      for (const s of step.stages) {
        expect(s === "stop-gate" || s === "fast" || s === "full").toBe(true);
      }
    }
  });

  test("every step name is unique (drift-protection — manifest collisions silently mask failures)", () => {
    const names = STACK_MANIFEST.map((s) => s.name);
    const uniq = new Set(names);
    expect(uniq.size).toBe(names.length);
  });

  test("the fast stage exercises biome / typecheck / markdownlint / tasks-lint / rule-2 / rule-3 / rule-6 / rule-7 / rule-12 / rule-17", () => {
    // Pre-registered scope of the daemon's pre-PR gate (TASKS.md
    // `daemon-pre-pr-gate-fixture` Pivot — fast lints close ~80% of the failure
    // modes the operator cleans up). Drift here is what the manifest is
    // supposed to detect; pin the set explicitly. rule-7 was promoted to
    // fast 2026-05-06 (slice 8/N) — it is the 5th of 5 empirically-named
    // failure modes in the brief and walks `novel/**/README.md` only
    // (~0.3s wall-clock, well under the 5-min pivot budget). rule-17 was
    // added 2026-05-19 (proactive-healing): a deterministic gate against
    // PR bodies that surface observed-error tokens without any healing
    // evidence (a fix commit, a `**Blocked**:` task block, or a non-
    // empty diff). Same shape as rule-12.
    const fastNames = selectSteps("fast")
      .map((s) => s.name)
      .sort();
    expect(fastNames).toEqual(
      [
        "adapter-conventions",
        "agents-md-coherence",
        "biome",
        "bot-commit-hook-bypass",
        "brief-pr-instructions",
        "changelog-md-update",
        "check-task-block-citations",
        "cli-integration-test-coverage",
        "cloud-agent-config-audit-matrix",
        "competitive-goal",
        "deprecated-md-respect",
        "doc-why-first-paragraph",
        "docs-frame-coherence",
        "filename-casing",
        "markdownlint",
        "milestone-alignment",
        "no-hardcoded-timeouts",
        "no-hardcoded-user-paths",
        "no-no-verify-bypass",
        "no-personal-paths-in-docs",
        "omc-mode-persona-gating",
        "orphan-tests",
        "pnpm-minsky-aliases",
        "pre-push-hook-stays-fast",
        "readme-byte-budget",
        "research-md-update",
        "test-file-colocation",
        "rule-12-scope-discipline",
        "rule-17-proactive-heal",
        "rule-19-supervisor-explicit-start",
        "rule-2-dep-coverage",
        "rule-3-doc-first",
        "rule-6-let-it-crash",
        "rule-7-chaos-coverage",
        "rule-9-tasksmd-fields",
        "tasks-lint",
        "threat-model-section",
        "touches-field",
        "typecheck",
        "ui-tasks-priority",
      ].sort(),
    );
  });

  test("full ⊇ fast — every fast step also runs in full", () => {
    const fastSet = new Set(selectSteps("fast").map((s) => s.name));
    const fullSet = new Set(selectSteps("full").map((s) => s.name));
    for (const n of fastSet) expect(fullSet.has(n)).toBe(true);
  });

  test("full strictly extends fast (the slow lints exist in full only)", () => {
    expect(selectSteps("full").length).toBeGreaterThan(selectSteps("fast").length);
  });

  // Slice (c) of `milestone-alignment-gate-enforcement` — pin the alignment
  // step's wiring + gate-effectiveness so a future edit can't silently drop
  // the `--strict --min-aligned=10` flags. The args are the gate's contract:
  // dropping `--strict` neuters exit-on-drift; lowering `--min-aligned` is
  // the lower-the-bar anti-pattern rule #14 explicitly forbids.
  test("`milestone-alignment` step is registered with --strict --min-aligned=10 (the gate's contract)", () => {
    const step = STACK_MANIFEST.find((s) => s.name === "milestone-alignment");
    expect(step).toBeDefined();
    expect(step?.cmd).toBe("node");
    expect(step?.args).toEqual([
      "scripts/check-milestone-alignment.mjs",
      "--strict",
      "--min-aligned=10",
    ]);
    expect(step?.stages).toContain("fast"); // task body: "Place it in the `--stage=fast` set"
    expect(step?.stages).toContain("full");
  });

  // The "gate is effective" demo from the task's Success criterion: a fixture
  // that lowers the threshold to a value the repo doesn't meet exits
  // non-zero. Proves the gate's exit code is wired to the alignment count,
  // not stubbed. Runs the real script against the live repo —
  // execution time is <100ms (pure file reads).
  // Threshold updated 2026-05-26 (14/14 alignment shipped in PR #893):
  // 15 is one above the total criterion count and stays unreachable
  // until M2 expands the criterion list.
  test("gate is effective: `--min-aligned=15` (a threshold the repo doesn't meet) exits non-zero", () => {
    const checkScript = resolve(REPO_ROOT, "scripts/check-milestone-alignment.mjs");
    let exitCode = 0;
    try {
      execFileSync("node", [checkScript, "--strict", "--min-aligned=15"], {
        cwd: REPO_ROOT,
        stdio: "ignore",
      });
    } catch (err) {
      // execFileSync throws on non-zero exit. Capture the status as proof.
      // rule-6: handled-locally — script exits 1 by design when aligned_count
      // < minAligned; we want the boolean assertion, not the thrown error.
      exitCode = /** @type {{ status?: number }} */ (err).status ?? 1;
    }
    expect(exitCode).toBe(1);
  });

  test("gate passes on main: `--min-aligned=10` exits 0 (regression floor — operator's Success threshold)", () => {
    const checkScript = resolve(REPO_ROOT, "scripts/check-milestone-alignment.mjs");
    // If this fails, the gate is RED on main — a regression that must be
    // fixed before this PR lands; landing it would permanently red CI.
    execFileSync("node", [checkScript, "--strict", "--min-aligned=10"], {
      cwd: REPO_ROOT,
      stdio: "ignore",
    });
    // No throw means exit 0.
  });
});

describe("runStack", () => {
  /** @type {{ name: string, stages: ("fast" | "full")[], cmd: string, args: string[] }[]} */
  const fixtureManifest = [
    { name: "alpha", stages: ["fast", "full"], cmd: "noop", args: [] },
    { name: "beta", stages: ["fast", "full"], cmd: "noop", args: [] },
    { name: "gamma", stages: ["full"], cmd: "noop", args: [] },
  ];

  test("returns allPass=true when every step passes", async () => {
    const result = await runStack(
      "fast",
      async (s) => ({ name: s.name, verdict: "pass", durationMs: 1, exitCode: 0 }),
      fixtureManifest,
    );
    expect(result.allPass).toBe(true);
    expect(result.steps.map((s) => s.name)).toEqual(["alpha", "beta"]);
    expect(result.stage).toBe("fast");
  });

  test("returns allPass=false when any step fails", async () => {
    const result = await runStack(
      "fast",
      async (s) => {
        if (s.name === "beta") {
          return {
            name: s.name,
            verdict: "fail",
            durationMs: 1,
            exitCode: 1,
            stderrTail: "boom",
          };
        }
        return { name: s.name, verdict: "pass", durationMs: 1, exitCode: 0 };
      },
      fixtureManifest,
    );
    expect(result.allPass).toBe(false);
    const beta = result.steps.find((s) => s.name === "beta");
    expect(beta?.verdict).toBe("fail");
    expect(beta?.stderrTail).toBe("boom");
  });

  test("stage=full includes the full-only steps", async () => {
    const result = await runStack(
      "full",
      async (s) => ({ name: s.name, verdict: "pass", durationMs: 1, exitCode: 0 }),
      fixtureManifest,
    );
    expect(result.steps.map((s) => s.name)).toEqual(["alpha", "beta", "gamma"]);
  });

  test("steps run in manifest order (sequential — daemon spawn budget is finite)", async () => {
    /** @type {string[]} */
    const observed = [];
    await runStack(
      "full",
      async (s) => {
        observed.push(s.name);
        return { name: s.name, verdict: "pass", durationMs: 1, exitCode: 0 };
      },
      fixtureManifest,
    );
    expect(observed).toEqual(["alpha", "beta", "gamma"]);
  });
});

describe("buildStepResult", () => {
  test("err=null → pass with exitCode 0 and no stderrTail", () => {
    const r = buildStepResult("alpha", null, "ignored", 42);
    expect(r).toEqual({ name: "alpha", verdict: "pass", durationMs: 42, exitCode: 0 });
  });

  test("err with numeric code → fail carrying that code + stderr tail", () => {
    const err = Object.assign(new Error("boom"), { code: 7 });
    const r = buildStepResult("beta", err, "line1\nline2", 11);
    expect(r.verdict).toBe("fail");
    expect(r.exitCode).toBe(7);
    expect(r.stderrTail).toBe("line1\nline2");
  });

  test("err with non-numeric code → fail with synthesised exitCode 1 (rule-6 let-it-crash equivalent)", () => {
    const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    const r = buildStepResult("gamma", err, "", 0);
    expect(r.verdict).toBe("fail");
    expect(r.exitCode).toBe(1);
  });

  test("stderr tail is bounded to ~80 lines (long output truncates)", () => {
    const huge = Array.from({ length: 200 }, (_, i) => `line${i}`).join("\n");
    const err = Object.assign(new Error("boom"), { code: 1 });
    const r = buildStepResult("delta", err, huge, 1);
    const tailLineCount = (r.stderrTail ?? "").split("\n").length;
    expect(tailLineCount).toBeLessThanOrEqual(80);
    expect(r.stderrTail).toContain("line199");
    expect(r.stderrTail).not.toContain("line0\n");
  });
});

describe("parseArgs", () => {
  test("default stage is fast (the daemon's gate)", () => {
    expect(parseArgs([])).toEqual({ stage: "fast", json: false });
  });

  test("--stage=full opts into the operator-side gate", () => {
    expect(parseArgs(["--stage=full"])).toEqual({ stage: "full", json: false });
  });

  test("--json toggles machine-readable output", () => {
    expect(parseArgs(["--json"])).toEqual({ stage: "fast", json: true });
  });

  test("unknown flags are ignored (forward-compat)", () => {
    expect(parseArgs(["--unknown", "--stage=full"])).toEqual({ stage: "full", json: false });
  });

  test("--body=<path> surfaces the body-file the daemon will pass to `gh pr create -F`", () => {
    expect(parseArgs(["--body=pr-body.md"])).toEqual({
      stage: "fast",
      json: false,
      body: "pr-body.md",
    });
  });

  test("--body= (empty value) is ignored — empty paths can't satisfy the body checks", () => {
    expect(parseArgs(["--body="])).toEqual({ stage: "fast", json: false });
  });
});

describe("resolveBodyPath (slice 35/N — `pnpm pre-pr-lint` auto-discovers `pr-body.md`)", () => {
  // Slice 33/N lifted the auto-discovery into the daemon's TS factory
  // (`createBodyAwarePrePrLintRun`); this slice mirrors it in the script so
  // the operator's `pnpm pre-pr-lint` and the daemon's
  // `node scripts/run-pre-pr-lint-stack.mjs` invocation share one discovery
  // path (rule #2 — single source of truth). Explicit `--body=<path>` always
  // wins; auto-discovery is the silent fallback.

  test("explicit --body=<path> wins (no fileExists call needed)", () => {
    let calls = 0;
    const fileExists = () => {
      calls += 1;
      return true;
    };
    expect(resolveBodyPath("draft.md", fileExists, "/repo")).toBe("draft.md");
    expect(calls).toBe(0);
  });

  test("returns the discovered path when `pr-body.md` exists at repoRoot", () => {
    /** @type {(p: string) => boolean} */
    const fileExists = (p) => p === "/repo/pr-body.md";
    expect(resolveBodyPath(undefined, fileExists, "/repo")).toBe("/repo/pr-body.md");
  });

  test("returns undefined when `pr-body.md` is absent and no flag was passed", () => {
    /** @type {(p: string) => boolean} */
    const fileExists = () => false;
    expect(resolveBodyPath(undefined, fileExists, "/repo")).toBeUndefined();
  });

  test("uses repoRoot for discovery — not the caller's cwd", () => {
    /** @type {string[]} */
    const probed = [];
    /** @type {(p: string) => boolean} */
    const fileExists = (p) => {
      probed.push(p);
      return false;
    };
    resolveBodyPath(undefined, fileExists, "/some/repo");
    expect(probed).toEqual(["/some/repo/pr-body.md"]);
  });
});

describe("appendBodyChecks (slice 30/N — `--body=<path>` consolidates 4 commands → 1)", () => {
  // The three body-only checks (`pr-self-grade`, `pr-security-review`,
  // `pr-vision-trace`) sit in `CI_ENV_DEPENDENT_JOBS` because in CI they
  // read the GitHub PR body. The daemon writes the draft body to a local
  // file before `gh pr create -F <file>`; that file is exactly what all
  // three check scripts already accept as their first arg. Surfacing
  // them as manifest steps closes the body-only blind spot inside the
  // same retry budget the rest of the gate uses.
  //
  // `pr-vision-trace` was added 2026-05-25 per task `pre-pr-lint-mirror-
  // ci-body-checks` (P1, M1) — same trip-and-fall pattern that caught
  // PRs #863, #869, #870 (body-only edits needed an empty `chore(ci):
  // retrigger` commit). Lifting all three body lints to the local stack
  // closes the operator's feedback loop.

  test("appends three new steps named `pr-self-grade`, `pr-security-review`, `pr-vision-trace`", () => {
    const augmented = appendBodyChecks(STACK_MANIFEST, "draft.md");
    expect(augmented.length).toBe(STACK_MANIFEST.length + 3);
    const names = augmented.slice(STACK_MANIFEST.length).map((s) => s.name);
    expect(names).toEqual(["pr-self-grade", "pr-security-review", "pr-vision-trace"]);
  });

  test("each appended step invokes its canonical `scripts/check-pr-*.mjs` with the body path", () => {
    const augmented = appendBodyChecks(STACK_MANIFEST, "draft.md");
    const selfGrade = augmented.find((s) => s.name === "pr-self-grade");
    const securityReview = augmented.find((s) => s.name === "pr-security-review");
    const visionTrace = augmented.find((s) => s.name === "pr-vision-trace");
    if (selfGrade === undefined) throw new Error("pr-self-grade step missing");
    if (securityReview === undefined) throw new Error("pr-security-review step missing");
    if (visionTrace === undefined) throw new Error("pr-vision-trace step missing");
    expect(selfGrade.cmd).toBe("node");
    expect(selfGrade.args).toEqual(["scripts/check-pr-self-grade.mjs", "draft.md"]);
    expect(securityReview.cmd).toBe("node");
    expect(securityReview.args).toEqual(["scripts/check-pr-security-review.mjs", "draft.md"]);
    expect(visionTrace.cmd).toBe("node");
    expect(visionTrace.args).toEqual(["scripts/check-pr-vision-trace.mjs", "draft.md"]);
  });

  test("appended steps participate in both stages (cheap regex — fast-stage budget unaffected)", () => {
    const augmented = appendBodyChecks(STACK_MANIFEST, "draft.md");
    for (const name of ["pr-self-grade", "pr-security-review", "pr-vision-trace"]) {
      const step = augmented.find((s) => s.name === name);
      if (step === undefined) throw new Error(`${name} step missing`);
      expect(step.stages).toContain("fast");
      expect(step.stages).toContain("full");
    }
  });

  test("the original manifest is preserved unchanged (returns a new frozen array)", () => {
    const before = STACK_MANIFEST.length;
    const augmented = appendBodyChecks(STACK_MANIFEST, "draft.md");
    expect(STACK_MANIFEST.length).toBe(before);
    expect(augmented).not.toBe(STACK_MANIFEST);
  });

  test("runStack picks up the appended steps for fast stage", async () => {
    const augmented = appendBodyChecks(STACK_MANIFEST, "draft.md");
    /** @type {string[]} */
    const seen = [];
    /** @type {import("./run-pre-pr-lint-stack.mjs").RunStep} */
    const fakeRunStep = async (step) => {
      seen.push(step.name);
      return { name: step.name, verdict: "pass", durationMs: 1, exitCode: 0 };
    };
    await runStack("fast", fakeRunStep, augmented);
    expect(seen).toContain("pr-self-grade");
    expect(seen).toContain("pr-security-review");
    expect(seen).toContain("pr-vision-trace");
  });

  test("all three body checks ARE listed in CI_ENV_DEPENDENT_JOBS — pinning the rationale this slice exists to bridge", () => {
    // Drift guard: if a future PR moves these into the static manifest, the
    // `--body` extension becomes redundant. This test fails the moment that
    // happens, surfacing the redundancy instead of letting both code paths
    // silently coexist (rule #2 — single seam).
    expect(CI_ENV_DEPENDENT_JOBS.has("pr-self-grade")).toBe(true);
    expect(CI_ENV_DEPENDENT_JOBS.has("pr-security-review")).toBe(true);
    expect(CI_ENV_DEPENDENT_JOBS.has("pr-vision-trace")).toBe(true);
  });
});

describe("buildSkippedBodyChecksWarning (task `pre-pr-lint-mirror-ci-body-checks` — closes the operator-local-vs-CI feedback gap)", () => {
  // Pure function — the test pins the exact wording so an accidental
  // rename of the body-check names in `appendBodyChecks` immediately
  // surfaces here. Rule #2 — single source of truth for the operator-
  // facing surface.
  //
  // Source: task `pre-pr-lint-mirror-ci-body-checks` (P1, M1).
  // Observed 2026-05-25 across PRs #863, #869, #870 — every body-only
  // edit shipped without the operator knowing 3 CI gates were going to
  // re-run. Without the warning the feedback loop is "push → wait 2-3
  // min → CI fails → re-edit body → push again with empty retrigger
  // commit"; with the warning the operator knows immediately that
  // `--body=<path>` enables full local coverage.

  test("warning names all three body-only CI gates", () => {
    const w = buildSkippedBodyChecksWarning();
    expect(w).toContain("pr-self-grade");
    expect(w).toContain("pr-security-review");
    expect(w).toContain("pr-vision-trace");
  });

  test("warning names the canonical `--body=<path>` flag the operator should pass", () => {
    const w = buildSkippedBodyChecksWarning();
    expect(w).toContain("--body=");
  });

  test("warning names the auto-discovery path `pr-body.md` as a no-flag alternative", () => {
    const w = buildSkippedBodyChecksWarning();
    expect(w).toContain("pr-body.md");
  });

  test("warning makes clear CI will still run the gates — local skip is a fast-path, not a bypass", () => {
    const w = buildSkippedBodyChecksWarning();
    // Operator must understand that no `--body=<path>` is NOT a green
    // light to skip the gates — CI will still enforce them. Rule #10
    // (deterministic enforcement is in CI; local mirror is a feedback
    // accelerator).
    expect(w).toMatch(/CI will still run them/i);
  });

  test("warning is multi-line + has the canonical `[pre-pr-lint] note` prefix the operator can grep for", () => {
    const w = buildSkippedBodyChecksWarning();
    expect(w.startsWith("[pre-pr-lint] note")).toBe(true);
    expect(w.split("\n").length).toBeGreaterThanOrEqual(3);
  });
});

describe("renderJson --json output shape", () => {
  // Pin the doc claim in `docs/daemon-pre-pr-gate.md` § Operator commands —
  // "Machine-readable output (one JSON line per step + a final summary)".
  // Pre-fix renderJson collapsed everything onto one line, contradicting the
  // documented shape. The shape matters: a consumer (e.g., the dashboard
  // pre-PR gate widget filed under `daemon-pre-pr-gate-fixture` follow-ups,
  // or `jq -c` invocations from the operator) should be able to discriminate
  // per-step lines from the summary without counting array indices.

  /** @type {import("./run-pre-pr-lint-stack.mjs").StackResult} */
  const passingResult = {
    stage: "fast",
    allPass: true,
    steps: [
      { name: "alpha", verdict: "pass", durationMs: 10, exitCode: 0 },
      { name: "beta", verdict: "pass", durationMs: 20, exitCode: 0 },
    ],
  };

  test("emits one JSON line per step plus a summary line (NDJSON)", () => {
    const out = renderJson(passingResult);
    const lines = out.split("\n");
    expect(lines).toHaveLength(passingResult.steps.length + 1);
    // every line must be valid JSON on its own (NDJSON contract)
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });

  test("per-step lines preserve StepResult shape (name/verdict/durationMs/exitCode)", () => {
    const lines = renderJson(passingResult).split("\n");
    const stepLines = lines.slice(0, passingResult.steps.length);
    for (let i = 0; i < stepLines.length; i++) {
      const stepLine = stepLines[i];
      if (stepLine === undefined) throw new Error(`missing step line at index ${i}`);
      const parsed = JSON.parse(stepLine);
      expect(parsed).toEqual(passingResult.steps[i]);
    }
  });

  test("summary line carries summary:true + stage + allPass + stepCount", () => {
    const lines = renderJson(passingResult).split("\n");
    const lastLine = lines[lines.length - 1];
    if (lastLine === undefined) throw new Error("renderJson produced no output");
    const summary = JSON.parse(lastLine);
    expect(summary.summary).toBe(true);
    expect(summary.stage).toBe("fast");
    expect(summary.allPass).toBe(true);
    expect(summary.stepCount).toBe(passingResult.steps.length);
  });

  test("failed step's stderrTail is preserved on its line (operator can grep one line for failure detail)", () => {
    /** @type {import("./run-pre-pr-lint-stack.mjs").StackResult} */
    const mixed = {
      stage: "full",
      allPass: false,
      steps: [
        { name: "alpha", verdict: "pass", durationMs: 10, exitCode: 0 },
        { name: "beta", verdict: "fail", durationMs: 20, exitCode: 1, stderrTail: "boom\nbang" },
      ],
    };
    const lines = renderJson(mixed).split("\n");
    const betaRaw = lines[1];
    if (betaRaw === undefined) throw new Error("missing beta step line");
    const betaLine = JSON.parse(betaRaw);
    expect(betaLine.verdict).toBe("fail");
    expect(betaLine.stderrTail).toBe("boom\nbang");
    const summaryRaw = lines[lines.length - 1];
    if (summaryRaw === undefined) throw new Error("missing summary line");
    const summary = JSON.parse(summaryRaw);
    expect(summary.allPass).toBe(false);
  });
});

describe("lefthook pre-push contract", () => {
  // Pin the rule #10 deterministic-enforcement claim in the daemon's brief
  // (`novel/tick-loop/src/daemon.ts`: "the daemon runs the same gate humans
  // run via `lefthook` `pre-push`"). If `lefthook.yml` drifts back to running
  // `pnpm check` (or any path that bypasses the canonical manifest), this
  // test fails — the brief's claim becomes false the moment that line moves.
  test("lefthook.yml pre-push invokes pnpm pre-pr-lint (single source of truth)", () => {
    const lefthookYml = readFileSync(resolve(REPO_ROOT, "lefthook.yml"), "utf8");
    const prePushSection = lefthookYml.split(/^pre-push:$/m)[1] ?? "";
    expect(prePushSection).toContain("pnpm pre-pr-lint");
  });

  // Slice 19/N: the lefthook→pnpm→canonical-script chain has a third link
  // unpinned by the test above. `pnpm pre-pr-lint` resolves through
  // `package.json scripts["pre-pr-lint"]`; if a future PR removes that entry
  // or rewrites it to invoke a different file, lefthook pre-push fails with a
  // confusing pnpm error and the daemon brief's `pnpm pre-pr-lint` mandate
  // silently misroutes — both transports break in lockstep, but neither CI
  // nor the slice-5 manifest-vs-CI test catches the drift (CI invokes the
  // individual `needs:` jobs directly, not through pnpm). The two tests
  // below pin the missing link: the script entry exists, and its body still
  // invokes the canonical manifest module path the rest of the gate keys
  // off. Same shape as the lefthook test above (string-contains pin on a
  // single source of truth in a small config file).
  test("package.json defines a `pre-pr-lint` script (so `pnpm pre-pr-lint` resolves)", () => {
    const pkgJson = JSON.parse(readFileSync(resolve(REPO_ROOT, "package.json"), "utf8"));
    expect(pkgJson.scripts?.["pre-pr-lint"]).toBeTypeOf("string");
    expect(pkgJson.scripts["pre-pr-lint"].length).toBeGreaterThan(0);
  });

  test("package.json `pre-pr-lint` script invokes the canonical manifest module", () => {
    const pkgJson = JSON.parse(readFileSync(resolve(REPO_ROOT, "package.json"), "utf8"));
    expect(pkgJson.scripts["pre-pr-lint"]).toContain("scripts/run-pre-pr-lint-stack.mjs");
  });
});

describe("stripGitHookEnv", () => {
  // Without this filter, `git push` -> lefthook pre-push -> pnpm pre-pr-lint
  // runs the stack with GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE inherited
  // from the outer git invocation. Vitest steps that bootstrap a fresh git
  // repo in a tmpdir (e.g. cross-repo-runner integration tests) misroute
  // their inner `git` to the parent's index and fail with "host is not
  // bootstrapped". The standalone `pnpm pre-pr-lint` invocation never
  // exhibits this, so the gate looked green locally but failed at push —
  // the canonical failure mode for "local lint stack drift vs CI" the brief
  // calls out (TASKS.md daemon-pre-pr-gate-fixture § Risk).

  test("removes the names git exports to its hooks", () => {
    const stripped = stripGitHookEnv({
      PATH: "/usr/bin",
      HOME: "/Users/x",
      GIT_DIR: "/Users/x/repo/.git",
      GIT_WORK_TREE: "/Users/x/repo",
      GIT_INDEX_FILE: "/tmp/git-index",
      GIT_PREFIX: "",
      GIT_OBJECT_DIRECTORY: "/objects",
      GIT_ALTERNATE_OBJECT_DIRECTORIES: "/alt",
      GIT_REFLOG_ACTION: "push",
      GIT_INTERNAL_GETTEXT_SH_SCHEME: "gnu",
    });
    expect(stripped).toEqual({ PATH: "/usr/bin", HOME: "/Users/x" });
  });

  test("preserves unrelated env names verbatim (no copy/clone surprises)", () => {
    const input = { PATH: "/bin", NODE_ENV: "test", FOO: "bar" };
    const stripped = stripGitHookEnv(input);
    expect(stripped).toEqual(input);
    // Defensive: we want a copy, not the same reference, so callers can
    // safely spread additional keys onto the result.
    expect(stripped).not.toBe(input);
  });

  test("is a no-op when no git-hook-leaked names are set (the standalone-invocation case)", () => {
    const input = { PATH: "/bin" };
    expect(stripGitHookEnv(input)).toEqual(input);
  });
});

describe("ci.yml drift-protection", () => {
  // The brief of `daemon-pre-pr-gate-fixture` (Risk § "Local lint stack drift vs CI")
  // claims `scripts/run-pre-pr-lint-stack.mjs` is canonical and CI runs the same
  // logical set of steps. Without a test, that claim drifts: a future PR adds a
  // CI lint job, forgets the manifest, and the daemon's pre-PR gate silently
  // stops covering it — the failure mode operator-side cleanup is supposed to
  // prevent. This block pins the bidirectional set equality between the CI
  // aggregator's `needs:` list and the manifest's `full` stage, with a small
  // explicit allowlist for the env-dependent jobs the manifest cannot run
  // offline (per `STACK_MANIFEST` JSDoc § "env-dependent jobs are intentionally
  // absent").

  // `CI_ENV_DEPENDENT_JOBS` and `CI_TO_MANIFEST_ALIAS` were lifted into the
  // canonical manifest module (slice 17/N) so the docs' env-dependent
  // allowlist enumeration in `docs/daemon-pre-pr-gate.md` and this test both
  // pin against one source. The local `CI_ENV_DEPENDENT_KEYS` set is just the
  // membership view this block needs.
  const CI_ENV_DEPENDENT_KEYS = new Set(CI_ENV_DEPENDENT_JOBS.keys());

  test("manifest's full stage covers every offline-reproducible CI lint job (bidirectional)", () => {
    const yml = readFileSync(resolve(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");
    const ciNeeds = extractCiAggregatorNeeds(yml);
    expect(ciNeeds.length).toBeGreaterThan(20); // sanity — the aggregator is the full stack

    const expectedManifestNames = new Set(
      ciNeeds.filter((n) => !CI_ENV_DEPENDENT_KEYS.has(n)).map((n) => CI_TO_MANIFEST_ALIAS[n] ?? n),
    );
    const actualManifestNames = new Set(selectSteps("full").map((s) => s.name));

    // Bidirectional set equality: a missing CI job means the daemon's gate
    // doesn't cover it locally; a stray manifest entry means the manifest
    // claims to gate something that's not actually a CI lint job.
    const missingFromManifest = [...expectedManifestNames].filter(
      (n) => !actualManifestNames.has(n),
    );
    const extraInManifest = [...actualManifestNames].filter((n) => !expectedManifestNames.has(n));
    expect({ missingFromManifest, extraInManifest }).toEqual({
      missingFromManifest: [],
      extraInManifest: [],
    });
  });

  test("extractCiAggregatorNeeds returns at least one well-known job (parser sanity)", () => {
    const yml = readFileSync(resolve(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");
    const ciNeeds = extractCiAggregatorNeeds(yml);
    expect(ciNeeds).toContain("biome");
    expect(ciNeeds).toContain("typecheck");
    expect(ciNeeds).toContain("markdownlint");
  });
});

describe("docs/daemon-pre-pr-gate.md drift-protection", () => {
  // Slice 8/N promoted `rule-7-chaos-coverage` into the fast stage, but the
  // operator-facing doc shipped in slice 9/N (same day, separate branch) was
  // written against the pre-slice-8 manifest and listed `rule-7` only in the
  // full-stage section — a silent docs↔manifest drift the slice-7 brief
  // parity test does not catch (it pins brief↔manifest, not docs↔manifest).
  // Slice 13/N closes that fourth parity surface so the canonical operator
  // explanation cannot drift behind the manifest the next time a step
  // changes stages.

  /**
   * Extract step names from the bulleted fast-stage list at
   * `docs/daemon-pre-pr-gate.md` § "What the gate enforces". The list shape
   * is `- \`<name>\` — <description>`. The fast-stage list is bounded above
   * by the section's intro paragraph and below by the next paragraph
   * starting "The full stage adds"; slicing between them isolates exactly
   * the bullet block.
   *
   * @param {string} doc
   * @returns {string[]}
   */
  function extractDocFastStageNames(doc) {
    const header = doc.search(/^The fast stage \(default\) runs/m);
    if (header < 0) throw new Error("docs/daemon-pre-pr-gate.md has no fast-stage section header");
    const tail = doc.slice(header);
    const fullSectionStart = tail.search(/^The full stage adds/m);
    const block = fullSectionStart < 0 ? tail : tail.slice(0, fullSectionStart);
    /** @type {string[]} */
    const names = [];
    for (const line of block.split("\n")) {
      const m = /^- `([a-z][a-z0-9-]*)`/.exec(line);
      if (m?.[1] !== undefined) names.push(m[1]);
    }
    return names;
  }

  test("doc's fast-stage list ↔ manifest's fast stage (bidirectional)", () => {
    const doc = readFileSync(resolve(REPO_ROOT, "docs/daemon-pre-pr-gate.md"), "utf8");
    const docNames = new Set(extractDocFastStageNames(doc));
    const manifestNames = new Set(selectSteps("fast").map((s) => s.name));

    const missingFromDoc = [...manifestNames].filter((n) => !docNames.has(n));
    const extraInDoc = [...docNames].filter((n) => !manifestNames.has(n));
    expect({ missingFromDoc, extraInDoc }).toEqual({ missingFromDoc: [], extraInDoc: [] });
  });

  test("extractDocFastStageNames parses at least one well-known step (parser sanity)", () => {
    const doc = readFileSync(resolve(REPO_ROOT, "docs/daemon-pre-pr-gate.md"), "utf8");
    const names = extractDocFastStageNames(doc);
    expect(names).toContain("biome");
    expect(names).toContain("typecheck");
  });
});

describe("ci.yml aggregator bash-loop drift-protection", () => {
  // Slice 5/N pinned the `ci:` aggregator's `needs:` list against the manifest's
  // full stage. One drift surface remained: the aggregator's `gate` step
  // hand-enumerates `${{ needs.X.result }}` across three bash buckets
  // (must-succeed; supervisor-integration success-or-skipped; pr-self-grade /
  // pattern-index / skill-rule-cap success-or-skipped). A future PR adding a
  // job to `needs:` and forgetting the bash bucket would let the aggregator
  // report green when that job failed — silently undergating the meta-check
  // operators key off. Bidirectional set equality between `needs:` and the
  // union of the three buckets pins this fourth-layer parity surface.

  /**
   * Extract every `needs.<job>.result` reference from the aggregator's `gate`
   * step. The bash blocks use the GitHub Actions templating shape
   * `${{ needs.<name>.result }}`; one regex over the whole `ci:` block
   * captures them. Pure string parse — the workflow file's shape is owned by
   * this repo, same justification as `extractCiAggregatorNeeds`.
   *
   * @param {string} yml
   * @returns {string[]}  job names in source order, with duplicates removed
   */
  function extractAggregatorBashCheckedJobs(yml) {
    const ciStart = yml.search(/^ {2}ci:$/m);
    if (ciStart < 0) throw new Error("ci.yml has no top-level `ci:` job");
    const ciBlock = yml.slice(ciStart);
    /** @type {Set<string>} */
    const seen = new Set();
    const re = /\$\{\{\s*needs\.([a-z][a-z0-9-]*)\.result\s*\}\}/g;
    for (const match of ciBlock.matchAll(re)) {
      if (match[1] !== undefined) seen.add(match[1]);
    }
    return [...seen];
  }

  test("every job in `needs:` appears in the aggregator's bash gate-check (bidirectional)", () => {
    const yml = readFileSync(resolve(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");
    const ciNeeds = new Set(extractCiAggregatorNeeds(yml));
    const checkedJobs = new Set(extractAggregatorBashCheckedJobs(yml));

    // A job in `needs:` but not in the bash check is silently ungated — the
    // aggregator passes even when that job fails. A job in the bash check but
    // not in `needs:` would error at workflow load (GitHub Actions validates
    // `needs.X` references), so this direction is automatic in production —
    // we still pin it as a fast local signal that catches the typo before
    // pushing.
    const inNeedsNotChecked = [...ciNeeds].filter((n) => !checkedJobs.has(n));
    const checkedNotInNeeds = [...checkedJobs].filter((n) => !ciNeeds.has(n));
    expect({ inNeedsNotChecked, checkedNotInNeeds }).toEqual({
      inNeedsNotChecked: [],
      checkedNotInNeeds: [],
    });
  });

  test("extractAggregatorBashCheckedJobs returns at least one well-known job (parser sanity)", () => {
    const yml = readFileSync(resolve(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");
    const checkedJobs = extractAggregatorBashCheckedJobs(yml);
    expect(checkedJobs).toContain("biome");
    expect(checkedJobs).toContain("typecheck");
    expect(checkedJobs).toContain("linux-supervisor-integration"); // from the success|skipped bucket
  });

  // Slice 21/N: pins per-bucket membership. Slice 15 pins the union of the
  // three bash buckets equals `needs:`, but a regression that moves
  // `pr-self-grade` from `prOnlySkippable` (success|skipped) to
  // `mustSucceed` (only success) would silently break every push to `main`
  // without tripping the union check. Inversely, moving `biome` from
  // `mustSucceed` to `supervisorSkippable` would silently ungate the lint —
  // a `skipped` biome would now pass the gate. Pinning each bucket against
  // `CI_BASH_GATE_BUCKETS` (canonical constant — rule #2 — single seam,
  // single pin) catches both shapes.

  /**
   * Extract the three bash buckets from the `ci:` aggregator's `gate` step
   * separately. Each bucket is a `for r in "${{ needs.X.result }}" \ ... ; do
   * <body>; done` block; the first uses `[ "$r" = "success" ] || fail=1`
   * (mustSucceed), the next two use `case "$r" in success|skipped) ;; *)
   * fail=1 ;;` (skippable). Distinguishing them needs the body, not just the
   * `for` line — the same job name could in principle appear in multiple
   * buckets (a lint typo) and the slice 15 union test would still pass.
   *
   * @param {string} yml
   * @returns {{ mustSucceed: Set<string>, skippable: Set<string>[] }}
   *   `skippable` is an array because the workflow has two distinct
   *   skippable buckets (supervisor-integration, pr-only). The caller
   *   resolves which is which by membership against the canonical constant.
   */
  /**
   * Extract `needs.<name>.result` references from a single bucket's `for`
   * args. Pulled out of `extractAggregatorBashBuckets` to keep that
   * function's cognitive complexity below the biome cap.
   *
   * @param {string} args
   * @returns {Set<string>}
   */
  function namesFromBashForArgs(args) {
    /** @type {Set<string>} */
    const names = new Set();
    const re = /\$\{\{\s*needs\.([a-z][a-z0-9-]*)\.result\s*\}\}/g;
    for (const m of args.matchAll(re)) {
      if (m[1] !== undefined) names.add(m[1]);
    }
    return names;
  }

  /**
   * Classify a single `for r in <args>; do <body>; done` block by the body's
   * comparator. Returns `"must-succeed"` for `[ "$r" = "success" ]`,
   * `"skippable"` for `case "$r" in success|skipped) ;;`, or `null` for any
   * other body shape (the parser ignores those — the workflow doesn't
   * currently have any, but a future edit might).
   *
   * @param {string} body
   * @returns {"must-succeed" | "skippable" | null}
   */
  function classifyBashForBody(body) {
    if (body.includes('= "success" ]')) return "must-succeed";
    if (body.includes("success|skipped")) return "skippable";
    return null;
  }

  /**
   * Pull every `for r in <args>; do <body> done` block out of the ci block
   * as `{kind, names}` records, dropping any block whose body shape we
   * don't recognise.
   *
   * @param {string} ciBlock
   * @returns {{ kind: "must-succeed" | "skippable", names: Set<string> }[]}
   */
  function parseBashForBlocks(ciBlock) {
    // Args span multi-line continuations (` \\\n`); body is whatever sits
    // between `do` and `done`. `[\s\S]` makes `.` cross newlines.
    const blockRe = /for r in ([\s\S]*?); do([\s\S]*?)done/g;
    return [...ciBlock.matchAll(blockRe)].flatMap((match) => {
      const kind = classifyBashForBody(match[2] ?? "");
      if (kind === null) return [];
      return [{ kind, names: namesFromBashForArgs(match[1] ?? "") }];
    });
  }

  /**
   * @param {string} yml
   * @returns {{ mustSucceed: Set<string>, skippable: Set<string>[] }}
   */
  function extractAggregatorBashBuckets(yml) {
    const ciStart = yml.search(/^ {2}ci:$/m);
    if (ciStart < 0) throw new Error("ci.yml has no top-level `ci:` job");
    const blocks = parseBashForBlocks(yml.slice(ciStart));
    const mustSucceed = new Set(
      blocks.filter((b) => b.kind === "must-succeed").flatMap((b) => [...b.names]),
    );
    const skippable = blocks.filter((b) => b.kind === "skippable").map((b) => b.names);
    return { mustSucceed, skippable };
  }

  test("each bash bucket's membership matches CI_BASH_GATE_BUCKETS (per-bucket)", () => {
    const yml = readFileSync(resolve(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");
    const parsed = extractAggregatorBashBuckets(yml);

    // mustSucceed is direct.
    expect([...parsed.mustSucceed].sort()).toEqual([...CI_BASH_GATE_BUCKETS.mustSucceed].sort());

    // The two skippable buckets are distinguished by membership against
    // the canonical constants (the workflow's source order is informational
    // — the test resolves identity by content, not position).
    expect(parsed.skippable.length).toBe(2);
    const expectedSupervisor = new Set(CI_BASH_GATE_BUCKETS.supervisorSkippable);
    const expectedPrOnly = new Set(CI_BASH_GATE_BUCKETS.prOnlySkippable);
    /** @type {Set<string> | undefined} */
    let supervisorBucket;
    /** @type {Set<string> | undefined} */
    let prOnlyBucket;
    for (const bucket of parsed.skippable) {
      if ([...bucket].some((n) => expectedSupervisor.has(n))) {
        supervisorBucket = bucket;
      } else {
        prOnlyBucket = bucket;
      }
    }
    expect(supervisorBucket).toBeDefined();
    expect(prOnlyBucket).toBeDefined();
    expect([...(supervisorBucket ?? [])].sort()).toEqual([...expectedSupervisor].sort());
    expect([...(prOnlyBucket ?? [])].sort()).toEqual([...expectedPrOnly].sort());
  });

  test("CI_BASH_GATE_BUCKETS partitions `needs:` (no overlap, full coverage)", () => {
    // Sanity invariant on the canonical constant itself: the three buckets
    // must be disjoint, and their union must equal `needs:`. If a future
    // edit accidentally adds a job to two buckets, the bash gate's
    // semantics for that job become whichever check `fail=1` runs first
    // (mustSucceed wins because it appears first in the workflow) — which
    // the bucket-membership test above would catch only if the job's
    // position changed.
    const yml = readFileSync(resolve(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");
    const ciNeeds = new Set(extractCiAggregatorNeeds(yml));
    const { mustSucceed, supervisorSkippable, prOnlySkippable } = CI_BASH_GATE_BUCKETS;
    const overlapMustSupervisor = [...mustSucceed].filter((n) => supervisorSkippable.has(n));
    const overlapMustPrOnly = [...mustSucceed].filter((n) => prOnlySkippable.has(n));
    const overlapSupervisorPrOnly = [...supervisorSkippable].filter((n) => prOnlySkippable.has(n));
    expect({ overlapMustSupervisor, overlapMustPrOnly, overlapSupervisorPrOnly }).toEqual({
      overlapMustSupervisor: [],
      overlapMustPrOnly: [],
      overlapSupervisorPrOnly: [],
    });
    const union = new Set([...mustSucceed, ...supervisorSkippable, ...prOnlySkippable]);
    const missingFromConstant = [...ciNeeds].filter((n) => !union.has(n));
    const extraInConstant = [...union].filter((n) => !ciNeeds.has(n));
    expect({ missingFromConstant, extraInConstant }).toEqual({
      missingFromConstant: [],
      extraInConstant: [],
    });
  });
});

describe("docs/daemon-pre-pr-gate.md full-stage drift-protection", () => {
  // Slice 16/N: closes the docs↔manifest parity gap for the full stage.
  // Slice 13/N pinned the fast-stage bullet list; the full stage was prose,
  // and the prose was already drifted (silent omissions of
  // `rule-5-glossary-discipline` and `no-singleton-experiment` after their
  // full-stage entries landed in earlier work — exactly the failure mode the
  // slice-13 test catches for the fast stage). Refactoring the prose into a
  // bullet list in the same shape as the fast-stage list and pinning it
  // bidirectionally extends slice 13's invariant to the operator-side gate's
  // full set.

  /**
   * Extract step names from the bulleted full-stage list at
   * `docs/daemon-pre-pr-gate.md` § "What the gate enforces". Mirrors the
   * fast-stage extractor at line 374 in shape: bound the block by the
   * section's intro paragraph above and the next paragraph (the
   * env-dependent CI jobs note) below; parse `- \`<name>\`` bullets in
   * between.
   *
   * @param {string} doc
   * @returns {string[]}
   */
  function extractDocFullStageNames(doc) {
    const header = doc.search(/^The full stage adds/m);
    if (header < 0) {
      throw new Error("docs/daemon-pre-pr-gate.md has no full-stage section header");
    }
    const tail = doc.slice(header);
    const envDependentStart = tail.search(/^The env-dependent /m);
    const block = envDependentStart < 0 ? tail : tail.slice(0, envDependentStart);
    /** @type {string[]} */
    const names = [];
    for (const line of block.split("\n")) {
      const m = /^- `([a-z][a-z0-9-]*)`/.exec(line);
      if (m?.[1] !== undefined) names.push(m[1]);
    }
    return names;
  }

  test("doc's full-stage list ↔ manifest's full-only steps (bidirectional)", () => {
    // The doc's full-stage section enumerates the *additional* steps the full
    // stage adds beyond fast (the fast-stage list above already enumerates the
    // shared steps). The corresponding manifest set is "full-tagged minus
    // fast-tagged" — i.e. the steps that exist only in full. Comparing against
    // the raw `selectSteps("full")` would double-count the fast steps, since
    // every fast entry is also tagged `full` in the manifest.
    const doc = readFileSync(resolve(REPO_ROOT, "docs/daemon-pre-pr-gate.md"), "utf8");
    const docNames = new Set(extractDocFullStageNames(doc));
    const fastNames = new Set(selectSteps("fast").map((s) => s.name));
    const fullOnlyNames = new Set(
      selectSteps("full")
        .map((s) => s.name)
        .filter((n) => !fastNames.has(n)),
    );

    const missingFromDoc = [...fullOnlyNames].filter((n) => !docNames.has(n));
    const extraInDoc = [...docNames].filter((n) => !fullOnlyNames.has(n));
    expect({ missingFromDoc, extraInDoc }).toEqual({ missingFromDoc: [], extraInDoc: [] });
  });

  test("extractDocFullStageNames parses at least one well-known step (parser sanity)", () => {
    const doc = readFileSync(resolve(REPO_ROOT, "docs/daemon-pre-pr-gate.md"), "utf8");
    const names = extractDocFullStageNames(doc);
    expect(names).toContain("vitest");
    expect(names).toContain("rule-1-novel-justification");
  });
});

describe("docs/daemon-pre-pr-gate.md env-dependent allowlist drift-protection", () => {
  // Slice 17/N: closes the sixth and last parity surface. The doc's
  // "What the gate enforces" section enumerates the env-dependent CI jobs
  // intentionally absent from the manifest (`hygiene` /
  // `linux-supervisor-integration` / `macos-supervisor-integration` /
  // `maciek-smoke` / `pr-self-grade`). That enumeration mirrored the
  // `CI_ENV_DEPENDENT` set previously hardcoded in this test file — two
  // sources of truth, drift waiting to happen the next time a CI job's
  // env-dependence changes. Slice 17/N lifts the allowlist into the canonical
  // manifest module (`CI_ENV_DEPENDENT_JOBS`), this test imports it, and the
  // block below asserts the doc enumerates exactly those jobs. Same shape as
  // the four manifest-driven parity blocks above.

  /**
   * Extract job names from the env-dependent enumeration sentence in
   * `docs/daemon-pre-pr-gate.md`. The sentence has the shape
   * `The env-dependent CI jobs (`a` / `b` / `c` / …) are intentionally absent`.
   * Pure string parse; we slice the sentence and pick out the backtick-quoted
   * names. Same justification as `extractCiAggregatorNeeds` — the doc's shape
   * is owned by this repo, so the regex contract is stable.
   *
   * @param {string} doc
   * @returns {string[]}
   */
  function extractDocEnvDependentJobs(doc) {
    const m = /^The env-dependent CI jobs \(([^)]+)\)/m.exec(doc);
    if (m === null || m[1] === undefined) {
      throw new Error("docs/daemon-pre-pr-gate.md has no env-dependent enumeration sentence");
    }
    /** @type {string[]} */
    const names = [];
    for (const match of m[1].matchAll(/`([a-z][a-z0-9-]*)`/g)) {
      if (match[1] !== undefined) names.push(match[1]);
    }
    return names;
  }

  test("doc's env-dependent enumeration ↔ CI_ENV_DEPENDENT_JOBS (bidirectional)", () => {
    const doc = readFileSync(resolve(REPO_ROOT, "docs/daemon-pre-pr-gate.md"), "utf8");
    const docNames = new Set(extractDocEnvDependentJobs(doc));
    const allowlistNames = new Set(CI_ENV_DEPENDENT_JOBS.keys());

    const missingFromDoc = [...allowlistNames].filter((n) => !docNames.has(n));
    const extraInDoc = [...docNames].filter((n) => !allowlistNames.has(n));
    expect({ missingFromDoc, extraInDoc }).toEqual({ missingFromDoc: [], extraInDoc: [] });
  });

  test("extractDocEnvDependentJobs parses at least one well-known job (parser sanity)", () => {
    const doc = readFileSync(resolve(REPO_ROOT, "docs/daemon-pre-pr-gate.md"), "utf8");
    const names = extractDocEnvDependentJobs(doc);
    expect(names).toContain("hygiene");
    expect(names).toContain("linux-supervisor-integration");
  });

  test("every CI_ENV_DEPENDENT_JOBS entry carries a non-empty reason (silent additions hide drift)", () => {
    for (const [name, reason] of CI_ENV_DEPENDENT_JOBS) {
      expect(typeof reason).toBe("string");
      expect(reason.length, `${name} needs a one-line reason`).toBeGreaterThan(0);
    }
  });
});

describe("resolveDiffBase (slice 31/N — freshness-aware diff base)", () => {
  /** @type {(timestamps: Record<string, number>) => (ref: string) => number} */
  const tsFromMap = (m) => (r) => m[r] ?? 0;

  test("returns explicit override from PRE_PR_LINT_DIFF_BASE", () => {
    expect(
      resolveDiffBase({
        env: { PRE_PR_LINT_DIFF_BASE: "v1.2.3" },
        refExists: () => false,
        refTimestamp: () => 0,
      }),
    ).toBe("v1.2.3");
  });

  test("ignores empty override (treated as unset)", () => {
    expect(
      resolveDiffBase({
        env: { PRE_PR_LINT_DIFF_BASE: "" },
        refExists: (r) => r === "main",
        refTimestamp: tsFromMap({ main: 100 }),
      }),
    ).toBe("main");
  });

  test("returns the only resolving ref (single-candidate case)", () => {
    expect(
      resolveDiffBase({
        env: {},
        refExists: (r) => r === "origin/main",
        refTimestamp: tsFromMap({ "origin/main": 50 }),
      }),
    ).toBe("origin/main");
  });

  test("hard fallback to `origin/main` when no candidate resolves", () => {
    expect(resolveDiffBase({ env: {}, refExists: () => false, refTimestamp: () => 0 })).toBe(
      "origin/main",
    );
  });

  test("daemon-worktree case: local `main` stale, `upstream/main` fresh → picks `upstream/main`", () => {
    // Concrete reproducer: PR #330's pre-rebase state. local `main` =
    // 1175a07 (slice 29 era, ts=100); `upstream/main` = 2fd8ce5 (slice 30
    // merged, ts=200); `origin/main` = d5742f5 (placeholder remote, ts=50).
    expect(
      resolveDiffBase({
        env: {},
        refExists: (r) => r === "main" || r === "origin/main" || r === "upstream/main",
        refTimestamp: tsFromMap({ main: 100, "origin/main": 50, "upstream/main": 200 }),
      }),
    ).toBe("upstream/main");
  });

  test("dev-machine case: stale `origin/main`, fresh local `main` → picks `main`", () => {
    expect(
      resolveDiffBase({
        env: {},
        refExists: (r) => r === "main" || r === "origin/main",
        refTimestamp: tsFromMap({ main: 200, "origin/main": 100 }),
      }),
    ).toBe("main");
  });

  test("CI case: only `origin/main` exists → picks `origin/main` (no behaviour change)", () => {
    expect(
      resolveDiffBase({
        env: {},
        refExists: (r) => r === "origin/main",
        refTimestamp: tsFromMap({ "origin/main": 200 }),
      }),
    ).toBe("origin/main");
  });

  test("ties broken by reduce-leftmost (stable for in-sync refs)", () => {
    // `upstream/main` listed first → wins on tie. Stability matters for the
    // common dev case where `main` and `origin/main` are at the same commit.
    expect(
      resolveDiffBase({
        env: {},
        refExists: () => true,
        refTimestamp: () => 100,
      }),
    ).toBe("upstream/main");
  });
});

/**
 * Count `--diff-base=<v>` argv occurrences across a manifest.
 * @param {readonly { args: readonly string[] }[]} manifest
 * @param {string} v
 * @returns {number}
 */
function countDiffBaseArgs(manifest, v) {
  return manifest.reduce((n, s) => n + s.args.filter((a) => a === `--diff-base=${v}`).length, 0);
}

/**
 * Count env-value occurrences across a manifest.
 * @param {readonly { env?: Record<string, string> }[]} manifest
 * @param {string} v
 * @returns {number}
 */
function countEnvValues(manifest, v) {
  return manifest.reduce((n, s) => n + Object.values(s.env ?? {}).filter((x) => x === v).length, 0);
}

describe("withResolvedDiffBase (slice 31/N — manifest rewrite)", () => {
  test("no-op fast path when diffBase === 'origin/main' (returns same reference)", () => {
    expect(withResolvedDiffBase(STACK_MANIFEST, "origin/main")).toBe(STACK_MANIFEST);
  });

  test("rewrites every `*_DIFF_BASE` env value from origin/main to the resolved base", () => {
    const swapped = withResolvedDiffBase(STACK_MANIFEST, "main");
    expect(countEnvValues(swapped, "origin/main")).toBe(0);
    expect(countEnvValues(swapped, "main")).toBeGreaterThanOrEqual(4);
  });

  test("rewrites every `--diff-base=origin/main` argv to the resolved base", () => {
    const swapped = withResolvedDiffBase(STACK_MANIFEST, "main");
    expect(countDiffBaseArgs(swapped, "origin/main")).toBe(0);
    expect(countDiffBaseArgs(swapped, "main")).toBeGreaterThanOrEqual(3);
  });

  test("preserves the original manifest unchanged (pure transform — referential equality of all args+env)", () => {
    const beforeArgCount = countDiffBaseArgs(STACK_MANIFEST, "origin/main");
    const beforeEnvCount = countEnvValues(STACK_MANIFEST, "origin/main");
    withResolvedDiffBase(STACK_MANIFEST, "main");
    expect(countDiffBaseArgs(STACK_MANIFEST, "origin/main")).toBe(beforeArgCount);
    expect(countEnvValues(STACK_MANIFEST, "origin/main")).toBe(beforeEnvCount);
  });

  test("returns a frozen array (preserves manifest's freeze contract)", () => {
    const swapped = withResolvedDiffBase(STACK_MANIFEST, "main");
    expect(Object.isFrozen(swapped)).toBe(true);
  });

  test("steps without origin/main references pass through unchanged (referential equality)", () => {
    const swapped = withResolvedDiffBase(STACK_MANIFEST, "main");
    // `typecheck` has no diff-base/`--since` reference, so the pure transform
    // must return the very same object. (`biome` is now diff-scoped via
    // `--since=origin/main` and IS rewritten — see the next test.)
    const typecheck = STACK_MANIFEST.find((s) => s.name === "typecheck");
    const swappedTypecheck = swapped.find((s) => s.name === "typecheck");
    expect(swappedTypecheck).toBe(typecheck);
  });

  test("rewrites the biome step's `--since=origin/main` to the resolved base", () => {
    const swapped = withResolvedDiffBase(STACK_MANIFEST, "main");
    const biome = swapped.find((s) => s.name === "biome");
    expect(biome?.args).toContain("--since=main");
    expect(biome?.args).not.toContain("--since=origin/main");
  });

  test("regression-floor: pre-slice-31 manifest references origin/main in ≥7 sites", () => {
    const total =
      countDiffBaseArgs(STACK_MANIFEST, "origin/main") +
      countEnvValues(STACK_MANIFEST, "origin/main");
    expect(total).toBeGreaterThanOrEqual(7);
  });
});

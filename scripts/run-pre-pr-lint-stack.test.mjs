// Tests for run-pre-pr-lint-stack.mjs. The runner is a pure orchestrator over
// the manifest + an injected `runStep`; tests stub `runStep` and assert the
// stage filter + green/red verdict logic.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import {
  STACK_MANIFEST,
  buildStepResult,
  parseArgs,
  runStack,
  selectSteps,
  stripGitHookEnv,
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
        expect(s === "fast" || s === "full").toBe(true);
      }
    }
  });

  test("every step name is unique (drift-protection — manifest collisions silently mask failures)", () => {
    const names = STACK_MANIFEST.map((s) => s.name);
    const uniq = new Set(names);
    expect(uniq.size).toBe(names.length);
  });

  test("the fast stage exercises biome / typecheck / markdownlint / tasks-lint / rule-2 / rule-3 / rule-6 / rule-7 / rule-12", () => {
    // Pre-registered scope of the daemon's pre-PR gate (TASKS.md
    // `daemon-pre-pr-lint-gate` Pivot — fast lints close ~80% of the failure
    // modes the operator cleans up). Drift here is what the manifest is
    // supposed to detect; pin the set explicitly. rule-7 was promoted to
    // fast 2026-05-06 (slice 8/N) — it is the 5th of 5 empirically-named
    // failure modes in the brief and walks `novel/**/README.md` only
    // (~0.3s wall-clock, well under the 5-min pivot budget).
    const fastNames = selectSteps("fast")
      .map((s) => s.name)
      .sort();
    expect(fastNames).toEqual(
      [
        "biome",
        "markdownlint",
        "rule-12-scope-discipline",
        "rule-2-dep-coverage",
        "rule-3-doc-first",
        "rule-6-let-it-crash",
        "rule-7-chaos-coverage",
        "tasks-lint",
        "typecheck",
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
  // calls out (TASKS.md daemon-pre-pr-lint-gate § Risk).

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
  // The brief of `daemon-pre-pr-lint-gate` (Risk § "Local lint stack drift vs CI")
  // claims `scripts/run-pre-pr-lint-stack.mjs` is canonical and CI runs the same
  // logical set of steps. Without a test, that claim drifts: a future PR adds a
  // CI lint job, forgets the manifest, and the daemon's pre-PR gate silently
  // stops covering it — the failure mode operator-side cleanup is supposed to
  // prevent. This block pins the bidirectional set equality between the CI
  // aggregator's `needs:` list and the manifest's `full` stage, with a small
  // explicit allowlist for the env-dependent jobs the manifest cannot run
  // offline (per `STACK_MANIFEST` JSDoc § "env-dependent jobs are intentionally
  // absent").

  // Jobs in `ci:`'s `needs:` that the manifest intentionally omits because they
  // require GitHub-runner-only or PR-context plumbing the daemon doesn't have.
  // Each entry needs a one-line reason — silent additions hide drift.
  const CI_ENV_DEPENDENT = new Set([
    "hygiene", // pnpm audit — needs network + advisory DB
    "linux-supervisor-integration", // systemd user bus
    "macos-supervisor-integration", // launchd user agent
    "maciek-smoke", // pipx Python install
    "pr-self-grade", // PR body context (`## Hypothesis self-grade`)
  ]);

  // Two CI job names diverge from their manifest step names. The aliases are
  // pinned here so the equality check passes — any new alias is a deliberate
  // edit, never silent drift.
  /** @type {Record<string, string>} */
  const CI_TO_MANIFEST_ALIAS = {
    test: "vitest", // `pnpm test:coverage` ↔ manifest's `vitest` step
    "glossary-discipline": "rule-5-glossary-discipline", // job is named for the rule's effect; manifest names it for the rule number
  };

  test("manifest's full stage covers every offline-reproducible CI lint job (bidirectional)", () => {
    const yml = readFileSync(resolve(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");
    const ciNeeds = extractCiAggregatorNeeds(yml);
    expect(ciNeeds.length).toBeGreaterThan(20); // sanity — the aggregator is the full stack

    const expectedManifestNames = new Set(
      ciNeeds.filter((n) => !CI_ENV_DEPENDENT.has(n)).map((n) => CI_TO_MANIFEST_ALIAS[n] ?? n),
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
});

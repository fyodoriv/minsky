#!/usr/bin/env node
// Cross-repo check-runner — the entry point invoked by
// `.github/workflows/cross-repo-check.yml`. Takes (host_repo, pr_number,
// experiment_yaml_url), shells out via `gh` to fetch the PR body,
// EXPERIMENT.yaml, diff, and head SHA, runs the 4 cross-repo-portable
// constitutional lints over those substrates, and emits a single-JSON-line
// verdict on stdout. The workflow consumes that verdict and posts a
// GitHub check-run via `gh api …/check-runs`.
//
// Pattern: pure-function-with-I/O-at-edge (Martin 2017 — fetch at the edge,
//   classify in pure code, emit JSON for the workflow); deterministic gate
//   (rule #10 — same input, same output, no LLM in the chain); injected
//   `--gh-bin` for testability (dependency injection at the boundary, per
//   rule #2).
// Source: TASKS.md `cross-repo-ci-action` brief (2026-05-04 daemon brief —
//   v0 ships the locally-testable substrate); docs/cross-repo-portability.md
//   (the 4 cross-repo-portable lints don't require a host clone — they walk
//   per-task substrates that travel with the PR); rule #2 / rule #6 / #10.
// Conformance: full — pure verdict-producer; the I/O is at the
//   `--gh-bin` boundary; no `gh api …/check-runs` POST (the workflow does
//   that — the script just produces the verdict).
//
// Why the script never POSTs the check-run: keeping the side-effect at the
// workflow's `gh api` step (separate from this script's run) means the
// script is locally testable with a mock `--gh-bin` and no GitHub auth —
// the operator can `node scripts/cross-repo-check-runner.mjs --self-test`
// without minsky-bot installed anywhere. The C2 architecture's check-run
// post is a 1-line `gh api` call in the workflow; not duplicated here.
//
// Inputs (CLI flags):
//   --host-repo <owner/name>     The host repo whose PR is being checked.
//   --pr-number <int>            The PR number on the host repo.
//   --experiment-yaml-url <url>  GitHub-API URL to the EXPERIMENT.yaml.
//   --gh-bin <path>              Path to the `gh` CLI (default: `gh`).
//                                Test stubs swap this with a fake gh that
//                                emits canned responses.
//   --work-dir <path>            Where to write fetched substrates. The
//                                script does NOT clean up — the workflow
//                                runs in a fresh runner that gets nuked.
//   --self-test                  Run the built-in self-test (uses an
//                                in-process gh stub) and exit. Used by the
//                                experiment's measurement command.
//   --json-only                  Emit only the JSON verdict to stdout
//                                (no progress lines). Workflow uses this.
//
// Output: a single JSON line on stdout shaped like
//   { "conclusion": "success" | "failure" | "neutral",
//     "summary": "<one-line summary>",
//     "details": "<multi-line markdown>",
//     "head_sha": "<sha-or-null>",
//     "checks": [ { "id": "...", "result": "pass|fail|skip|neutral",
//                   "reason": "..." }, ... ] }
// Exit code is 0 in all cases — the JSON conclusion field carries the
// signal. Non-zero exit is reserved for unexpected runner errors (e.g., gh
// not found, invalid CLI flags).

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

// ---- argv parsing ----------------------------------------------------------

/**
 * @typedef {{
 *   hostRepo: string,
 *   prNumber: number,
 *   experimentYamlUrl: string,
 *   ghBin: string,
 *   workDir: string,
 *   jsonOnly: boolean,
 *   selfTest: boolean,
 * }} CliInputs
 */

/**
 * Parse argv into a typed input record. Throws on missing required flags.
 *
 * @param {string[]} argv
 * @returns {CliInputs}
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: argv parsing is inherently a switch over flag forms (--key=value, --key value, --bool); splitting into per-flag helpers would obscure the single-pass control flow without reducing actual complexity.
export function parseCliArgs(argv) {
  /** @type {Record<string, string>} */
  const flags = {};
  let selfTest = false;
  let jsonOnly = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--self-test") {
      selfTest = true;
      continue;
    }
    if (a === "--json-only") {
      jsonOnly = true;
      continue;
    }
    if (typeof a === "string" && a.startsWith("--")) {
      const key = a.slice(2);
      const value = argv[i + 1];
      if (typeof value !== "string" || value.startsWith("--")) {
        throw new Error(`flag ${a} requires a value`);
      }
      flags[key] = value;
      i++;
    }
  }
  if (selfTest) {
    return {
      hostRepo: flags["host-repo"] ?? "owner/host",
      prNumber: Number(flags["pr-number"] ?? "1"),
      experimentYamlUrl:
        flags["experiment-yaml-url"] ??
        "https://api.github.com/repos/owner/host/contents/.minsky/experiments/foo.yaml?ref=abc",
      ghBin: flags["gh-bin"] ?? "gh",
      workDir: flags["work-dir"] ?? mkdtempSync(join(tmpdir(), "cross-repo-check-")),
      jsonOnly,
      selfTest: true,
    };
  }
  for (const required of ["host-repo", "pr-number", "experiment-yaml-url"]) {
    if (!(required in flags)) {
      throw new Error(`missing required flag --${required}`);
    }
  }
  return {
    hostRepo: /** @type {string} */ (flags["host-repo"]),
    prNumber: Number(flags["pr-number"]),
    experimentYamlUrl: /** @type {string} */ (flags["experiment-yaml-url"]),
    ghBin: flags["gh-bin"] ?? "gh",
    workDir: flags["work-dir"] ?? mkdtempSync(join(tmpdir(), "cross-repo-check-")),
    jsonOnly,
    selfTest: false,
  };
}

// ---- gh shell-out ----------------------------------------------------------

/**
 * @typedef {{
 *   exitCode: number,
 *   stdout: string,
 *   stderr: string,
 * }} GhResult
 */

/**
 * Shell out to the injected `gh` binary. Pure-ish: the command is built
 * deterministically from inputs; the only side-effect is the subprocess
 * call, which the test harness intercepts via `--gh-bin <stub>`.
 *
 * @param {string} ghBin
 * @param {string[]} args
 * @returns {GhResult}
 */
export function runGh(ghBin, args) {
  const result = spawnSync(ghBin, args, { encoding: "utf8" });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

// ---- fetch step ------------------------------------------------------------

/**
 * @typedef {{
 *   prBodyPath: string,
 *   experimentYamlPath: string,
 *   diffPath: string,
 *   headSha: string | null,
 *   experimentYamlReadable: boolean,
 * }} Fetched
 */

/**
 * Fetch substrates via gh; write each to a file in workDir; return the
 * paths. Failures of individual fetches are recorded in the return value
 * (e.g., experimentYamlReadable=false) — the caller decides how to
 * surface them in the verdict (typically `neutral` with a reason).
 *
 * @param {CliInputs} inputs
 * @returns {Fetched}
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: fetchSubstrates orchestrates 4 sequential gh-api calls with per-call error handling; flattening into helper functions would scatter the error-handling pattern. Acceptable per rule #6 (handled-locally).
export function fetchSubstrates(inputs) {
  mkdirSync(inputs.workDir, { recursive: true });
  const prBodyPath = join(inputs.workDir, "pr-body.md");
  const experimentYamlPath = join(inputs.workDir, "experiment.yaml");
  const diffPath = join(inputs.workDir, "pr.diff");

  // PR body — `gh pr view --repo <repo> <num> --json body --jq .body`.
  const bodyRes = runGh(inputs.ghBin, [
    "pr",
    "view",
    "--repo",
    inputs.hostRepo,
    String(inputs.prNumber),
    "--json",
    "body,headRefOid",
    "--jq",
    ".",
  ]);
  let headSha = null;
  if (bodyRes.exitCode === 0) {
    try {
      const parsed = JSON.parse(bodyRes.stdout);
      writeFileSync(prBodyPath, typeof parsed.body === "string" ? parsed.body : "");
      if (typeof parsed.headRefOid === "string" && parsed.headRefOid.length > 0) {
        headSha = parsed.headRefOid;
      }
    } catch {
      writeFileSync(prBodyPath, "");
    }
  } else {
    writeFileSync(prBodyPath, "");
  }

  // EXPERIMENT.yaml — `gh api <url>` returns base64-encoded contents in
  // a JSON envelope when the URL is a `repos/.../contents/...` path; the
  // workflow can also pass a raw-content URL, in which case the response
  // is the YAML directly. Handle both.
  const expRes = runGh(inputs.ghBin, ["api", inputs.experimentYamlUrl]);
  let experimentYamlReadable = false;
  if (expRes.exitCode === 0 && expRes.stdout.length > 0) {
    const decoded = decodeContentsResponse(expRes.stdout);
    if (decoded !== null) {
      writeFileSync(experimentYamlPath, decoded);
      experimentYamlReadable = true;
    } else {
      writeFileSync(experimentYamlPath, "");
    }
  } else {
    writeFileSync(experimentYamlPath, "");
  }

  // Diff — `gh pr diff <num> --repo <repo>`.
  const diffRes = runGh(inputs.ghBin, [
    "pr",
    "diff",
    String(inputs.prNumber),
    "--repo",
    inputs.hostRepo,
  ]);
  writeFileSync(diffPath, diffRes.exitCode === 0 ? diffRes.stdout : "");

  return { prBodyPath, experimentYamlPath, diffPath, headSha, experimentYamlReadable };
}

/**
 * Decode a `gh api repos/.../contents/...` response. The contents-API
 * returns `{ content: "<base64>", encoding: "base64" }`; a raw-content URL
 * returns the YAML directly. If the body looks like JSON with a
 * `content` field, decode it; otherwise treat the body as already-raw.
 *
 * @param {string} body
 * @returns {string | null}
 */
export function decodeContentsResponse(body) {
  const trimmed = body.trimStart();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed.content === "string" && parsed.encoding === "base64") {
        return Buffer.from(parsed.content, "base64").toString("utf8");
      }
      // JSON envelope with no `content` field — treat as unreadable.
      return null;
    } catch {
      // Not JSON — fall through to "raw body" path.
    }
  }
  // Looks like raw YAML (or anything else). Trust the caller; the
  // downstream lints will reject it if it's not parseable.
  return body;
}

// ---- lint runner -----------------------------------------------------------

/**
 * @typedef {{ id: string, result: "pass" | "fail" | "skip" | "neutral", reason: string }} CheckRow
 */

/**
 * Run a single `scripts/check-*.mjs` lint as a subprocess. Returns a row
 * suitable for the verdict. The lint scripts already encode their own
 * exit-code semantics (0 pass, 1 fail). We don't reimplement them.
 *
 * @param {string} id
 * @param {string} scriptPath
 * @param {string[]} scriptArgs
 * @returns {CheckRow}
 */
export function runLint(id, scriptPath, scriptArgs) {
  const res = spawnSync(process.execPath, [scriptPath, ...scriptArgs], {
    encoding: "utf8",
    cwd: REPO_ROOT,
  });
  const out = (res.stdout ?? "") + (res.stderr ?? "");
  const reason = (out.split("\n").find((l) => l.trim().length > 0) ?? "").slice(0, 240);
  if ((res.status ?? 1) === 0) {
    return { id, result: "pass", reason: reason || "ok" };
  }
  return { id, result: "fail", reason: reason || "violation" };
}

/**
 * Run the 4 cross-repo-portable lints over the fetched substrates.
 * The 8 sidecar-portable lints require a host clone with `.minsky/`, which
 * v0 does not stand up — they're recorded as `skip` with a "v0" reason.
 *
 * @param {Fetched} fetched
 * @returns {CheckRow[]}
 */
export function runPortableLints(fetched) {
  /** @type {CheckRow[]} */
  const rows = [];

  if (!fetched.experimentYamlReadable) {
    rows.push({
      id: "anchor-primary-source",
      result: "skip",
      reason: "EXPERIMENT.yaml not fetched (host PR may be private to a non-minsky-bot user)",
    });
    rows.push({
      id: "measurement-inspects-output",
      result: "skip",
      reason: "EXPERIMENT.yaml not fetched",
    });
    rows.push({
      id: "pivot-success-margin",
      result: "skip",
      reason: "EXPERIMENT.yaml not fetched",
    });
  } else {
    rows.push(
      runLint(
        "anchor-primary-source",
        join(REPO_ROOT, "scripts", "check-anchor-primary-source.mjs"),
        [fetched.experimentYamlPath],
      ),
    );
    rows.push(
      runLint(
        "measurement-inspects-output",
        join(REPO_ROOT, "scripts", "check-measurement-inspects-output.mjs"),
        [fetched.experimentYamlPath],
      ),
    );
    rows.push(
      runLint(
        "pivot-success-margin",
        join(REPO_ROOT, "scripts", "check-pivot-success-margin.mjs"),
        [fetched.experimentYamlPath],
      ),
    );
  }

  rows.push(
    runLint("pr-self-grade", join(REPO_ROOT, "scripts", "check-pr-self-grade.mjs"), [
      fetched.prBodyPath,
    ]),
  );

  // Sidecar-portable lints: declared, deferred until v1 (host-clone wiring
  // lands as a follow-up task — see TASKS.md `cross-repo-ci-action` Brief).
  for (const id of [
    "pattern-index",
    "rule-2-dep-coverage",
    "rule-3-doc-first",
    "rule-4-otel-coverage",
    "rule-5-glossary-discipline",
    "rule-6-let-it-crash",
    "rule-7-chaos-coverage",
    "skill-rule-cap",
  ]) {
    rows.push({
      id,
      result: "skip",
      reason: "sidecar-portable; v0 does not stand up the host clone (follow-up task)",
    });
  }

  return rows;
}

// ---- verdict synthesis -----------------------------------------------------

/**
 * @typedef {{
 *   conclusion: "success" | "failure" | "neutral",
 *   summary: string,
 *   details: string,
 *   head_sha: string | null,
 *   checks: CheckRow[],
 * }} Verdict
 */

/**
 * Pure function: given fetched substrates + lint rows + a post-run head
 * SHA (re-checked after lints), synthesise the verdict per the failure-mode
 * table in TASKS.md.
 *
 *   - head SHA mismatch (force-push during run) → `neutral` with the note
 *     "head SHA mismatch — re-emit dispatch".
 *   - any lint `fail` → `failure`.
 *   - all lints `pass` (skips don't count against) → `success`.
 *   - all lints `skip` (no readable substrate) → `neutral`.
 *
 * @param {{
 *   fetched: Fetched,
 *   rows: CheckRow[],
 *   postRunHeadSha: string | null,
 * }} args
 * @returns {Verdict}
 */
export function synthesiseVerdict(args) {
  const { fetched, rows, postRunHeadSha } = args;
  const headSha = fetched.headSha;

  // Force-push during run → neutral.
  if (headSha !== null && postRunHeadSha !== null && postRunHeadSha !== headSha) {
    return {
      conclusion: "neutral",
      summary: "head SHA mismatch — PR force-pushed mid-run; re-emit dispatch.",
      details: [
        `Pre-run head SHA:  ${headSha}`,
        `Post-run head SHA: ${postRunHeadSha}`,
        "",
        "The check ran against a stale SHA; never `success` on a stale SHA per the failure-mode table.",
      ].join("\n"),
      head_sha: headSha,
      checks: rows,
    };
  }

  const failed = rows.filter((r) => r.result === "fail");
  const passed = rows.filter((r) => r.result === "pass");
  const skipped = rows.filter((r) => r.result === "skip");

  if (failed.length > 0) {
    return {
      conclusion: "failure",
      summary: `${failed.length} constitutional lint(s) failed: ${failed
        .map((r) => r.id)
        .join(", ")}`,
      details: renderDetails(rows),
      head_sha: headSha,
      checks: rows,
    };
  }

  if (passed.length === 0 && skipped.length > 0) {
    return {
      conclusion: "neutral",
      summary: "no lints could be evaluated (all skipped — likely missing substrate)",
      details: renderDetails(rows),
      head_sha: headSha,
      checks: rows,
    };
  }

  return {
    conclusion: "success",
    summary: `${passed.length} constitutional lint(s) passed (${skipped.length} skipped per scope).`,
    details: renderDetails(rows),
    head_sha: headSha,
    checks: rows,
  };
}

/**
 * @param {CheckRow[]} rows
 * @returns {string}
 */
function renderDetails(rows) {
  const lines = ["| Lint | Result | Reason |", "|---|---|---|"];
  for (const r of rows) {
    const reason = r.reason.replace(/\|/g, "\\|");
    lines.push(`| \`${r.id}\` | ${r.result} | ${reason} |`);
  }
  return lines.join("\n");
}

// ---- self-test -------------------------------------------------------------

/**
 * Spawn this script with a stubbed gh that emits a canned valid PR body
 * + valid EXPERIMENT.yaml; assert the verdict is `success`. The test
 * suite covers every branch in detail; this is a smoke test the
 * experiment's measurement command runs to prove the runner end-to-ends
 * locally without GitHub auth.
 *
 * @returns {Promise<number>}
 */
export async function runSelfTest() {
  const stubPath = join(REPO_ROOT, "scripts", "fixtures", "cross-repo-check-runner-gh-stub.mjs");
  const workDir = mkdtempSync(join(tmpdir(), "cross-repo-check-self-test-"));
  const res = spawnSync(
    process.execPath,
    [
      join(REPO_ROOT, "scripts", "cross-repo-check-runner.mjs"),
      "--host-repo",
      "owner/host",
      "--pr-number",
      "1",
      "--experiment-yaml-url",
      "https://api.github.com/repos/owner/host/contents/.minsky/experiments/foo.yaml?ref=abc",
      "--gh-bin",
      stubPath,
      "--work-dir",
      workDir,
      "--json-only",
    ],
    { encoding: "utf8", env: { ...process.env, MINSKY_GH_STUB_MODE: "happy" } },
  );
  if ((res.status ?? 1) !== 0) {
    process.stderr.write(`self-test: runner exited non-zero (${res.status})\n${res.stderr}\n`);
    return 1;
  }
  /** @type {Verdict | null} */
  let verdict = null;
  try {
    verdict = JSON.parse((res.stdout ?? "").trim());
  } catch (err) {
    process.stderr.write(`self-test: stdout was not valid JSON: ${res.stdout}\n${err}\n`);
    return 1;
  }
  if (verdict === null || verdict.conclusion !== "success") {
    process.stderr.write(
      `self-test: expected conclusion=success, got ${verdict === null ? "null" : verdict.conclusion}\n` +
        `summary: ${verdict?.summary}\n` +
        `details:\n${verdict?.details}\n`,
    );
    return 1;
  }
  process.stdout.write(`self-test: OK (${verdict.summary})\n`);
  return 0;
}

// ---- main ------------------------------------------------------------------

/**
 * @param {CliInputs} inputs
 * @returns {Verdict}
 */
export function runCheck(inputs) {
  const fetched = fetchSubstrates(inputs);
  const rows = runPortableLints(fetched);
  // Re-check head SHA after lints (force-push detection).
  const postRunHeadSha = (() => {
    const res = runGh(inputs.ghBin, [
      "pr",
      "view",
      "--repo",
      inputs.hostRepo,
      String(inputs.prNumber),
      "--json",
      "headRefOid",
      "--jq",
      ".headRefOid",
    ]);
    if (res.exitCode === 0) {
      const v = res.stdout.trim();
      return v.length > 0 ? v : null;
    }
    return null;
  })();
  return synthesiseVerdict({ fetched, rows, postRunHeadSha });
}

async function main() {
  /** @type {CliInputs} */
  let inputs;
  try {
    inputs = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    const e = /** @type {Error} */ (err);
    process.stderr.write(`cross-repo-check-runner: ${e.message}\n`);
    return 2;
  }
  if (inputs.selfTest) {
    return runSelfTest();
  }
  const verdict = runCheck(inputs);
  process.stdout.write(`${JSON.stringify(verdict)}\n`);
  return 0;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("cross-repo-check-runner.mjs");
if (invokedDirectly) {
  const code = await main();
  process.exit(code);
}

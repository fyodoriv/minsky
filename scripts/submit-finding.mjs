#!/usr/bin/env node
// @ts-check
// submit-finding — remote-task-submission CLI (TASKS.md
// `minsky-remote-task-submission`). Takes a self-observed finding, anonymizes
// it via `@minsky/tick-loop` (the pure core — no code, no secrets, no file
// paths egress), shows the operator the EXACT payload, asks for explicit
// `[Y/n]` approval, then opens a GitHub issue on `fyodoriv/minsky`. Never
// sends without approval; aborts fail-closed if a leak survives redaction.
//
// Pattern: ports-and-adapters (Cockburn 2005) — the pure anonymizer is the
//   hexagon's core; this file is the driving (CLI) + driven (gh, stdin)
//   adapter. The argument parser, payload builder, and gh-args builder are
//   pure functions exported for the paired test; only `main` touches I/O.
// Source: TASKS.md `minsky-remote-task-submission`; vision.md rule #13.7
//   (privacy by default); Mozilla Crash Reporter / VSCode telemetry (opt-in).

import { spawnSync } from "node:child_process";
import process from "node:process";
import { createInterface } from "node:readline";

import { anonymizeFinding, containsPii, renderIssueBody, renderPreview } from "@minsky/tick-loop";

/** The canonical upstream the findings are submitted to. */
export const FINDING_REPO = "fyodoriv/minsky";

/** Valid `--type` values (mirrors `@minsky/tick-loop`'s FindingType). */
export const FINDING_TYPES = Object.freeze([
  "bug",
  "limitation",
  "improvement",
  "crash",
  "flaky-test",
]);

/**
 * @typedef {object} ParsedArgs
 * @property {"preview" | "submit"} mode
 * @property {string} type
 * @property {string} title
 * @property {string[]} reproSteps
 * @property {boolean} help
 * @property {string | null} error
 */

/**
 * Split `--flag=value` into `["--flag", "value"]`; bare flags return
 * `[flag, undefined]`. Pure helper so `parseArgs` stays under the
 * cognitive-complexity ceiling.
 *
 * @param {string} arg
 * @returns {[string, string | undefined]}
 */
function splitFlag(arg) {
  const eq = arg.indexOf("=");
  if (eq === -1) return [arg, undefined];
  return [arg.slice(0, eq), arg.slice(eq + 1)];
}

/**
 * Apply one flag to the accumulator. Returns the next index to read (so a
 * value-bearing flag can consume `argv[i + 1]` when no `=value` was inline).
 * Extracted from `parseArgs` to keep each function's branch count small.
 *
 * @param {ParsedArgs} out
 * @param {string[]} argv
 * @param {number} i
 * @returns {number}
 */
function applyFlag(out, argv, i) {
  const arg = argv[i] ?? "";
  const [flag, inlineValue] = splitFlag(arg);
  let cursor = i;
  const take = () => inlineValue ?? argv[++cursor] ?? "";
  switch (flag) {
    case "--help":
    case "-h":
      out.help = true;
      break;
    case "--preview":
      out.mode = "preview";
      break;
    case "--submit":
      out.mode = "submit";
      break;
    case "--type":
      out.type = take();
      break;
    case "--title":
      out.title = take();
      break;
    case "--repro":
      out.reproSteps.push(take());
      break;
    default:
      out.error = `unknown argument: ${arg}`;
  }
  return cursor;
}

/**
 * Validate the accumulated args (title required, type in vocabulary). Sets the
 * first error encountered; help short-circuits validation.
 *
 * @param {ParsedArgs} out
 * @returns {void}
 */
function validateArgs(out) {
  if (out.help) return;
  if (out.title.length === 0) out.error = out.error ?? "--title <text> is required";
  if (!FINDING_TYPES.includes(out.type)) {
    out.error = out.error ?? `--type must be one of ${FINDING_TYPES.join("|")} (got '${out.type}')`;
  }
}

/**
 * Pure argument parser. `--preview` (default) renders the anonymized payload
 * and exits without egress; `--submit` adds the `[Y/n]` approval + gh issue
 * create. Exported for the paired test.
 *
 * @param {string[]} argv  process.argv.slice(2)
 * @returns {ParsedArgs}
 */
export function parseArgs(argv) {
  /** @type {ParsedArgs} */
  const out = {
    mode: "preview",
    type: "bug",
    title: "",
    reproSteps: [],
    help: false,
    error: null,
  };
  for (let i = 0; i < argv.length; i++) {
    i = applyFlag(out, argv, i);
  }
  validateArgs(out);
  return out;
}

/**
 * Pure builder: turn parsed args + environment facts into the `RawFinding`
 * shape `@minsky/tick-loop` anonymizes. The environment facts (version, os,
 * agent) are injected so the builder stays pure and the test can pin them.
 *
 * @param {ParsedArgs} args
 * @param {{ minskyVersion: string, os: string, agent: string }} env
 * @returns {import("@minsky/tick-loop").RawFinding}
 */
export function buildRawFinding(args, env) {
  return {
    type: /** @type {import("@minsky/tick-loop").FindingType} */ (args.type),
    title: args.title,
    reproSteps: args.reproSteps,
    minskyVersion: env.minskyVersion,
    os: env.os,
    agent: env.agent,
  };
}

/**
 * Pure builder: the `gh issue create` argv for an anonymized finding. Kept
 * pure so the test can assert the exact command without spawning gh.
 *
 * @param {import("@minsky/tick-loop").AnonymizedFinding} finding
 * @returns {string[]}
 */
export function buildGhIssueArgs(finding) {
  return [
    "issue",
    "create",
    "--repo",
    FINDING_REPO,
    "--title",
    `[finding:${finding.type}] ${finding.title}`,
    "--body",
    renderIssueBody(finding),
    "--label",
    "submitted-finding",
  ];
}

const HELP_TEXT = `Usage: minsky submit-finding --title "<text>" [--type bug|limitation|improvement|crash|flaky-test] [--repro "<step>" ...] [--preview|--submit]

Submit a self-observed finding to ${FINDING_REPO} — anonymized (no code, no
secrets, no file paths) and only after you approve the rendered preview.

  --preview   (default) print the exact anonymized payload and exit. No egress.
  --submit    print the payload, ask [Y/n], then open a GitHub issue on approval.
  --type      finding category (default: bug).
  --title     one-line summary (required). Redacted before egress.
  --repro     a reproduction step (repeatable). Redacted before egress.

Nothing is ever sent without explicit approval.`;

/**
 * Prompt the operator for `[Y/n]` approval. Resolves true only on an explicit
 * yes; everything else (including empty / EOF) is treated as "no" — egress is
 * opt-in, so the safe default is decline.
 *
 * @param {NodeJS.ReadableStream} input
 * @param {NodeJS.WritableStream} output
 * @returns {Promise<boolean>}
 */
export function promptApproval(input, output) {
  const rl = createInterface({ input, output });
  return new Promise((resolve) => {
    rl.question(`Submit this finding to ${FINDING_REPO}? [y/N] `, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

/**
 * Resolve the environment facts a finding carries. Reads only non-PII
 * structured signals (platform token, npm package version, agent env var).
 *
 * @returns {{ minskyVersion: string, os: string, agent: string }}
 */
function resolveEnv() {
  return {
    minskyVersion: process.env["npm_package_version"] ?? "unknown",
    os: process.platform,
    agent: process.env["MINSKY_AGENT"] ?? "unknown",
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${HELP_TEXT}\n`);
    process.exit(0);
  }
  if (args.error !== null) {
    process.stderr.write(`minsky submit-finding: ${args.error}\n`);
    process.stderr.write(`  hint: minsky submit-finding --help\n`);
    process.exit(2);
  }

  const raw = buildRawFinding(args, resolveEnv());
  const finding = anonymizeFinding(raw);

  // Defense-in-depth: never egress a payload that still carries a leak.
  if (containsPii(finding)) {
    process.stderr.write(
      "minsky submit-finding: redaction failed to clear a secret/PII span — aborting (no egress).\n",
    );
    process.exit(1);
  }

  process.stdout.write(`${renderPreview(finding)}\n`);

  if (args.mode === "preview") {
    process.stdout.write("\n(preview only — re-run with --submit to open an issue)\n");
    process.exit(0);
  }

  const approved = await promptApproval(process.stdin, process.stdout);
  if (!approved) {
    process.stdout.write("Aborted — nothing was sent.\n");
    process.exit(0);
  }

  const ghArgs = buildGhIssueArgs(finding);
  const result = spawnSync("gh", ghArgs, { stdio: "inherit" });
  // Let it crash (rule #6): surface gh's exit code verbatim; the supervisor
  // (the operator's shell) sees the failure rather than a swallowed one.
  process.exit(result.status ?? 1);
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("submit-finding.mjs") || process.argv[1].endsWith("submit-finding"));
if (invokedDirectly) {
  await main();
}

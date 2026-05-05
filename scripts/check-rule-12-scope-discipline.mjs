#!/usr/bin/env node
// @ts-check
// Rule #12 (vision.md § "Scope discipline" — iron rule) deterministic CI
// lint. Every newly-added (status A) public artefact must resolve to
// either:
//   (a) a TASKS.md task block whose body mentions the path (a human-
//       approved task);
//   (b) an `experiments/<id>.yaml` whose body mentions the path (rule-#9
//       pre-registration);
//   (c) a `<!-- scope: human-approved <reason> -->` comment in the new
//       file's first ~20 lines (per-file in-PR opt-out); OR
//   (d) a `<!-- scope: human-approved <reason> -->` comment in the PR
//       body (whole-PR opt-out).
//
// "Public artefact" = newly-added (status A) file under any of:
//   novel/**                         — package code / SKILL / README
//   scripts/*.{mjs,sh,ts,js}         — top-level tooling
//   .github/workflows/*.yml          — new CI gates
//   distribution/**                  — supervisor / packaging artefacts
//
// Excluded (not eligible — never a violation):
//   *.test.{ts,mjs,js}, *.fixture.{ts,mjs,js}  — tests + fixtures
//   node_modules/**                            — vendored
//   Status M / D / R                           — modifications +
//                                                renames are
//                                                grandfathered (rule-1 /
//                                                rule-3 / rule-4
//                                                precedent)
//
// DIFF-BASED. Compares HEAD against `origin/main` (override with
// `--diff-base=<ref>` or env `RULE_12_DIFF_BASE`). For deterministic
// fixture testing, accepts `--diff=<path>` where `<path>` is a file
// containing `<status>\t<path>` lines (the output of `git diff
// --name-status`).
//
// Pattern: deterministic gate over a PR diff (rule #10).
// Source: rule #12 (vision.md § "Scope discipline"); rule #10
//   (deterministic enforcement); Ries, *The Lean Startup*, 2011
//   (validated learning); Beck, *Extreme Programming Explained*, 1999
//   (CI as the constraint enforcer); Munafò et al., *Nature Human
//   Behaviour* 2017 (pre-registration).
// Conformance: full — pure function over the diff, no LLM in the chain.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

const HEAD_LINES_FOR_OPT_OUT = 20;
const OPT_OUT_RE = /<!--\s*scope:\s*human-approved\s+([^\n]+?)\s*-->/i;

/**
 * @typedef {object} ChangedFile
 * @property {string} status   git diff-status letter ("A", "M", "D", "R…")
 * @property {string} path     POSIX, repo-relative
 */

/**
 * @typedef {object} ScopeClassification
 * @property {string} path
 * @property {"justified-by-task" | "justified-by-experiment" | "human-approved" | "unjustified"} verdict
 * @property {string} [reason]    set when `human-approved` (the comment's reason text)
 * @property {string} [evidence]  set when justified — the matching id / source
 */

/**
 * @typedef {object} CheckInput
 * @property {readonly ChangedFile[]} changedFiles
 * @property {string} tasksMd
 * @property {ReadonlyMap<string, string>} experimentsByPath  filename → contents
 * @property {string} prBody
 * @property {ReadonlyMap<string, string>} optOuts  newly-added path → reason text
 */

/**
 * @typedef {object} CheckResult
 * @property {readonly ScopeClassification[]} classifications
 */

/**
 * Pure function. See module header for semantics.
 *
 * @param {CheckInput} input
 * @returns {CheckResult}
 */
export function checkRule12ScopeDiscipline({
  changedFiles,
  tasksMd,
  experimentsByPath,
  prBody,
  optOuts,
}) {
  const wholePrOptOut = OPT_OUT_RE.exec(prBody);
  /** @type {ScopeClassification[]} */
  const classifications = [];
  for (const f of changedFiles) {
    if (!isEligibleAddition(f)) continue;
    const c = classify(f.path, { tasksMd, experimentsByPath, optOuts, wholePrOptOut });
    classifications.push(c);
  }
  return { classifications };
}

/**
 * @param {ChangedFile} f
 * @returns {boolean}
 */
function isEligibleAddition(f) {
  // Only newly-added files. Renames (status R…) and modifications (M)
  // are grandfathered — same precedent as rule-1, rule-3, rule-4,
  // pattern-index.
  if (!f.status.startsWith("A")) return false;
  if (f.path.length === 0) return false;
  if (f.path.includes("node_modules/")) return false;
  if (isTestOrFixture(f.path)) return false;
  return isUnderEligibleRoot(f.path);
}

/**
 * @param {string} p
 * @returns {boolean}
 */
function isTestOrFixture(p) {
  if (/\.test\.(ts|mjs|js)$/.test(p)) return true;
  if (/\.fixture\.(ts|mjs|js)$/.test(p)) return true;
  return false;
}

/**
 * @param {string} p
 * @returns {boolean}
 */
function isUnderEligibleRoot(p) {
  if (p.startsWith("novel/")) return true;
  if (p.startsWith("distribution/")) return true;
  if (p.startsWith(".github/workflows/") && p.endsWith(".yml")) return true;
  if (/^scripts\/[^/]+\.(mjs|sh|ts|js)$/.test(p)) return true;
  return false;
}

/**
 * @param {string} path
 * @param {object} ctx
 * @param {string} ctx.tasksMd
 * @param {ReadonlyMap<string, string>} ctx.experimentsByPath
 * @param {ReadonlyMap<string, string>} ctx.optOuts
 * @param {RegExpExecArray | null} ctx.wholePrOptOut
 * @returns {ScopeClassification}
 */
function classify(path, ctx) {
  const taskId = findTaskBlockMentioning(path, ctx.tasksMd);
  if (taskId !== null) {
    return { path, verdict: "justified-by-task", evidence: taskId };
  }
  const expId = findExperimentMentioning(path, ctx.experimentsByPath);
  if (expId !== null) {
    return { path, verdict: "justified-by-experiment", evidence: expId };
  }
  const fileOptOut = ctx.optOuts.get(path);
  if (fileOptOut !== undefined) {
    return { path, verdict: "human-approved", reason: fileOptOut, evidence: "in-file-comment" };
  }
  if (ctx.wholePrOptOut !== null && ctx.wholePrOptOut[1] !== undefined) {
    return {
      path,
      verdict: "human-approved",
      reason: ctx.wholePrOptOut[1],
      evidence: "pr-body-comment",
    };
  }
  return { path, verdict: "unjustified" };
}

/**
 * Walk TASKS.md as a sequence of `**ID**: <id>` blocks; return the id of
 * the first block that mentions `path` verbatim within its body. Returns
 * null if no block matches.
 *
 * @param {string} path
 * @param {string} tasksMd
 * @returns {string | null}
 */
function findTaskBlockMentioning(path, tasksMd) {
  const blocks = parseTaskBlocks(tasksMd);
  for (const b of blocks) {
    if (b.body.includes(path)) return b.id;
  }
  return null;
}

/**
 * @param {string} tasksMd
 * @returns {{ id: string, body: string }[]}
 */
function parseTaskBlocks(tasksMd) {
  const idRe = /^\s*-\s*\*\*ID\*\*:\s*([a-z0-9][a-z0-9-]*[a-z0-9])\s*$/gm;
  /** @type {{ id: string, start: number }[]} */
  const heads = [];
  for (;;) {
    const m = idRe.exec(tasksMd);
    if (m === null) break;
    if (m[1] === undefined) continue;
    heads.push({ id: m[1], start: m.index });
  }
  /** @type {{ id: string, body: string }[]} */
  const out = [];
  for (let i = 0; i < heads.length; i++) {
    const head = heads[i];
    if (head === undefined) continue;
    const next = heads[i + 1];
    const end = next === undefined ? tasksMd.length : next.start;
    out.push({ id: head.id, body: tasksMd.slice(head.start, end) });
  }
  return out;
}

/**
 * @param {string} path
 * @param {ReadonlyMap<string, string>} experimentsByPath
 * @returns {string | null}
 */
function findExperimentMentioning(path, experimentsByPath) {
  for (const [filename, content] of experimentsByPath) {
    if (content.includes(path)) return filename;
  }
  return null;
}

// --------------------------------------------------------------- CLI -------

/**
 * @param {string[]} argv
 * @returns {{ diffBase: string, diffFile: string | null, repo: string }}
 */
function parseArgs(argv) {
  /** @type {{ diffBase: string, diffFile: string | null, repo: string }} */
  const out = {
    diffBase: process.env["RULE_12_DIFF_BASE"] ?? "origin/main",
    diffFile: null,
    repo: REPO_ROOT,
  };
  for (const arg of argv) {
    const kv = parseKeyValue(arg);
    if (kv === null) continue;
    applyArg(out, kv.key, kv.value);
  }
  return out;
}

/**
 * @param {string} arg
 * @returns {{ key: string, value: string } | null}
 */
function parseKeyValue(arg) {
  const m = /^--([^=]+)=(.*)$/.exec(arg);
  if (m === null) return null;
  const key = m[1];
  const value = m[2];
  if (key === undefined || value === undefined) return null;
  return { key, value };
}

/**
 * @param {{ diffBase: string, diffFile: string | null, repo: string }} out
 * @param {string} key
 * @param {string} value
 * @returns {void}
 */
function applyArg(out, key, value) {
  if (key === "diff-base") out.diffBase = value;
  else if (key === "diff") out.diffFile = value;
  else if (key === "repo") out.repo = value;
}

/**
 * @param {string} diffBase
 * @param {string} repo
 * @returns {ChangedFile[]}
 */
function getChangedFilesFromGit(diffBase, repo) {
  const out = execFileSync("git", ["diff", "--name-status", `${diffBase}...HEAD`], {
    cwd: repo,
    encoding: "utf8",
  });
  return parseNameStatus(out);
}

/**
 * @param {string} text
 * @returns {ChangedFile[]}
 */
function parseNameStatus(text) {
  /** @type {ChangedFile[]} */
  const out = [];
  for (const line of text.split("\n")) {
    if (line.length === 0) continue;
    const tab = line.indexOf("\t");
    if (tab === -1) {
      out.push({ status: line, path: "" });
      continue;
    }
    // Renames are emitted as `R<score>\t<old>\t<new>`. We only care about
    // the new path, and we never treat R as eligible anyway.
    const status = line.slice(0, tab);
    const rest = line.slice(tab + 1);
    const tab2 = rest.indexOf("\t");
    const path = tab2 === -1 ? rest : rest.slice(tab2 + 1);
    out.push({ status, path });
  }
  return out;
}

/**
 * @param {string} repo
 * @returns {Map<string, string>}
 */
function loadExperiments(repo) {
  const dir = resolve(repo, "experiments");
  /** @type {Map<string, string>} */
  const map = new Map();
  if (!existsSync(dir)) return map;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".yaml") && !name.endsWith(".yml")) continue;
    map.set(`experiments/${name}`, readFileSync(resolve(dir, name), "utf8"));
  }
  return map;
}

/**
 * Read first ~20 lines of each newly-added file, extract any
 * `<!-- scope: human-approved <reason> -->` opt-out reason.
 *
 * @param {readonly ChangedFile[]} changedFiles
 * @param {string} repo
 * @returns {Map<string, string>}
 */
function loadOptOuts(changedFiles, repo) {
  /** @type {Map<string, string>} */
  const map = new Map();
  for (const f of changedFiles) {
    if (!f.status.startsWith("A")) continue;
    const abs = resolve(repo, f.path);
    if (!existsSync(abs)) continue;
    let head;
    try {
      head = readFileSync(abs, "utf8").split("\n").slice(0, HEAD_LINES_FOR_OPT_OUT).join("\n");
    } catch {
      continue;
    }
    const m = OPT_OUT_RE.exec(head);
    if (m !== null && m[1] !== undefined) map.set(f.path, m[1].trim());
  }
  return map;
}

/**
 * @param {string | undefined} prBodyPath
 * @returns {string}
 */
function loadPrBody(prBodyPath) {
  if (prBodyPath === undefined || prBodyPath.length === 0) return "";
  if (!existsSync(prBodyPath)) return "";
  return readFileSync(prBodyPath, "utf8");
}

/**
 * @param {readonly ScopeClassification[]} classifications
 * @returns {void}
 */
function reportSuccess(classifications) {
  process.stdout.write("rule-12 ok: scope discipline satisfied.\n");
  for (const c of classifications) {
    if (c.verdict === "human-approved") {
      process.stdout.write(`  human-approved: ${c.path} (${c.evidence}: ${c.reason ?? ""})\n`);
    } else if (c.verdict === "justified-by-task") {
      process.stdout.write(`  justified-by-task: ${c.path} → ${c.evidence}\n`);
    } else if (c.verdict === "justified-by-experiment") {
      process.stdout.write(`  justified-by-experiment: ${c.path} → ${c.evidence}\n`);
    }
  }
}

/**
 * @param {readonly ScopeClassification[]} unjustified
 * @returns {void}
 */
function reportFailure(unjustified) {
  process.stderr.write(
    `rule-12 violation: ${unjustified.length} new public artefact(s) lack a TASKS.md task block, an experiments/<id>.yaml pre-registration, or a \`<!-- scope: human-approved <reason> -->\` opt-out:\n`,
  );
  for (const c of unjustified) {
    process.stderr.write(`  - ${c.path}\n`);
  }
  process.stderr.write(
    "\nFix one of:\n" +
      "  (a) add a `**ID**: <task-id>` block to TASKS.md whose body mentions the path;\n" +
      "  (b) add an `experiments/<id>.yaml` whose hypothesis/measurement mentions the path;\n" +
      "  (c) add `<!-- scope: human-approved <reason> -->` to the new file's first 20 lines;\n" +
      "  (d) add `<!-- scope: human-approved <reason> -->` to the PR description.\n",
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  /** @type {ChangedFile[]} */
  let changedFiles;
  if (args.diffFile !== null) {
    changedFiles = parseNameStatus(readFileSync(args.diffFile, "utf8"));
  } else {
    try {
      changedFiles = getChangedFilesFromGit(args.diffBase, args.repo);
    } catch (e) {
      process.stderr.write(
        `rule-12 lint cannot compute diff: ${e instanceof Error ? e.message : String(e)}\n`,
      );
      process.exit(2);
      return;
    }
  }
  const tasksMd = readFileSafe(resolve(args.repo, "TASKS.md"));
  const experimentsByPath = loadExperiments(args.repo);
  const optOuts = loadOptOuts(changedFiles, args.repo);
  const prBody = loadPrBody(process.env["RULE_12_PR_BODY_PATH"]);

  const { classifications } = checkRule12ScopeDiscipline({
    changedFiles,
    tasksMd,
    experimentsByPath,
    prBody,
    optOuts,
  });
  const unjustified = classifications.filter((c) => c.verdict === "unjustified");
  if (unjustified.length === 0) {
    reportSuccess(classifications);
    process.exit(0);
    return;
  }
  reportFailure(unjustified);
  process.exit(1);
}

/**
 * @param {string} p
 * @returns {string}
 */
function readFileSafe(p) {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

const isCli =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-rule-12-scope-discipline.mjs");
if (isCli) main();

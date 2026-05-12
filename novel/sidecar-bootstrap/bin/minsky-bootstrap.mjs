#!/usr/bin/env node
// `minsky bootstrap <host-dir>` — CLI executor that walks the bootstrap plan.
//
// Pattern: command-line I/O boundary (Martin 2017 — pure functions in
//   `dist/` / `src/`, the CLI is the only side-effecting layer); the plan
//   is built by the pure `planBootstrap` and applied here. Source: rule
//   #6 (vision.md § 6 — let-it-crash AT the boundary; the executor catches
//   per-action errors and reports them with operator-actionable messages,
//   it does NOT silently swallow them).
// Conformance: full — pure functions are imported; the CLI owns I/O only.
//
// Modes:
//   minsky-bootstrap <host-dir>            — write the sidecar (default).
//   minsky-bootstrap --doctor <host-dir>   — read-only diagnostic; no writes.
//   minsky-bootstrap --repair <host-dir>   — re-apply plan; fixes drift.
//
// Concurrency: a mkdir-based lock at <host>/.minsky/.bootstrap.lock.d
// (mirrors setup.sh's atomic-claim idiom) prevents concurrent invocations
// from corrupting state. A second invocation while the first is running
// exits 75 (EX_TEMPFAIL) per BSD sysexits.h.

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  NO_HOST_SIGNALS,
  classifyWriteError,
  decideIgnoreAppend,
  diagnose,
  inferRepoConfig,
  planBootstrap,
} from "../dist/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MINSKY_REPO_ROOT = resolve(HERE, "..", "..", "..");
const VISION_MD_PATH = resolve(MINSKY_REPO_ROOT, "vision.md");

function usage() {
  process.stderr.write(
    [
      "minsky-bootstrap — write a per-host gitignored .minsky/ sidecar.",
      "",
      "Usage:",
      "  minsky-bootstrap <host-dir>            Write the sidecar (default).",
      "  minsky-bootstrap --doctor <host-dir>   Read-only diagnostic.",
      "  minsky-bootstrap --repair <host-dir>   Re-apply plan; fix drift.",
      "  minsky-bootstrap --help                Print this message.",
      "",
    ].join("\n"),
  );
}

function readPackageJson(hostRoot) {
  const path = resolve(hostRoot, "package.json");
  try {
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readGitConfig(hostRoot, key) {
  // Minimal: read .git/config and grep the URL. We avoid spawning `git`
  // so the bootstrap doesn't need git on PATH. Tolerant — a missing
  // .git/config simply means we skip that signal.
  const path = resolve(hostRoot, ".git", "config");
  try {
    const raw = readFileSync(path, "utf8");
    const m = raw.match(new RegExp(`${key}\\s*=\\s*(.+)`, "m"));
    return m?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

function inferSignals(hostRoot) {
  const packageJson = readPackageJson(hostRoot);
  const gitRemoteUrl = readGitConfig(hostRoot, "url");
  const gitDefaultBranch = null; // we don't read HEAD; the operator can edit
  return {
    ...NO_HOST_SIGNALS,
    packageJson,
    gitRemoteUrl,
    gitDefaultBranch,
    hasRootTasksMd: existsSync(resolve(hostRoot, "TASKS.md")),
    hasClaudeMd: existsSync(resolve(hostRoot, "CLAUDE.md")),
    hasAgentsMd: existsSync(resolve(hostRoot, "AGENTS.md")),
  };
}

function resolveGlobalIgnorePath() {
  // git's documented default: $XDG_CONFIG_HOME/git/ignore, fallback
  // ~/.config/git/ignore.
  const xdg = process.env["XDG_CONFIG_HOME"];
  const base = typeof xdg === "string" && xdg.length > 0 ? xdg : resolve(homedir(), ".config");
  return resolve(base, "git", "ignore");
}

function readExistingState(hostRoot, globalGitIgnorePath) {
  const minskyDir = resolve(hostRoot, ".minsky");
  const repoYaml = resolve(minskyDir, "repo.yaml");
  const visionMd = resolve(minskyDir, "vision.md");
  const experimentsDir = resolve(minskyDir, "experiments");
  const experimentsGitkeep = resolve(experimentsDir, ".gitkeep");

  let visionMdSymlink = false;
  try {
    visionMdSymlink = lstatSync(visionMd).isSymbolicLink();
  } catch {
    visionMdSymlink = false;
  }

  let globalIgnoreEntry = false;
  try {
    const raw = readFileSync(globalGitIgnorePath, "utf8");
    globalIgnoreEntry = /^\.minsky\/?$/m.test(raw);
  } catch {
    globalIgnoreEntry = false;
  }

  return {
    minskyDir: existsSync(minskyDir),
    repoYaml: existsSync(repoYaml),
    visionMdSymlink,
    experimentsDir: existsSync(experimentsDir),
    experimentsGitkeep: existsSync(experimentsGitkeep),
    globalIgnoreEntry,
  };
}

function applyEnsureDirectory(action) {
  mkdirSync(action.path, { recursive: true });
  process.stdout.write(`✓ created directory ${action.path}\n`);
}

function applyWriteFile(action) {
  mkdirSync(dirname(action.path), { recursive: true });
  writeFileSync(action.path, action.content, "utf8");
  process.stdout.write(`✓ wrote ${action.path}\n`);
}

function applyCreateSymlink(action) {
  mkdirSync(dirname(action.linkPath), { recursive: true });
  if (existsSync(action.linkPath)) {
    const stat = lstatSync(action.linkPath);
    if (!stat.isSymbolicLink()) {
      process.stderr.write(
        `✗ ${action.linkPath} exists but is not a symlink; refusing to overwrite. Remove it manually and re-run.\n`,
      );
      process.exit(1);
    }
    rmSync(action.linkPath);
  }
  symlinkSync(action.target, action.linkPath);
  process.stdout.write(`✓ linked ${action.linkPath} -> ${action.target}\n`);
}

/**
 * Append the `.minsky/` sidecar marker to the operator's ignore substrate.
 * Walks `decideIgnoreAppend`'s fallback ladder (chaos row 5):
 *   1. Try the global git ignore (decision A2's primary surface).
 *   2. On EACCES / EPERM / EROFS, retry against `<host>/.git/info/exclude`
 *      (per-clone fallback documented in `docs/cross-repo-portability.md`).
 *   3. On non-EACCES failures, surface the error without retrying — the
 *      operator's `git`/fs setup needs manual attention.
 */
function applyAppendToIgnore(action, hostRoot) {
  const perCloneExcludeFile = resolve(hostRoot, ".git", "info", "exclude");
  const verdict = decideIgnoreAppend({
    globalIgnoreFile: action.ignoreFile,
    perCloneExcludeFile,
    entry: action.entry,
    writeFn: (path, payload) => attemptIgnoreAppend(path, payload),
  });
  if (verdict.kind === "wrote-global") {
    process.stdout.write(`✓ appended "${action.entry}" to ${verdict.path}\n`);
    return;
  }
  if (verdict.kind === "wrote-per-clone") {
    process.stdout.write(
      `⚠ global ignore unwritable; fell back to per-clone exclude: ${verdict.path}\n`,
    );
    process.stdout.write(
      "  (chaos row 5 — global git ignore was read-only. Operator: fix the global file when convenient.)\n",
    );
    return;
  }
  if (verdict.kind === "skipped-already") {
    process.stdout.write(`ℹ ${verdict.path} already contains "${action.entry}" — skipped\n`);
    return;
  }
  const tried = verdict.tried.map((t) => `${t.path} (${t.verdict})`).join(", ");
  process.stderr.write(`failed to append "${action.entry}" to any ignore substrate: ${tried}\n`);
  process.exit(1);
}

/**
 * Adapter: do the actual `writeFileSync` and translate the result into the
 * `WriteVerdict` shape `decideIgnoreAppend` walks. Production wiring; tests
 * inject a synthetic writer directly into `decideIgnoreAppend`.
 */
function attemptIgnoreAppend(path, payload) {
  try {
    mkdirSync(dirname(path), { recursive: true });
  } catch (err) {
    return classifyWriteError(err);
  }
  let prefix = "";
  try {
    const existing = readFileSync(path, "utf8");
    if (existing.length > 0 && !existing.endsWith("\n")) prefix = "\n";
  } catch {
    // file doesn't exist; the write will create it.
  }
  try {
    writeFileSync(path, `${prefix}${payload}`, { flag: "a" });
    return "ok";
  } catch (err) {
    return classifyWriteError(err);
  }
}

function applyAction(action, hostRoot) {
  switch (action.kind) {
    case "ensure-directory":
      return applyEnsureDirectory(action);
    case "write-file":
      return applyWriteFile(action);
    case "create-symlink":
      return applyCreateSymlink(action);
    case "append-to-ignore":
      return applyAppendToIgnore(action, hostRoot);
    case "log-info":
      process.stdout.write(`ℹ ${action.message}\n`);
      return;
  }
}

function acquireLock(hostRoot) {
  const lockDir = resolve(hostRoot, ".minsky", ".bootstrap.lock.d");
  try {
    mkdirSync(resolve(hostRoot, ".minsky"), { recursive: true });
    mkdirSync(lockDir);
    return lockDir;
  } catch (err) {
    if (err && /** @type {NodeJS.ErrnoException} */ (err).code === "EEXIST") {
      process.stderr.write(
        `another minsky-bootstrap run holds the lock at ${lockDir}; if no other run is active, remove the directory and re-try.\n`,
      );
      process.exit(75); // EX_TEMPFAIL
    }
    throw err;
  }
}

function releaseLock(lockDir) {
  try {
    rmSync(lockDir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup.
  }
}

async function runBootstrap(hostRoot) {
  const signals = inferSignals(hostRoot);
  const config = inferRepoConfig(signals);
  const globalGitIgnorePath = resolveGlobalIgnorePath();
  const existing = readExistingState(hostRoot, globalGitIgnorePath);
  const plan = planBootstrap({
    hostRoot,
    config,
    visionMdPath: VISION_MD_PATH,
    globalGitIgnorePath,
    existing,
  });

  const lockDir = acquireLock(hostRoot);
  try {
    for (const action of plan.actions) {
      applyAction(action, hostRoot);
    }
  } finally {
    releaseLock(lockDir);
  }

  process.stdout.write(`\n✓ minsky bootstrap complete: ${hostRoot}/.minsky/\n`);
  process.stdout.write("  edit .minsky/repo.yaml to refine inferred values.\n");
  return 0;
}

function probeRepoYamlValid(repoYaml) {
  try {
    const raw = readFileSync(repoYaml, "utf8");
    const required = ["host_repo:", "tasks_md_path:", "commit_format:", "default_branch:"];
    return required.every((key) => raw.includes(key));
  } catch {
    return false;
  }
}

function probeVisionMd(visionMd) {
  try {
    const stat = lstatSync(visionMd);
    if (!stat.isSymbolicLink()) {
      return { visionMdIsSymlink: false, visionMdSymlinkResolves: false };
    }
    const target = readlinkSync(visionMd);
    const resolved = isAbsolute(target) ? target : resolve(dirname(visionMd), target);
    return { visionMdIsSymlink: true, visionMdSymlinkResolves: existsSync(resolved) };
  } catch {
    return { visionMdIsSymlink: false, visionMdSymlinkResolves: false };
  }
}

function probeGitIgnoresMinsky(globalGitIgnorePath) {
  try {
    const raw = readFileSync(globalGitIgnorePath, "utf8");
    return /^\.minsky\/?$/m.test(raw);
  } catch {
    return false;
  }
}

function renderDoctorReport(report) {
  for (const row of report.rows) {
    const glyph = row.status === "green" ? "✓" : row.status === "yellow" ? "⚠" : "✗";
    const stream = row.status === "red" ? process.stderr : process.stdout;
    stream.write(`${glyph} ${row.message}\n`);
  }
  process.stdout.write(`\n${report.status.toUpperCase()} — overall sidecar status.\n`);
}

async function runDoctor(hostRoot) {
  const minskyDir = resolve(hostRoot, ".minsky");
  const repoYaml = resolve(minskyDir, "repo.yaml");
  const visionMd = resolve(minskyDir, "vision.md");
  const experimentsDir = resolve(minskyDir, "experiments");
  const repoYamlExists = existsSync(repoYaml);
  const visionMdProbe = probeVisionMd(visionMd);
  const report = diagnose({
    repoYamlExists,
    repoYamlValid: repoYamlExists ? probeRepoYamlValid(repoYaml) : false,
    visionMdIsSymlink: visionMdProbe.visionMdIsSymlink,
    visionMdSymlinkResolves: visionMdProbe.visionMdSymlinkResolves,
    experimentsDirExists: existsSync(experimentsDir),
    gitIgnoresMinskyDir: probeGitIgnoresMinsky(resolveGlobalIgnorePath()),
  });
  renderDoctorReport(report);
  return report.status === "red" ? 1 : 0;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    usage();
    return 0;
  }

  const flagDoctor = args.includes("--doctor");
  const flagRepair = args.includes("--repair");
  const positional = args.filter((a) => !a.startsWith("--"));
  if (positional.length !== 1) {
    usage();
    return 64; // EX_USAGE
  }
  const hostRoot = resolve(positional[0]);
  if (!existsSync(hostRoot)) {
    process.stderr.write(`host directory does not exist: ${hostRoot}\n`);
    return 1;
  }

  if (flagDoctor) return runDoctor(hostRoot);
  // --repair is currently identical to a normal bootstrap run because the
  // plan is idempotent — the planner skips already-present artefacts. The
  // distinction exists so a future enhancement can force-repair (e.g.,
  // unconditionally overwrite a corrupted repo.yaml). For now they share
  // a code path; we simply log the mode.
  if (flagRepair) {
    process.stdout.write("ℹ --repair: idempotent re-run (same as default bootstrap)\n");
  }
  return runBootstrap(hostRoot);
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    process.stderr.write(
      `minsky-bootstrap crashed: ${err instanceof Error ? err.stack : String(err)}\n`,
    );
    process.exit(1);
  });

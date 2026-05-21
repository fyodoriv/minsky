// Auto-detect the host target from the operator's current working directory.
// When `minsky-run` is invoked with no `--host` / `--hosts-dir`, we walk the
// cwd to pick the right mode:
//
//   1. cwd has `.minsky/repo.yaml`           → single-host mode (cwd is the host)
//   2. cwd has subdirs with `.minsky/repo.yaml` → multi-host mode (cwd is the parent)
//   3. neither                                 → error with operator-actionable hint
//
// Pattern: pure function over an injected filesystem probe (rule #2 — every
//   I/O dep behind an interface). Source: TASKS.md
//   `minsky-run-autonomous-defaults-and-multi-host`; rule #6 (let-it-crash
//   AT the boundary; auto-detect is advisory — the operator can always
//   pass `--host` / `--hosts-dir` explicitly).
// Conformance: full — pure decision function over typed inputs.

/**
 * Filesystem probe seam — production wires `node:fs.existsSync` +
 * `node:fs.readdirSync`; tests inject a synthetic map.
 */
export interface CwdFsProbe {
  /** True if the given path exists (file or directory). */
  readonly exists: (path: string) => boolean;
  /**
   * List direct-child entries of a directory (no recursion). Returns
   * `[]` when the directory doesn't exist or isn't readable — the
   * decision function treats both as "no subdirs".
   */
  readonly listDir: (path: string) => readonly string[];
}

/**
 * Decision outcomes for cwd auto-detect.
 *
 *   - `single-host`  — cwd itself is bootstrapped; use as `--host`.
 *   - `multi-host`   — cwd has bootstrapped subdirs; use as `--hosts-dir`.
 *   - `error`        — no signal; the operator must pass `--host` or
 *                      `--hosts-dir` explicitly. Carries an actionable
 *                      hint string the CLI prints to stderr.
 */
export type CwdDetectResult =
  | { readonly kind: "single-host"; readonly host: string }
  | { readonly kind: "multi-host"; readonly hostsDir: string; readonly hostCount: number }
  | { readonly kind: "error"; readonly hint: string };

export interface CwdDetectInputs {
  /** Absolute path to the operator's cwd. */
  readonly cwd: string;
  /** Filesystem probe. */
  readonly fs: CwdFsProbe;
}

/**
 * Auto-detect the host target from cwd. Single-host wins over multi-host
 * when cwd is BOTH bootstrapped AND has bootstrapped subdirs — that's
 * the common case (an operator running from inside a host repo that
 * happens to contain bootstrapped sub-repos).
 *
 * @otel cross-repo-runner.cwd-detect
 */
export function detectCwd(inputs: CwdDetectInputs): CwdDetectResult {
  const cwdRepoYaml = joinPath(inputs.cwd, ".minsky/repo.yaml");
  if (inputs.fs.exists(cwdRepoYaml)) {
    return { kind: "single-host", host: inputs.cwd };
  }
  const bootstrappedChildren = findBootstrappedSubdirs(inputs);
  if (bootstrappedChildren.length > 0) {
    return {
      kind: "multi-host",
      hostsDir: inputs.cwd,
      hostCount: bootstrappedChildren.length,
    };
  }
  return {
    kind: "error",
    hint: `cwd (${inputs.cwd}) is not a bootstrapped host AND has no bootstrapped subdirs. Run \`minsky-bootstrap <host-dir>\` first, then re-invoke minsky-run from inside the host OR from a parent directory containing bootstrapped hosts. Alternatively pass --host <dir> or --hosts-dir <parent> explicitly.`,
  };
}

/**
 * Zero-arg context resolver: extends `detectCwd` with git-root and
 * plain-dir fallbacks so `minsky` works from any folder without prior
 * bootstrap. Priority order:
 *   1. bootstrapped (.minsky/repo.yaml)   → single-host
 *   2. bootstrapped subdirs               → multi-host
 *   3. cwd is a git root (.git present)   → single-host
 *   4. cwd has git-root subdirs           → multi-host
 *   5. plain dir (fallback)               → single-host (cwd as root)
 *
 * Used by bin/minsky zero-arg path to scope the conductor; minsky-run
 * keeps using detectCwd so the bootstrap requirement is unchanged there.
 *
 * @otel cross-repo-runner.detect-any-cwd
 */
export function detectAnyCwd(inputs: CwdDetectInputs): CwdDetectResult {
  const bootstrapped = detectCwd(inputs);
  if (bootstrapped.kind !== "error") return bootstrapped;

  const cwdGit = joinPath(inputs.cwd, ".git");
  if (inputs.fs.exists(cwdGit)) {
    return { kind: "single-host", host: inputs.cwd };
  }

  const gitChildren = findGitRootSubdirs(inputs);
  if (gitChildren.length > 0) {
    return { kind: "multi-host", hostsDir: inputs.cwd, hostCount: gitChildren.length };
  }

  // Plain dir — treat cwd itself as the conductor root.
  return { kind: "single-host", host: inputs.cwd };
}

/**
 * List direct subdirs of cwd that contain a `.git` entry (regular git
 * repos, submodules, and worktrees all have one). Analogous to
 * `findBootstrappedSubdirs` but uses `.git` presence instead of
 * `.minsky/repo.yaml`.
 *
 * @otel cross-repo-runner.find-git-root-subdirs
 */
export function findGitRootSubdirs(inputs: CwdDetectInputs): readonly string[] {
  const children = inputs.fs.listDir(inputs.cwd);
  const out: string[] = [];
  for (const child of children) {
    const childPath = joinPath(inputs.cwd, child);
    if (inputs.fs.exists(joinPath(childPath, ".git"))) out.push(childPath);
  }
  return out;
}

/**
 * List subdirs of cwd that carry `.minsky/repo.yaml`. Exposed because the
 * CLI also needs this when the operator passes `--hosts-dir` explicitly
 * (so the same enumeration runs in both auto-detect and explicit paths).
 *
 * @otel cross-repo-runner.find-bootstrapped-subdirs
 */
export function findBootstrappedSubdirs(inputs: CwdDetectInputs): readonly string[] {
  const children = inputs.fs.listDir(inputs.cwd);
  const out: string[] = [];
  for (const child of children) {
    const childPath = joinPath(inputs.cwd, child);
    const childRepoYaml = joinPath(childPath, ".minsky/repo.yaml");
    if (inputs.fs.exists(childRepoYaml)) out.push(childPath);
  }
  return out;
}

/**
 * Minimal path-join without pulling in `node:path` — the function is pure
 * and the tests inject string paths directly. Production wires
 * `path.join` via the cwd-resolver in the CLI before calling here.
 *
 * @otel-exempt pure string helper.
 */
function joinPath(a: string, b: string): string {
  if (a.endsWith("/")) return `${a}${b}`;
  return `${a}/${b}`;
}

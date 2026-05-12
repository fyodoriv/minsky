// `resolveMinskyRepo`: pure function that decides where the minsky
// source repo lives on this machine, so `bin/minsky` (the PATH shim)
// can forward to `novel/cross-repo-runner/bin/minsky-run.mjs` without
// the operator having to `cd` or export a config.
//
// Pattern: pure-function-with-I/O-at-edge (Martin 2017 §6 — keep
//   decisions pure, inject I/O). The caller (bash shim) probes the
//   filesystem; this module only walks a deterministic chain.
// Source: minsky-observer-plugin-via-agentbrew task block in TASKS.md;
//   slice D (PR #492) ships the autonomous CLI; this shim is the PATH
//   surface that lets the operator / the observing agent invoke the
//   CLI from any folder without hand-resolving the repo path.
// Conformance: full. Same input → same output, no fs calls, no
//   process.env reads inside the function — the caller DIs both seams.

/**
 * Inputs to {@link resolveMinskyRepo}. Both seams are DI'd:
 *
 *   - `env`        — usually `process.env`; the function consults
 *                    `env.MINSKY_REPO` first so the operator can
 *                    point at a non-default checkout.
 *   - `exists`     — filesystem probe. Tests pass a stub; the shim
 *                    passes `(p) => existsSync(p)`.
 *   - `homeDir`    — `os.homedir()` at the boundary; lets tests fake
 *                    a home without polluting `process.env.HOME`.
 */
export interface ShimResolveInputs {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly exists: (path: string) => boolean;
  readonly homeDir: string;
}

/** Discriminated result — tells the caller whether to run or print a hint. */
export type ResolveResult =
  | { readonly ok: true; readonly repoPath: string; readonly source: ResolveSource }
  | { readonly ok: false; readonly hint: string };

/**
 * Which seam produced the repoPath. Surfaced in logs + the
 * installer's "where did this come from?" print-out so the operator
 * can audit the resolution after the fact.
 */
export type ResolveSource =
  | "env:MINSKY_REPO"
  | "default:~/apps/tooling/minsky"
  | "fallback:~/apps/minsky"
  | "fallback:~/code/minsky"
  | "fallback:~/src/minsky";

/**
 * Ordered list of fallback paths (relative to `homeDir`) consulted
 * after `env.MINSKY_REPO`. Keep in sync with the `ResolveSource`
 * union so the type checker catches drift.
 *
 * The first entry matches the operator's canonical layout on this
 * machine (Example convention: `~/apps/tooling/<repo>`); subsequent
 * entries are common community layouts. Order is intentional —
 * `~/apps/` beats `~/code/` beats `~/src/`.
 */
const FALLBACK_PATHS: ReadonlyArray<{
  readonly relativePath: string;
  readonly source: ResolveSource;
}> = [
  { relativePath: "apps/tooling/minsky", source: "default:~/apps/tooling/minsky" },
  { relativePath: "apps/minsky", source: "fallback:~/apps/minsky" },
  { relativePath: "code/minsky", source: "fallback:~/code/minsky" },
  { relativePath: "src/minsky", source: "fallback:~/src/minsky" },
];

/**
 * Resolve the minsky source repo on this machine.
 *
 * Resolution order (first match wins):
 *   1. `env.MINSKY_REPO` if set AND the path exists on disk.
 *   2. `~/apps/tooling/minsky` (canonical).
 *   3. `~/apps/minsky`, `~/code/minsky`, `~/src/minsky` (community).
 *
 * The "exists" probe is a single `existsSync` per candidate — keep
 * the resolver under 5 ms on the no-op fast path (the PATH shim is
 * invoked on every prompt in every shell).
 *
 * When nothing matches, returns `{ ok: false, hint }` with a message
 * that tells the operator how to fix it — matches the `Hint: ...`
 * convention used by every other error path in the runner.
 *
 * @otel cross-repo-runner.shim-resolve
 */
export function resolveMinskyRepo(inputs: ShimResolveInputs): ResolveResult {
  const envRepo = inputs.env["MINSKY_REPO"];
  if (envRepo !== undefined && envRepo.length > 0) {
    if (inputs.exists(envRepo)) {
      return { ok: true, repoPath: envRepo, source: "env:MINSKY_REPO" };
    }
    return {
      ok: false,
      hint: `MINSKY_REPO=${envRepo} but that path does not exist. Unset MINSKY_REPO to fall back to the default layout, or clone minsky to that path first.`,
    };
  }
  for (const candidate of FALLBACK_PATHS) {
    const full = joinHome(inputs.homeDir, candidate.relativePath);
    if (inputs.exists(full)) {
      return { ok: true, repoPath: full, source: candidate.source };
    }
  }
  return {
    ok: false,
    hint: `could not find the minsky repo. Looked at MINSKY_REPO env var (unset), ${FALLBACK_PATHS.map((c) => `~/${c.relativePath}`).join(", ")}. Set MINSKY_REPO=/path/to/minsky or clone to ~/apps/tooling/minsky.`,
  };
}

/**
 * Join a relative-to-home path to the home directory. Deliberately
 * avoids `node:path` — keeping the module zero-dependency so the
 * bash shim can consume it via a single `node -e "require(...)"`
 * without paying module-resolution startup cost.
 *
 * Not exported; internal helper.
 */
function joinHome(home: string, relative: string): string {
  const trimmedHome = home.endsWith("/") ? home.slice(0, -1) : home;
  const trimmedRelative = relative.startsWith("/") ? relative.slice(1) : relative;
  return `${trimmedHome}/${trimmedRelative}`;
}

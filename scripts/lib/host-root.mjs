// Host-root resolver — `getHostRoot()` returns the parametric substrate
// root for rule-#9 lints, defaulting to the minsky repo root and overridable
// via `MINSKY_HOST_ROOT` env var.
//
// Pattern: parametric path root (Hewitt 1973 — the substrate boundary is the
//   actor's interface; making the experiments / vision / TASKS root parametric
//   lets the same lint run against minsky's own files and against a host's
//   gitignored `.minsky/` sidecar) + dependency injection at the edge (Martin
//   2017 — the helper is a one-line override that consumers call once at
//   module init).
// Source: rule #2 (vision.md § 2 — every external dep through an interface;
//   here the "external dep" is the *filesystem root*, made explicit);
//   `host-root-resolver-prep` (TASKS.md, P0); user-stories/006-runner-on-any-repo.md
//   (the umbrella story this helper enables); docs/cross-repo-portability.md
//   (the classification that decides which lints need this helper).
// Conformance: full — pure function over `process.env.MINSKY_HOST_ROOT` + a
//   fallback path computed once at module load. No I/O.
//
// Usage at the call site:
//
//   import { getHostRoot } from "./lib/host-root.mjs";
//   const HOST_ROOT = getHostRoot(REPO_ROOT);
//   const SUBSTRATE_PATH = resolve(HOST_ROOT, "experiments");
//
// Behaviour:
//   - When `MINSKY_HOST_ROOT` is unset or empty → returns the supplied
//     `repoRoot` (the minsky repo root). Behaviour-preserving for
//     minsky-on-itself: lints read `${repoRoot}/experiments/`,
//     `${repoRoot}/vision.md`, etc., as before.
//   - When `MINSKY_HOST_ROOT` is set → returns its value (resolved). The
//     consumer reads its substrate from there instead. Cross-repo invocations
//     point at the host's gitignored sidecar (e.g.
//     `MINSKY_HOST_ROOT=/path/to/host-repo/.minsky`); the sidecar's layout
//     mirrors minsky's repo-root substrate (`.minsky/experiments/`,
//     `.minsky/vision.md` symlink, etc.). This means the lint code itself
//     stays substrate-agnostic — same paths, different root.
//
// The helper does NOT validate that the path exists or contains the expected
// substrate — that's the consumer's responsibility (each lint already handles
// ENOENT gracefully per the cross-repo-portability classification).

import { resolve } from "node:path";

/**
 * Returns the parametric host root.
 *
 * @param {string} repoRoot - fallback when MINSKY_HOST_ROOT is unset.
 * @param {NodeJS.ProcessEnv} [envOverride] - for tests.
 * @returns {string}
 */
export function getHostRoot(repoRoot, envOverride) {
  const env = envOverride ?? process.env;
  const override = env["MINSKY_HOST_ROOT"];
  if (typeof override === "string" && override.length > 0) {
    return resolve(override);
  }
  return resolve(repoRoot);
}

// `classifyRepo` + `assertWriteAllowed`: the deterministic permission
// seam for the run-anywhere conductor. A single run may touch many git
// repos under the operator's tree; only the **home** repo (the invoked
// folder's repo / its origin) may receive code pushes and full-flow
// PRs. Every other repo is **foreign** and the ONLY permitted write is
// a `gh pr create` whose diff is limited to that repo's `TASKS.md`
// (scout-and-record across the fleet — never push code elsewhere).
//
// Pattern: pure decision function with fail-safe defaults (Saltzer &
//   Schroeder 1975 — least privilege + fail-safe defaults: deny unless
//   the write is explicitly proven safe). Rule #10 — no model in the
//   gate; same input → same output, zero I/O. The caller (orchestrate
//   .mjs / local-gate-merge.mjs) does the git/gh I/O and asks this
//   module yes/no.
// Source: TASKS.md `runany-permission-scoped-writes`; rule #13
//   (security/privacy — least-authority across repos); operator
//   2026-05-16 directive.
// Conformance: full — no fs, no env reads, no process spawn inside the
//   functions; both seams (origins, diff paths) are caller-supplied.

/** A repo the run touches is either the invoked home repo or foreign. */
export type RepoClass = "home" | "foreign";

/** Write operations the conductor can attempt against a repo. */
export type WriteKind = "push" | "pr";

/**
 * Why a write was refused. Surfaced verbatim in the audit log so
 * `scripts/runany-policy-audit.mjs` can count refusals by class.
 *
 *   - `foreign-push-refused`   — a code push to a non-home repo. Never
 *                                allowed; foreign contribution is
 *                                TASKS.md-PR-only.
 *   - `foreign-pr-non-taskmd`  — a foreign PR whose diff touches a path
 *                                that is not `TASKS.md`.
 *   - `foreign-pr-no-diff`     — a foreign PR with no diff paths
 *                                supplied. Cannot prove the diff shape,
 *                                so fail safe (deny) rather than assume.
 */
export type WriteRefusalReason =
  | "foreign-push-refused"
  | "foreign-pr-non-taskmd"
  | "foreign-pr-no-diff";

/**
 * Inputs to {@link classifyRepo}. Both the origin and the root-path
 * seams are caller-supplied (DI'd at the I/O boundary):
 *
 *   - `candidateOrigin` / `homeOrigin` — `git remote get-url origin`
 *     output, or `null` when the repo has no `origin` remote (a fresh
 *     local clone). Compared after normalization.
 *   - `candidateRoot` / `homeRoot` — optional `git rev-parse
 *     --show-toplevel` absolute paths. Used as a fallback identity when
 *     a repo has no origin (origin-less local repos still get a stable
 *     home/foreign verdict by path).
 */
export interface ClassifyRepoInputs {
  readonly candidateOrigin: string | null;
  readonly homeOrigin: string | null;
  readonly candidateRoot?: string;
  readonly homeRoot?: string;
}

/** Inputs to {@link assertWriteAllowed}. `diffPaths` is required for PRs. */
export interface AssertWriteAllowedInputs {
  readonly repoClass: RepoClass;
  readonly writeKind: WriteKind;
  /**
   * Repo-relative paths the PR diff touches (`gh pr diff --name-only`
   * shaped). Ignored for `push`. For a foreign `pr`, every entry must
   * be a `TASKS.md` file or the write is refused.
   */
  readonly diffPaths?: readonly string[];
}

/** Discriminated decision — `logLine` is always present for the audit trail. */
export type WriteDecision =
  | { readonly allowed: true; readonly logLine: string }
  | {
      readonly allowed: false;
      readonly reason: WriteRefusalReason;
      readonly logLine: string;
    };

/**
 * Normalize a git remote URL / path so the three common forms compare
 * equal:
 *
 *   git@github.com:fyodoriv/minsky.git
 *   https://github.com/fyodoriv/minsky.git
 *   https://github.com/fyodoriv/minsky
 *
 * Strategy: lowercase, strip scheme, rewrite `host:path` SCP form to
 * `host/path`, drop a trailing `.git`, drop a trailing slash. Returns
 * `null` for `null`/empty so two origin-less repos never compare equal
 * by accident (that path falls through to root-path identity).
 *
 * Internal helper — no `@otel` tag.
 */
function normalizeOrigin(raw: string | null): string | null {
  if (raw === null) return null;
  let s = raw.trim().toLowerCase();
  if (s.length === 0) return null;
  // scp-like: git@github.com:fyodoriv/minsky.git → github.com/fyodoriv/minsky.git
  const scp = /^[^/@]+@([^:]+):(.+)$/.exec(s);
  if (scp !== null) {
    s = `${scp[1]}/${scp[2]}`;
  } else {
    // strip scheme://[user[:pass]@] prefix
    s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/^[^/@]+@/, "");
  }
  if (s.endsWith("/")) s = s.slice(0, -1);
  if (s.endsWith(".git")) s = s.slice(0, -4);
  if (s.endsWith("/")) s = s.slice(0, -1);
  return s.length === 0 ? null : s;
}

/** Normalize an absolute path: trim, drop a single trailing slash. */
function normalizeRoot(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  const t = raw.trim();
  if (t.length === 0) return undefined;
  return t.endsWith("/") && t.length > 1 ? t.slice(0, -1) : t;
}

/**
 * Classify a repo as `home` or `foreign` relative to the invoked home
 * repo. Identity is established by (in order):
 *
 *   1. Normalized `origin` URL equality — the canonical signal. Two
 *      repos with the same normalized origin are the same repo even if
 *      checked out at different paths (e.g. a worktree).
 *   2. Normalized root-path equality — fallback for origin-less local
 *      repos (a fresh `git init` with no remote).
 *
 * Fail-safe default (Saltzer & Schroeder 1975): when neither signal
 * proves identity, the repo is `foreign` — the least-authority class.
 * "Don't know" must never grant the home (code-push) privilege.
 *
 * @otel cross-repo-runner.classify-repo
 */
export function classifyRepo(inputs: ClassifyRepoInputs): RepoClass {
  const candidateOrigin = normalizeOrigin(inputs.candidateOrigin);
  const homeOrigin = normalizeOrigin(inputs.homeOrigin);
  if (candidateOrigin !== null && homeOrigin !== null) {
    return candidateOrigin === homeOrigin ? "home" : "foreign";
  }
  const candidateRoot = normalizeRoot(inputs.candidateRoot);
  const homeRoot = normalizeRoot(inputs.homeRoot);
  if (candidateRoot !== undefined && homeRoot !== undefined) {
    return candidateRoot === homeRoot ? "home" : "foreign";
  }
  return "foreign";
}

/**
 * True when a repo-relative path is a `TASKS.md` file. The tasks.md
 * spec permits multiple TASKS.md files (one per subtree), so any path
 * whose final segment is exactly `TASKS.md` qualifies. Case-sensitive
 * — the spec mandates the literal filename `TASKS.md`.
 *
 * Internal helper — no `@otel` tag.
 */
function isTasksMdPath(path: string): boolean {
  const cleaned = path.trim().replace(/\\/g, "/");
  if (cleaned.length === 0) return false;
  const segments = cleaned.split("/");
  return segments[segments.length - 1] === "TASKS.md";
}

/**
 * The hard write gate. Cells:
 *
 *   home    + push → allowed (full flow: branch, push, PR, gate-merge)
 *   home    + pr   → allowed
 *   foreign + push → REFUSED (`foreign-push-refused`) — code never
 *                    leaves the home repo.
 *   foreign + pr   → allowed ONLY when `diffPaths` is non-empty AND
 *                    every entry is a `TASKS.md` file; otherwise
 *                    REFUSED (`foreign-pr-no-diff` /
 *                    `foreign-pr-non-taskmd`).
 *
 * Default-deny: the function enumerates the allowed cells explicitly
 * and refuses everything else. Every decision carries a `logLine` so
 * the caller can emit one audit line per write attempt regardless of
 * verdict (rule #7 — visible, not silent).
 *
 * @otel cross-repo-runner.assert-write-allowed
 */
export function assertWriteAllowed(inputs: AssertWriteAllowedInputs): WriteDecision {
  const { repoClass, writeKind } = inputs;

  if (repoClass === "home") {
    return {
      allowed: true,
      logLine: `runany-policy: ALLOW home ${writeKind} (full flow)`,
    };
  }

  // repoClass === "foreign" from here.
  if (writeKind === "push") {
    return {
      allowed: false,
      reason: "foreign-push-refused",
      logLine:
        "runany-policy: REFUSE foreign push — code pushes to non-home repos are never permitted (rule #13)",
    };
  }

  // foreign + pr — permitted iff the diff is TASKS.md-only.
  const diffPaths = inputs.diffPaths ?? [];
  if (diffPaths.length === 0) {
    return {
      allowed: false,
      reason: "foreign-pr-no-diff",
      logLine:
        "runany-policy: REFUSE foreign pr — no diff paths supplied; cannot prove TASKS.md-only shape (fail-safe deny)",
    };
  }
  const offending = diffPaths.filter((p) => !isTasksMdPath(p));
  if (offending.length > 0) {
    return {
      allowed: false,
      reason: "foreign-pr-non-taskmd",
      logLine: `runany-policy: REFUSE foreign pr — diff touches non-TASKS.md paths: ${offending.join(", ")}`,
    };
  }
  return {
    allowed: true,
    logLine: `runany-policy: ALLOW foreign pr — TASKS.md-only diff (${diffPaths.length} file${diffPaths.length === 1 ? "" : "s"})`,
  };
}

// Least-authority repo policy seam — the deterministic gate that decides,
// for every repo a run-anywhere conductor touches, whether a proposed
// write is permitted. Two pure functions, zero I/O, no model in the
// chain (rule #10): `classifyRepo` (home vs foreign) and
// `assertWriteAllowed` (the verdict over a classified write request).
//
// Policy (operator 2026-05-16 directive):
//   - HOME repo (the invoked folder's git repo / its origin) → the
//     existing full flow: branch, push code, open any PR, gate-merge.
//   - FOREIGN repo (any other git repo under the tree) → the ONLY
//     permitted write is `gh pr create` whose diff is limited to that
//     repo's `TASKS.md` (append findings as tasks.md-spec task blocks).
//     Any code push or non-TASKS.md PR is refused with a stable code so
//     the caller can log it (Acceptance (2)).
//
// Home of the seam: post phase-7b (PR #883) the `novel/cross-repo-runner/`
//   package was deleted and its runner logic migrated to `scripts/lib/*.mjs`
//   (e.g. `host-root.mjs`, `runany-provider-decision.mjs`). This module
//   follows that migrated convention rather than resurrecting the deleted
//   TS package the TASKS.md `**Files**` field still names — recreating a
//   `git rm -rf`'d directory would defeat the phase-7b decision (rule #1 —
//   reuse the current substrate, don't revive deleted infra).
//
// Pattern: pure-function gate (rule #10 — deterministic, no I/O, no LLM;
//   the caller injects the classified facts and logs the verdict) +
//   fail-safe defaults (Saltzer & Schroeder 1975 — an unknown / empty
//   diff on a foreign PR is refused, not allowed).
// Source: TASKS.md `runany-permission-scoped-writes`; rule #13
//   (security/privacy — least authority across repos); Saltzer &
//   Schroeder 1975 ("The Protection of Information in Computer Systems"
//   — least privilege + fail-safe defaults).
// Conformance: full — same input → same output, no fs / process / git
//   calls inside either function; the caller owns I/O and logging.

/**
 * @typedef {"home" | "foreign"} RepoClass
 *   How a repo the run touches is classified relative to the invoked
 *   (home) repo. The two cells map 1:1 to the two write policies.
 */

/**
 * @typedef {"push-code" | "open-pr"} WriteAction
 *   The write a conductor is about to perform against a repo.
 *
 *     - `push-code`  — `git push` of a branch carrying code (any non-PR
 *                      publication to a remote).
 *     - `open-pr`    — `gh pr create`. Whether it is permitted on a
 *                      foreign repo depends on the diff shape.
 *
 *   A "TASKS.md-only PR" is not a third action — it is an `open-pr`
 *   whose `changedPaths` are all `TASKS.md`. Collapsing it keeps the
 *   external surface minimal (one decision function, two actions).
 */

/**
 * @typedef {"foreign-code-push" | "foreign-nontaskmd-pr"} WriteRefusalCode
 *   Stable, machine-readable refusal codes. The wiring layer logs these
 *   verbatim so `scripts/runany-policy-audit.mjs` can count refusals
 *   without re-parsing prose (Acceptance (2) + the run-window metric).
 */

/**
 * @typedef {{ allowed: true, classification: RepoClass, action: WriteAction }
 *   | { allowed: false, code: WriteRefusalCode, reason: string }} WriteVerdict
 *   Discriminated verdict. On allow, the classification + action are
 *   echoed back so the caller's log line is self-describing. On refuse,
 *   a stable `code` plus a human reason.
 */

/**
 * @typedef {object} ClassifyRepoInputs
 * @property {string} repoRoot   absolute git toplevel of the repo being written to.
 * @property {string} homeRoot   absolute git toplevel of the invoked (home) repo.
 * @property {string} [repoOrigin]  optional `origin` remote URL of the candidate repo.
 * @property {string} [homeOrigin]  optional `origin` remote URL of the home repo.
 *
 *   The caller resolves these at the I/O boundary (git rev-parse +
 *   `git remote get-url origin`); this function only compares the
 *   resolved facts. Either a path match OR (when both origins are known
 *   and non-empty) an origin match means HOME — so a separate worktree /
 *   fresh clone of the same upstream is still treated as home, not foreign.
 */

/**
 * @typedef {object} WriteRequest
 * @property {RepoClass} repoClass
 * @property {WriteAction} action
 * @property {readonly string[]} [changedPaths]
 *
 *   A foreign-repo PR request to vet against the TASKS.md-only shape.
 *   `changedPaths` are the repo-relative paths the PR diff touches; an
 *   omitted or empty list on a foreign `open-pr` is treated as UNKNOWN
 *   and refused (fail-safe — never assume an undetermined diff is safe).
 *   Ignored for `push-code` and for any home-repo request.
 */

/**
 * Classify a repo as `home` or `foreign` relative to the invoked repo.
 *
 * Match rule (first hit wins → `home`):
 *   1. Normalised `repoRoot` === normalised `homeRoot`.
 *   2. Both origins known & non-empty AND normalised `repoOrigin` ===
 *      normalised `homeOrigin` (handles worktrees / fresh clones).
 * Otherwise → `foreign`.
 *
 * Path normalisation strips trailing slashes only (the caller passes
 * absolute real paths). Origin normalisation strips the scheme, an
 * `git@`/`user@` prefix, the `:`→`/` SCP-form separator, a trailing
 * `.git`, trailing slashes, and lowercases — so
 * `git@github.com:org/repo.git`, `https://github.com/org/repo`, and
 * `ssh://git@github.com/org/repo/` all collapse to `github.com/org/repo`.
 *
 * @param {ClassifyRepoInputs} inputs
 * @returns {RepoClass}
 */
export function classifyRepo(inputs) {
  if (normalizeRoot(inputs.repoRoot) === normalizeRoot(inputs.homeRoot)) {
    return "home";
  }
  const repoOrigin = normalizeOrigin(inputs.repoOrigin);
  const homeOrigin = normalizeOrigin(inputs.homeOrigin);
  if (repoOrigin.length > 0 && repoOrigin === homeOrigin) {
    return "home";
  }
  return "foreign";
}

/**
 * The single permission gate. Decides whether `req.action` is allowed
 * against a `req.repoClass`-classified repo.
 *
 * Decision table (this IS the home vs foreign × push/PR/taskmd matrix):
 *
 *   | class   | action     | diff shape        | verdict                |
 *   |---------|------------|-------------------|------------------------|
 *   | home    | push-code  | (any)             | allow                  |
 *   | home    | open-pr    | (any)             | allow                  |
 *   | foreign | push-code  | (any)             | refuse foreign-code-push |
 *   | foreign | open-pr    | TASKS.md-only     | allow                  |
 *   | foreign | open-pr    | other / unknown   | refuse foreign-nontaskmd-pr |
 *
 * Fail-safe: a foreign `open-pr` with omitted/empty `changedPaths`
 * (diff undetermined) is refused, never allowed.
 *
 * @param {WriteRequest} req
 * @returns {WriteVerdict}
 */
export function assertWriteAllowed(req) {
  if (req.repoClass === "home") {
    return { allowed: true, classification: "home", action: req.action };
  }
  if (req.action === "push-code") {
    return {
      allowed: false,
      code: "foreign-code-push",
      reason:
        "refused: foreign repo — code pushes are never permitted; the only foreign write is a TASKS.md-only PR",
    };
  }
  if (isTaskmdOnlyDiff(req.changedPaths ?? [])) {
    return { allowed: true, classification: "foreign", action: "open-pr" };
  }
  return {
    allowed: false,
    code: "foreign-nontaskmd-pr",
    reason:
      "refused: foreign repo — a PR is permitted only when its diff is limited to TASKS.md (got a non-TASKS.md or empty/undetermined diff)",
  };
}

/**
 * Defense-in-depth diff-shape predicate (the Pivot's backstop). True
 * iff `changedPaths` is non-empty AND every path is a `TASKS.md` file
 * (root or nested — basename match, since a repo may carry several
 * TASKS.md per the tasks.md spec). An empty list is `false`
 * (fail-safe — an undetermined diff is not "TASKS.md only").
 *
 * @param {readonly string[]} changedPaths
 * @returns {boolean}
 */
export function isTaskmdOnlyDiff(changedPaths) {
  if (changedPaths.length === 0) return false;
  return changedPaths.every((p) => isTasksMdPath(p));
}

/**
 * A path is a TASKS.md file iff its last `/`-segment is exactly
 * `TASKS.md`. Rejects look-alikes (`TASKS.md.bak`, `MY-TASKS.md`,
 * `TASKS.markdown`). Not exported — internal helper.
 * @param {string} path
 * @returns {boolean}
 */
function isTasksMdPath(path) {
  const trimmed = path.trim();
  if (trimmed.length === 0) return false;
  const segments = trimmed.split(/[\\/]/);
  return segments[segments.length - 1] === "TASKS.md";
}

/**
 * Strip trailing slashes from an absolute path so `/a/b` and `/a/b/`
 * compare equal. The caller is responsible for passing a real
 * (symlink-resolved) absolute path — this stays pure. Not exported.
 * @param {string} root
 * @returns {string}
 */
function normalizeRoot(root) {
  return root.replace(/\/+$/, "");
}

/**
 * Collapse the common git remote URL forms to `host/org/repo`:
 *   - `git@github.com:org/repo.git`
 *   - `https://github.com/org/repo.git`
 *   - `ssh://git@github.com/org/repo/`
 * all → `github.com/org/repo`. Returns `""` for undefined/empty so the
 * caller's "both origins known" guard is a simple length check. Not exported.
 * @param {string | undefined} origin
 * @returns {string}
 */
function normalizeOrigin(origin) {
  if (origin === undefined) return "";
  let s = origin.trim();
  if (s.length === 0) return "";
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//i, ""); // strip scheme://
  s = s.replace(/^[^@/]+@/, ""); // strip user@ (git@, etc.)
  s = s.replace(/:(?!\d)/, "/"); // SCP-form host:org → host/org
  s = s.replace(/\.git$/i, ""); // trailing .git
  s = s.replace(/\/+$/, ""); // trailing slashes
  return s.toLowerCase();
}

/**
 * Build the `write-verdict` ledger record the conductor appends to
 * `.minsky/runany-policy.jsonl` after each `assertWriteAllowed` call.
 * The shape is exactly what `scripts/runany-policy-audit.mjs` reads
 * (`classifyLedgerRecord`): `repoClass`, `action`, `allowed`,
 * `taskmdOnly`, and (on refusal) the stable `code`. Pure — the caller
 * owns the `appendFileSync` so this stays unit-testable with no I/O.
 *
 * @param {WriteRequest} req   the vetted request (carries the action + diff).
 * @param {WriteVerdict} verdict   the {@link assertWriteAllowed} result.
 * @param {string} [ts]   ISO timestamp; defaults to now (injected for tests).
 * @returns {{ts:string, event:"write-verdict", repoClass:RepoClass, action:WriteAction, allowed:boolean, taskmdOnly:boolean, code?:WriteRefusalCode}}
 */
export function buildWriteVerdictRecord(req, verdict, ts) {
  /** @type {{ts:string, event:"write-verdict", repoClass:RepoClass, action:WriteAction, allowed:boolean, taskmdOnly:boolean, code?:WriteRefusalCode}} */
  const rec = {
    ts: ts ?? new Date().toISOString(),
    event: "write-verdict",
    repoClass: req.repoClass,
    action: req.action,
    allowed: verdict.allowed,
    taskmdOnly: isTaskmdOnlyDiff(req.changedPaths ?? []),
  };
  if (!verdict.allowed) rec.code = verdict.code;
  return rec;
}

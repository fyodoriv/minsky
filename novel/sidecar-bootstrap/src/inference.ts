// Per-host convention inference — given the readable surface of a host
// repo (package.json, CLAUDE.md/AGENTS.md, .git/config), infer sensible
// defaults for `repo.yaml` so the operator's interactive confirmation step
// is "nudge the inferred values" rather than "fill in 9 fields from scratch".
//
// Pattern: pure inference over read-only inputs (Hunt & Thomas, *The
//   Pragmatic Programmer*, 1999, Tip 8 "Make It Easy to Reuse"; the
//   inferred shape is a hypothesis the operator confirms — not a committed
//   contract). Source: rule #1 (vision.md § 1 — don't reinvent: every host
//   already has signals about its conventions; we read them, we don't
//   re-elicit).
// Conformance: full — the inference is a pure function over a
//   `HostSignals` input; no I/O. The CLI is the I/O boundary.
//
// All fields default conservatively: when a signal is missing we pick the
// smallest viable default ("no pre-commit step", "default branch is main",
// "no ticket format") rather than guessing aggressively. The `--repair`
// path treats inferred-but-not-confirmed values as drift candidates.

import type { RepoConfig } from "./schema.js";

/**
 * Read-only signals the inference function consumes. Each signal is
 * optional; missing signals default to conservative values.
 */
export interface HostSignals {
  /** Parsed package.json contents, or `null` if no package.json. */
  packageJson: Record<string, unknown> | null;
  /** Repo's git remote URL (origin), or `null` if unset. */
  gitRemoteUrl: string | null;
  /** Default branch name from git config, or `null` to fall back to inference. */
  gitDefaultBranch: string | null;
  /** Whether `TASKS.md` exists at the host root. */
  hasRootTasksMd: boolean;
  /** Whether `CLAUDE.md` exists at the host root. */
  hasClaudeMd: boolean;
  /** Whether `AGENTS.md` exists at the host root. */
  hasAgentsMd: boolean;
}

/**
 * Empty signals — the bootstrap calls this when the host has no readable
 * signals, so the inference falls back to the conservative defaults.
 */
export const NO_HOST_SIGNALS: HostSignals = {
  packageJson: null,
  gitRemoteUrl: null,
  gitDefaultBranch: null,
  hasRootTasksMd: false,
  hasClaudeMd: false,
  hasAgentsMd: false,
};

/**
 * Pure function: infer a `RepoConfig` shape from the readable surface of a
 * host repo. The output is the bootstrap's *proposal*; the operator may
 * accept, edit, or reject it before it lands at `.minsky/repo.yaml`.
 *
 * @otel sidecar-bootstrap.infer-repo-config
 */
export function inferRepoConfig(signals: HostSignals): RepoConfig {
  return {
    host_repo: inferHostRepo(signals.gitRemoteUrl),
    tasks_md_path: signals.hasRootTasksMd ? "TASKS.md" : "TASKS.md",
    commit_format: inferCommitFormat(signals),
    pre_commit_command: inferPreCommitCommand(signals.packageJson),
    branch_prefix: "feat/",
    default_branch: signals.gitDefaultBranch ?? "main",
    ticket_format: inferTicketFormat(signals),
    lint_substrate_overrides: {},
    host_packages_path: inferHostPackagesPath(signals.packageJson),
    ignore_mechanism: "global-ignore",
  };
}

/**
 * Extract the canonical `owner/repo` identifier from a git remote URL.
 * Handles both HTTPS (`https://github.com/owner/repo.git`) and SSH
 * (`git@github.com:owner/repo.git`) forms. Returns the literal placeholder
 * `unknown/unknown` when no signal is available — the operator MUST fix
 * this before the runner can label experiment-store records correctly.
 */
function inferHostRepo(remoteUrl: string | null): string {
  if (remoteUrl === null) return "unknown/unknown";
  // git@host:owner/repo.git
  const sshMatch = remoteUrl.match(/[:/]([^/:]+)\/([^/]+?)(?:\.git)?$/);
  if (sshMatch?.[1] !== undefined && sshMatch[2] !== undefined) {
    return `${sshMatch[1]}/${sshMatch[2]}`;
  }
  return "unknown/unknown";
}

/**
 * The default commit-format template. Hosts with a more specific
 * convention (e.g. example-capabilities's `type: subject TICKET-0000`)
 * override this in their `.minsky/repo.yaml` directly — the bootstrap's
 * job is the inferred shape, not the finished template.
 */
function inferCommitFormat(_signals: HostSignals): string {
  return "<TYPE>: <DESCRIPTION>";
}

/**
 * If package.json declares a `lint` script, propose `npm run lint`. If
 * yarn or pnpm are detected via the `packageManager` field, swap the
 * runner. Otherwise return empty (no pre-commit step inferred).
 */
function inferPreCommitCommand(pkg: Record<string, unknown> | null): string {
  if (pkg === null) return "";
  const scripts = pkg["scripts"];
  if (typeof scripts !== "object" || scripts === null) return "";
  const hasLint = (scripts as Record<string, unknown>)["lint"] !== undefined;
  if (!hasLint) return "";
  const pm = pkg["packageManager"];
  if (typeof pm === "string") {
    if (pm.startsWith("yarn")) return "yarn lint";
    if (pm.startsWith("pnpm")) return "pnpm lint";
  }
  return "npm run lint";
}

/**
 * Look at CLAUDE.md / AGENTS.md presence as a weak signal that this is a
 * project with conventional ticket formats. Without reading those files,
 * we can't infer the regex; we return `null` (operator must declare).
 */
function inferTicketFormat(_signals: HostSignals): string | null {
  return null;
}

/**
 * If package.json declares a `workspaces` field, propose `packages/` (the
 * yarn / npm convention). Otherwise propose `src/` (the single-package
 * convention).
 */
function inferHostPackagesPath(pkg: Record<string, unknown> | null): string {
  if (pkg === null) return "src/";
  const workspaces = pkg["workspaces"];
  if (Array.isArray(workspaces) && workspaces.length > 0) return "packages/";
  if (typeof workspaces === "object" && workspaces !== null) return "packages/";
  return "src/";
}

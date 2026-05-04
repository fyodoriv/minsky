// Schema for the per-host `.minsky/repo.yaml` overlay file.
//
// Pattern: declarative configuration record (Fowler, *Patterns of Enterprise
//   Application Architecture*, 2002 — DTO + simple validator) anchored on
//   `repo.yaml` as the single source of truth for host-repo conventions.
// Source: user-stories/006-runner-on-any-repo.md (the umbrella story); rule
//   #2 (vision.md § 2 — every external dep through an interface; the host
//   repo's conventions are an external dep, made explicit via this schema);
//   rule #6 (vision.md § 6 — let-it-crash; the parser returns structured
//   errors instead of throwing, so the CLI decides the operator-facing shape).
// Conformance: full — the schema is a pure type + a pure validator.
//
// Required fields: every host-repo overlay must declare these so the
// cross-repo-runner has unambiguous behaviour. Optional fields default to
// the conventions inferred from the host's package.json + CLAUDE.md when
// the bootstrap command runs.

/**
 * The repo.yaml shape. One-to-one with the YAML file the operator hand-edits
 * (or accepts from `minsky bootstrap`'s inference).
 */
export interface RepoConfig {
  /**
   * Canonical owner/repo identifier — `expertnetwrk-portal/iep-capabilities`,
   * `vercel/next.js`, etc. Used by the runner to label experiment-store
   * records and by the cross-repo CI action to scope check-runs.
   */
  host_repo: string;

  /**
   * Path (relative to the host repo root) to the host's TASKS.md. Default
   * `TASKS.md` per the tasks.md spec; some hosts use `docs/TASKS.md` or
   * similar.
   */
  tasks_md_path: string;

  /**
   * Conventional commit subject template. Free-form string; placeholders
   * (`<TICKET>`, `<TYPE>`, `<DESCRIPTION>`) are substituted by the runner
   * when it formats commit messages. The runner does NOT enforce a format
   * beyond what the host's commitlint hook already enforces.
   */
  commit_format: string;

  /**
   * Shell command run before `git commit` on every cross-repo run. Examples:
   * `yarn run -T eslint --fix && yarn tsc --build`, `pnpm run check`, `npm
   * run lint`. Empty string means no pre-commit step (the host's lefthook
   * or git pre-commit hook is the substitute).
   */
  pre_commit_command: string;

  /**
   * Branch-name prefix for runner-cut branches. Default `feat/` — the runner
   * cuts e.g. `feat/aifn-840-slash-command-labels` from `default_branch`.
   */
  branch_prefix: string;

  /**
   * Default branch name (`main`, `master`, etc.). The runner reads this to
   * compute the merge-base for the per-PR experiment-runner.
   */
  default_branch: string;

  /**
   * Optional regex (as a string) that valid ticket identifiers match.
   * Examples: `AIFN-\\d+`, `[A-Z]+-\\d+`, `#\\d+`. The runner uses this for
   * `--ticket` arg validation and to extract a ticket from a TASKS.md task
   * description heuristically.
   */
  ticket_format: string | null;

  /**
   * Per-rule lint substrate overrides. Maps a rule lint name (e.g.
   * `rule-6-let-it-crash`) to either `"skip"` (the host has no equivalent
   * substrate; the rule is a no-op for this host) or a host-specific shell
   * command (e.g. `"yarn run -T eslint"`) that the host runs to enforce
   * the equivalent.
   */
  lint_substrate_overrides: Record<string, string>;

  /**
   * Path (relative to host root) where the host's package source code
   * lives. Examples: `packages/`, `src/`, `plugins/`. Used by rule lints
   * that walk source trees (rule-2, rule-3, rule-4) when ported.
   */
  host_packages_path: string;

  /**
   * The mechanism the bootstrap chose for excluding `.minsky/` from the
   * host's git history. `"global-ignore"` (default — appended to
   * `~/.config/git/ignore`); `"per-clone-exclude"` (fallback — appended to
   * `<host>/.git/info/exclude` when the global path is unwritable);
   * `"none"` (the operator opted out — `.minsky/` MAY enter the host's
   * working tree, but the bootstrap warns each invocation).
   */
  ignore_mechanism: "global-ignore" | "per-clone-exclude" | "none";
}

/**
 * Parser verdict. Either `{ ok: true, config }` with the parsed RepoConfig,
 * or `{ ok: false, errors }` with a structured list of human-readable
 * errors (each with a `field` reference for editor-side fixups).
 */
export type ParseRepoConfigResult =
  | { ok: true; config: RepoConfig }
  | { ok: false; errors: ParseError[] };

export interface ParseError {
  /** The repo.yaml field that failed validation, or `"_root"` for shape. */
  field: string;
  /** Human-readable reason. Stable enough for tests to assert against. */
  message: string;
}

function validateRequiredString(
  obj: Record<string, unknown>,
  field: string,
  errors: ParseError[],
): string | null {
  const value = obj[field];
  if (typeof value !== "string") {
    errors.push({ field, message: `field "${field}" must be a string` });
    return null;
  }
  if (value.length === 0) {
    errors.push({ field, message: `field "${field}" must not be empty` });
    return null;
  }
  return value;
}

function validatePreCommitCommand(
  obj: Record<string, unknown>,
  errors: ParseError[],
): string | null {
  const raw = obj["pre_commit_command"];
  if (typeof raw === "string") return raw;
  errors.push({
    field: "pre_commit_command",
    message: 'field "pre_commit_command" must be a string (empty allowed)',
  });
  return null;
}

function validateTicketFormat(obj: Record<string, unknown>, errors: ParseError[]): string | null {
  const raw = obj["ticket_format"];
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") return raw;
  errors.push({
    field: "ticket_format",
    message: 'field "ticket_format" must be a string or null',
  });
  return null;
}

function validateLintOverrides(
  obj: Record<string, unknown>,
  errors: ParseError[],
): Record<string, string> {
  const raw = obj["lint_substrate_overrides"];
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    errors.push({
      field: "lint_substrate_overrides",
      message: 'field "lint_substrate_overrides" must be an object',
    });
    return {};
  }
  const collected: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== "string") {
      errors.push({
        field: `lint_substrate_overrides.${key}`,
        message: `override "${key}" must be a string`,
      });
      continue;
    }
    collected[key] = value;
  }
  return collected;
}

function validateIgnoreMechanism(
  obj: Record<string, unknown>,
  errors: ParseError[],
): RepoConfig["ignore_mechanism"] {
  const raw = obj["ignore_mechanism"];
  if (raw === undefined || raw === null) return "global-ignore";
  if (raw === "global-ignore" || raw === "per-clone-exclude" || raw === "none") {
    return raw;
  }
  errors.push({
    field: "ignore_mechanism",
    message:
      'field "ignore_mechanism" must be one of "global-ignore" / "per-clone-exclude" / "none"',
  });
  return "global-ignore";
}

/**
 * Pure validator: takes the parsed YAML object (whatever the YAML parser
 * returned) and confirms it matches the RepoConfig shape. Returns
 * structured errors rather than throwing — the CLI decides whether to
 * print, fail, or auto-repair (rule #6 — let-it-crash AT the boundary).
 *
 * @otel sidecar-bootstrap.parse-repo-config
 */
export function parseRepoConfig(input: unknown): ParseRepoConfigResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return {
      ok: false,
      errors: [{ field: "_root", message: "repo.yaml must parse to an object" }],
    };
  }
  const obj = input as Record<string, unknown>;
  const errors: ParseError[] = [];

  const host_repo = validateRequiredString(obj, "host_repo", errors);
  const tasks_md_path = validateRequiredString(obj, "tasks_md_path", errors);
  const commit_format = validateRequiredString(obj, "commit_format", errors);
  const branch_prefix = validateRequiredString(obj, "branch_prefix", errors);
  const default_branch = validateRequiredString(obj, "default_branch", errors);
  const host_packages_path = validateRequiredString(obj, "host_packages_path", errors);
  const pre_commit_command = validatePreCommitCommand(obj, errors);
  const ticket_format = validateTicketFormat(obj, errors);
  const lint_substrate_overrides = validateLintOverrides(obj, errors);
  const ignore_mechanism = validateIgnoreMechanism(obj, errors);

  if (errors.length > 0) return { ok: false, errors };
  if (
    host_repo === null ||
    tasks_md_path === null ||
    commit_format === null ||
    branch_prefix === null ||
    default_branch === null ||
    host_packages_path === null ||
    pre_commit_command === null
  ) {
    return {
      ok: false,
      errors: [{ field: "_root", message: "internal: required field collection inconsistent" }],
    };
  }

  return {
    ok: true,
    config: {
      host_repo,
      tasks_md_path,
      commit_format,
      pre_commit_command,
      branch_prefix,
      default_branch,
      ticket_format,
      lint_substrate_overrides,
      host_packages_path,
      ignore_mechanism,
    },
  };
}

// <!-- scope: human-approved minsky-cross-machine-dotfile-checks slice 3 (operator 2026-05-08 — "Next let's add as much stable self-healing as reasonable to minsky & install commands") -->
/**
 * `@minsky/tick-loop/git-config-path-checks` — pure detect-and-report
 * helper for git config keys that point at filesystem paths
 * synchronised across machines via dotfiles. Slice 3 of P0 task
 * `minsky-cross-machine-dotfile-checks` per `TASKS.md`.
 *
 * Why: PRs #394/#395 shipped graceful-degrade for the lefthook
 * permission denial caused by an invalid `core.hooksPath` from
 * synced dotfiles. That covers the symptom of one specific key
 * during one specific phase (`pnpm install`'s prepare hook). The
 * general pattern — git config keys that reference filesystem
 * paths via dotfiles synced across machines with different
 * usernames — affects multiple keys and surfaces at different
 * times (mid-commit, mid-merge, mid-rebase). Surfacing the broken
 * paths upfront in `minsky doctor` is cheap and lets the operator
 * fix all of them with copy-paste-able recovery commands before
 * any of them blow up.
 *
 * The helper is pure-over-injection so the test layer can simulate
 * each (key × origin × valid/invalid) matrix. Production wiring in
 * `bin/minsky.mjs::runDoctor` shells out to `git config
 * --show-origin --get <key>` for each {@link PATH_CONFIG_KEYS}
 * entry and inspects the returned path with `existsSync`.
 *
 * Aggressiveness boundary (operator 2026-05-08): "detect + auto-fix
 * safe ops" — git config is OUTSIDE `.minsky/`, so this slice is
 * detect-and-warn only. We never mutate the operator's git config
 * automatically; the recovery command shown is for the operator to
 * run when they confirm the change.
 *
 * Pattern conformance (rule #8): Pure decision function (Hughes
 * 1989); Detect-not-mutate boundary per the operator's chosen
 * aggressiveness. Sources: Beyer et al. (SRE) Ch. 6 — health checks
 * must distinguish failure modes the operator can act on from
 * internal bugs. Git docs on config scoping (system / global /
 * local merge order).
 *
 * Failure modes & chaos verification (rule #7):
 *
 * | # | Failure mode | Trigger | Expected behavior | Chaos test |
 * |---|---|---|---|---|
 * | 1 | all keys unset | Fresh-install host with no synced dotfiles | `{ brokenPaths: [] }` | "all unset" |
 * | 2 | set + valid | Operator's primary machine | `{ brokenPaths: [] }` | "set + valid" |
 * | 3 | set + path missing | Multi-machine pattern | `{ brokenPaths: [<broken>] }` with origin + recoveryCommand | "set + missing" |
 * | 4 | unknown origin | git config returns ambiguous origin field | recovery command falls back to `git config --unset` (no scope flag) | "unknown origin" |
 *
 * @module tick-loop/git-config-path-checks
 */

/** Default set of git config keys we check. The 3 highest-impact
 * keys for the multi-machine pattern. Add a 4th key in the same
 * file (and one paired test row) when the next failure mode is
 * surfaced. */
export const PATH_CONFIG_KEYS = [
  "core.hooksPath",
  "core.attributesfile",
  "core.excludesfile",
] as const;

/** Origin of a git config value, returned by `--show-origin`. */
export type GitConfigOrigin = "system" | "global" | "local" | "unknown";

/** A {key, value, origin} triple from `git config --show-origin --get`. */
export type GitConfigValue = {
  readonly value: string;
  readonly origin: GitConfigOrigin;
};

/** A broken git config path, as classified by {@link checkGitConfigPaths}. */
export type BrokenGitConfigPath = {
  readonly configKey: string;
  readonly configValue: string;
  readonly origin: GitConfigOrigin;
  readonly recoveryCommand: string;
};

/** Outcome of a {@link checkGitConfigPaths} run. */
export type GitConfigCheckOutcome = {
  readonly brokenPaths: readonly BrokenGitConfigPath[];
};

/**
 * For each key in `keysToCheck`, look up the (value, origin) pair.
 * Skip keys that are unset. For set keys, check whether the value
 * (interpreted as a filesystem path) exists; if not, classify as
 * broken and emit a recovery command sized to the origin scope.
 *
 * @otel-exempt pure decision function — caller's spawn is what
 *   carries the otel attribute (broken-paths count, etc.).
 */
export function checkGitConfigPaths(opts: {
  readonly keysToCheck: readonly string[];
  readonly getGitConfigFn: (key: string) => GitConfigValue | undefined;
  readonly existsSyncFn: (p: string) => boolean;
}): GitConfigCheckOutcome {
  const broken: BrokenGitConfigPath[] = [];
  for (const key of opts.keysToCheck) {
    const cfg = opts.getGitConfigFn(key);
    if (cfg === undefined) continue;
    if (opts.existsSyncFn(cfg.value)) continue;
    broken.push({
      configKey: key,
      configValue: cfg.value,
      origin: cfg.origin,
      recoveryCommand: recoveryCommandFor(key, cfg.origin),
    });
  }
  return { brokenPaths: broken };
}

function recoveryCommandFor(configKey: string, origin: GitConfigOrigin): string {
  if (origin === "global") return `git config --global --unset ${configKey}`;
  if (origin === "local") return `git config --local --unset ${configKey}`;
  if (origin === "system") return `git config --system --unset ${configKey}`;
  // Ambiguous origin → rely on the user's default scope. Less precise but
  // still safe (won't mutate the wrong scope by accident).
  return `git config --unset ${configKey}`;
}

/**
 * Render a single-line `minsky:`-prefixed message for a broken
 * git config path. Pinned by paired tests.
 *
 * @otel-exempt pure formatter.
 */
export function formatBrokenPathMessage(broken: BrokenGitConfigPath): string {
  return `minsky: git config ${broken.configKey} (${broken.origin}) points at ${broken.configValue} which does not exist — recover with \`${broken.recoveryCommand}\``;
}

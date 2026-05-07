// <!-- scope: human-approved slice 1 of `supervisor-sandbox-syscall-restriction` (P0 sibling cited by `security-privacy-priority-substrate`'s rule #13.3 minimum bar) -->

/**
 * Slice 1 substrate of `supervisor-sandbox-syscall-restriction` (vision.md
 * § 13.3 — supervisor sandbox, the third minimum-bar item of rule #13).
 *
 * Pure resolver `resolveSandboxMode(env)` for the operator's
 * `MINSKY_SANDBOX` ramp-control env var. Three modes per the parent task's
 * staged-rollout discipline ("ship in stages: pre-merge dry-run for 7 days;
 * post-merge ramp via `MINSKY_SANDBOX=warn-only` for 14 days, then
 * `MINSKY_SANDBOX=enforce`. Each ramp step is a separate PR, not a single
 * big-bang change."):
 *
 *   - `'off'` — no sandboxing. Default. Today's behaviour (the supervisor
 *     runs as the operator's full UID with no syscall restrictions). The
 *     resolver defaults here so this slice is substrate-inert: a regression
 *     in the resolver cannot break the running supervisor before slices 2-N
 *     wire it into the spawn path, the systemd unit-file properties, or
 *     the macOS `sandbox-exec` profile.
 *   - `'warn-only'` — the launchd / systemd wrapper logs every disallowed
 *     access (read outside `~/.claude/projects/` + `<repo>/`, network bind
 *     outside loopback) but does not block. The 14-day soak window per the
 *     task block. Operator visibility (rule #6, "stay alive — visible-not-
 *     silent failure") without operational risk.
 *   - `'enforce'` — disallowed accesses fail with EPERM. Production target.
 *
 * The substrate is deliberately a pure function of the env so unit tests
 * can pin every transition without spawning a process; the I/O boundary
 * (the wrapper script, the launchd plist, the systemd `.service`) lands
 * in subsequent slices and consumes this resolver's output.
 *
 * Why default 'off' and not 'warn-only': the task block's risk
 * assessment is high ("Sandboxing introduces real friction with normal
 * operation; the path-allow-list is the most likely source of false
 * positives") and rule #6 graceful-degrade requires a substrate that
 * cannot break the running supervisor. A typo in the env var, a missing
 * env var on a fresh checkout, or an empty value all resolve to `'off'`
 * — which IS the current behaviour. The operator opts in explicitly.
 *
 * Industry-standard primitives consumed by later slices: macOS App
 * Sandbox / `sandbox-exec` (TrustedBSD MAC framework — McKusick & Watson)
 * and Linux systemd hardening (`ProtectSystem`, `PrivateTmp`,
 * `RestrictAddressFamilies`, `SystemCallFilter` — `systemd.exec(5)`).
 * Saltzer & Schroeder 1975's principle of least privilege is the load-
 * bearing constitutional anchor.
 *
 * @otel-exempt pure resolver — no I/O. The wrapper-script call site is
 * the I/O boundary that records the chosen mode in a span.
 */

export type SandboxMode = "off" | "warn-only" | "enforce";

export const SANDBOX_MODE_ENV = "MINSKY_SANDBOX";
export const SANDBOX_MODE_DEFAULT: SandboxMode = "off";

const VALID_MODES: ReadonlySet<SandboxMode> = new Set(["off", "warn-only", "enforce"]);

/**
 * Resolve the supervisor sandbox mode from the process env.
 *
 * Resolution rules (in order):
 *   1. `MINSKY_SANDBOX` unset, empty, or whitespace-only → `'off'` (default).
 *   2. Trim + lowercase the value, then accept `'off' | 'warn-only' | 'enforce'`.
 *   3. Any other value (typo, unknown mode) → `'off'` with a warning string
 *      surfaced via `sandboxModeWarning`. Fail-safe-defaults (Saltzer &
 *      Schroeder 1975): an unrecognised value should not silently turn
 *      enforcement on or off in a surprising way; it should fall back to
 *      the operator's pre-resolver default and surface the typo.
 *
 * @otel-exempt pure resolver.
 */
export function resolveSandboxMode(env: NodeJS.ProcessEnv): SandboxMode {
  const raw = env[SANDBOX_MODE_ENV];
  if (raw === undefined) return SANDBOX_MODE_DEFAULT;
  const normalised = raw.trim().toLowerCase();
  if (normalised === "") return SANDBOX_MODE_DEFAULT;
  if (VALID_MODES.has(normalised as SandboxMode)) return normalised as SandboxMode;
  return SANDBOX_MODE_DEFAULT;
}

/**
 * Return a warning string when the env carries a non-empty value that
 * doesn't resolve to a valid mode (typo / unknown mode); `null` otherwise.
 * The wrapper-script I/O boundary writes the warning to stderr so the
 * operator sees the typo in writing — silent fall-back to `'off'` would
 * be the worst outcome (rule #6 graceful-degrade — visible-not-silent).
 *
 * @otel-exempt pure formatter.
 */
export function sandboxModeWarning(env: NodeJS.ProcessEnv): string | null {
  const raw = env[SANDBOX_MODE_ENV];
  if (raw === undefined) return null;
  const normalised = raw.trim().toLowerCase();
  if (normalised === "") return null;
  if (VALID_MODES.has(normalised as SandboxMode)) return null;
  return `WARNING: ${SANDBOX_MODE_ENV}=${JSON.stringify(raw)} is not a recognised sandbox mode. Falling back to '${SANDBOX_MODE_DEFAULT}'. Valid modes: 'off' | 'warn-only' | 'enforce'. (vision.md rule #13.3)`;
}

/**
 * Format the single-line startup banner the supervisor's I/O boundary
 * (`bin/tick-loop.mjs`) writes at boot. Slice 2 of
 * `supervisor-sandbox-syscall-restriction`: surface the resolved mode in
 * the supervisor log so an operator running `tail .minsky/tick-loop.out.log`
 * sees the active mode + any typo warning in the first lines, instead of
 * silently running 'off' against a stale `MINSKY_SANDBOX=enforcde` typo.
 *
 * Visible-not-silent (rule #6) without operational risk: the resolver
 * still defaults to `'off'`, so the actual sandbox profile call site
 * (slice 3+) is unaffected — only the boot-time visibility increases.
 *
 * The `(substrate-inert)` parenthetical pins the slice's contract: until
 * a later slice wires the profile, no mode actually sandboxes anything.
 * An operator who flips the env to `enforce` today still gets the
 * pre-sandbox supervisor — the banner is honest about that, instead of
 * promising enforcement that doesn't exist yet.
 *
 * @otel-exempt pure formatter — caller decides whether to write to stderr.
 */
export function sandboxModeStartupHint(env: NodeJS.ProcessEnv): string {
  const mode = resolveSandboxMode(env);
  const warning = sandboxModeWarning(env);
  const base = `[tick-loop] sandbox mode: ${mode} (${SANDBOX_MODE_ENV} env, substrate-inert until profile wires in slice 3+)`;
  return warning === null ? base : `${base}\n${warning}`;
}

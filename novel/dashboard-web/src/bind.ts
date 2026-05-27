// no-test: novel/dashboard-web is deprecated (docs/DEPRECATED.md §4) — "keep for now, do NOT add features"; existing files lack tests by policy
/**
 * Dashboard bind-hostname resolution. Vision rule #13.4 ("Dashboard binds to
 * 127.0.0.1 by default — never 0.0.0.0 without explicit operator opt-in")
 * + TASKS.md `dashboard-localhost-only-by-default` P0. Industry-standard
 * primitive: NIST SP 800-53 SC-7 boundary protection (rule #1 — don't reinvent).
 *
 * Pure resolver so the policy is unit-testable without spawning a server —
 * `start.ts` is the I/O boundary that calls `serve({ hostname })`.
 *
 * The default is `127.0.0.1` (loopback only). The override env
 * `MINSKY_DASHBOARD_BIND` is the explicit opt-in for LAN exposure; when set,
 * `resolveBindHostname` returns the override AND `bindHostnameWarning`
 * surfaces a warning string the caller writes to stderr so the operator
 * sees the security cost in writing (rule #13 carve-out: silent
 * trade-offs are forbidden).
 */

export const BIND_DEFAULT = "127.0.0.1";
export const BIND_OVERRIDE_ENV = "MINSKY_DASHBOARD_BIND";

/**
 * @otel-exempt pure config resolver — no I/O; the `serve()` call site in
 * `start.ts` is the I/O boundary that records the bind decision.
 */
export function resolveBindHostname(env: NodeJS.ProcessEnv): string {
  const override = env[BIND_OVERRIDE_ENV];
  if (override === undefined || override === "") return BIND_DEFAULT;
  return override;
}

/**
 * @otel-exempt pure string formatter — no I/O; caller decides whether to
 * write the result to stderr.
 */
export function bindHostnameWarning(hostname: string): string | null {
  if (hostname === BIND_DEFAULT || hostname === "localhost") return null;
  return `WARNING: dashboard-web bound to ${hostname} (not loopback). It is now reachable from any device that can route to this host. Consider an SSH tunnel ('ssh -L <port>:localhost:<port>') or a reverse proxy with auth instead. (vision.md rule #13.4)`;
}

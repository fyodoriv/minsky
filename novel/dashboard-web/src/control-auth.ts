// no-test: novel/dashboard-web is deprecated (docs/DEPRECATED.md §4) — "keep for now, do NOT add features"; existing files lack tests by policy
/**
 * Dashboard `POST /control` endpoint authentication. Vision rule #13.4
 * ("Dashboard binds to 127.0.0.1 by default — LAN-exposed `/control` must
 * still gate on a per-run secret") + TASKS.md `dashboard-localhost-only-by-default`
 * P0. Industry-standard primitive: NIST SP 800-63B "Memorized Secret"
 * comparison, OWASP ASVS 2.10 (use constant-time compare for secrets).
 *
 * Pure functions: env / random reading happen at the I/O boundary (`start.ts`
 * + caller-supplied `generateRandom`). The server-side validator is
 * dependency-free so it can run in-process per request without I/O cost.
 *
 * The default is fail-closed: `MINSKY_CONTROL_TOKEN` env unset → a fresh
 * random token is generated per server-construction; the operator has to
 * read it from stderr and supply it as `X-Minsky-Token: <token>` on every
 * `POST /control` request. Setting the env pins the value across restarts.
 *
 * Slice 1 of the `/control` token sub-track ships these three pure helpers
 * (resolver, validator, startup hint) only — no `server.ts` / `start.ts`
 * wire-in. Slice 2 wires the validator into the route, slice 3 prints the
 * startup hint to stderr at server start.
 */

export const CONTROL_TOKEN_ENV = "MINSKY_CONTROL_TOKEN";
export const CONTROL_TOKEN_HEADER = "x-minsky-token";

export type ControlTokenSource = "env" | "generated";

export interface ResolvedControlToken {
  readonly token: string;
  readonly source: ControlTokenSource;
}

/**
 * Resolve the `/control` token from env, falling back to the caller-supplied
 * generator if env is unset / empty. Empty-string env is treated as unset
 * (mirrors `resolveBindHostname` so operator-side env discipline is
 * uniform: blank value = "I forgot to set this").
 *
 * @otel-exempt pure config resolver — no I/O of its own; the generator
 *   passed in is the I/O seam (production: `crypto.randomBytes(32).toString("hex")`).
 */
export function resolveControlToken(
  env: NodeJS.ProcessEnv,
  generateRandom: () => string,
): ResolvedControlToken {
  const fromEnv = env[CONTROL_TOKEN_ENV];
  if (fromEnv !== undefined && fromEnv !== "") {
    return { token: fromEnv, source: "env" };
  }
  return { token: generateRandom(), source: "generated" };
}

export type ValidateControlAuthResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "missing-header" | "wrong-token" };

/**
 * Header-shaped reader the validator consumes. Both `Headers` (Web standard,
 * what Hono's `c.req.raw.headers` exposes) and a plain `{get(name): string|null}`
 * stub satisfy this — header lookup is case-insensitive per RFC 7230 §3.2.
 */
export interface HeaderReader {
  get(name: string): string | null;
}

/**
 * Validate that the request bears a matching `X-Minsky-Token` header.
 * Constant-time byte-equality compare — same-length first (timing-safe gate
 * on length), then byte-XOR accumulation so no early return leaks how
 * many bytes matched. Production tokens are 64 hex chars (32 bytes from
 * `crypto.randomBytes`); the timing surface is small but the cost of the
 * constant-time compare is also small (≤64 iterations) so we pay it.
 *
 * @otel-exempt pure validator — no I/O; route handler in `server.ts` carries
 *   the `dashboard-web.control` span.
 */
export function validateControlAuth(
  headers: HeaderReader,
  expectedToken: string,
): ValidateControlAuthResult {
  const provided = headers.get(CONTROL_TOKEN_HEADER);
  if (provided === null || provided === "") {
    return { ok: false, reason: "missing-header" };
  }
  if (provided.length !== expectedToken.length) {
    return { ok: false, reason: "wrong-token" };
  }
  let diff = 0;
  for (let i = 0; i < provided.length; i++) {
    diff |= provided.charCodeAt(i) ^ expectedToken.charCodeAt(i);
  }
  if (diff !== 0) {
    return { ok: false, reason: "wrong-token" };
  }
  return { ok: true };
}

/**
 * Format the startup hint the server writes to stderr after resolving the
 * token. The hint surfaces *which* source the token came from and, when
 * generated, includes the token verbatim so the operator can copy-paste it
 * into the `X-Minsky-Token` header. When the source is env, the token is
 * NOT echoed back — the operator already has it, and stderr might be
 * captured into a log.
 *
 * @otel-exempt pure string formatter — caller decides whether to write to
 *   stderr.
 */
export function controlTokenStartupHint(resolved: ResolvedControlToken): string {
  if (resolved.source === "env") {
    return `dashboard-web /control: token from $${CONTROL_TOKEN_ENV} (length ${resolved.token.length}). Send 'X-Minsky-Token: <token>' on POST /control.`;
  }
  return `dashboard-web /control: random per-run token generated. Send 'X-Minsky-Token: ${resolved.token}' on POST /control. Set $${CONTROL_TOKEN_ENV} to pin a stable value across restarts.`;
}

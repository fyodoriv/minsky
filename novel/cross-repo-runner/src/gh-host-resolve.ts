// Resolve the `GH_HOST` value the daemon should use for every `gh` call.
//
// Without this, the daemon inherits whatever host happens to be the active
// account in the operator's global `gh auth status` — which on Example
// machines is `github.example.com`. That produces the 401 / "Could not
// resolve to a Repository" cascade for any task whose host repo lives on
// `github.com` (e.g. fyodoriv/minsky itself).
//
// Resolution order:
//   1. Explicit `GH_HOST` env var (operator escape hatch).
//   2. Hostname parsed from the host repo's `git remote get-url origin`.
//   3. `null` ⇒ fall through to `gh`'s own default (graceful-degrade per
//      rule #7; never crash the iteration on a probe failure).
//
// Pattern: pure function over an injected probe (rule #2 — every
//   dependency behind an interface). Source: vision.md rule #17
//   (proactive healing — the daemon's gh-host probe IS the fix for the
//   401 flood); rule #6 (stay alive); rule #7 (graceful-degrade);
//   operator directive 2026-05-19.
// Conformance: full — pure decision function, no I/O.

/**
 * Inputs to the resolver. Both fields come from the daemon's call site
 * (`process.env.GH_HOST` and `git remote get-url origin`); the function
 * itself is a pure mapping.
 */
export interface ResolveGhHostInput {
  /** `process.env.GH_HOST` (operator override). `""` and `undefined` are equivalent. */
  readonly envGhHost: string | undefined;
  /** Output of `git -C <hostRoot> remote get-url origin`, or `undefined`. */
  readonly gitRemoteUrl: string | undefined;
}

/**
 * Three sources, in priority order. `"fallback"` means the caller must
 * let `gh` use its own default (we do not invent one).
 */
export type GhHostSource = "env" | "git-remote" | "fallback";

export interface ResolveGhHostResult {
  /** `null` ⇒ caller should not set `GH_HOST`; let gh use its default. */
  readonly host: string | null;
  readonly source: GhHostSource;
}

export function resolveGhHost(input: ResolveGhHostInput): ResolveGhHostResult {
  const envHost = input.envGhHost;
  if (typeof envHost === "string" && envHost.length > 0) {
    return { host: envHost, source: "env" };
  }
  const fromRemote = parseHostnameFromRemote(input.gitRemoteUrl);
  if (fromRemote !== null) return { host: fromRemote, source: "git-remote" };
  return { host: null, source: "fallback" };
}

/**
 * Parse the hostname out of a git remote URL. Handles three shapes:
 *   - https://host[:port]/owner/repo[.git]
 *   - git://host[:port]/owner/repo[.git]
 *   - git@host:owner/repo[.git]  (scp-style SSH)
 *
 * Returns `null` when the URL is malformed or doesn't contain a host.
 */
function parseHostnameFromRemote(url: string | undefined): string | null {
  if (url === undefined || url.length === 0) return null;
  const trimmed = url.trim();
  const fromScheme = parseSchemeUrl(trimmed);
  if (fromScheme !== null) return fromScheme;
  return parseScpStyleSsh(trimmed);
}

function parseSchemeUrl(url: string): string | null {
  if (!/^(https?|git):\/\//.test(url)) return null;
  try {
    const u = new URL(url);
    if (u.hostname.length === 0) return null;
    return u.hostname;
  } catch {
    return null;
  }
}

function parseScpStyleSsh(url: string): string | null {
  // `[user@]host:path` — the `:` separates host from path; no scheme.
  if (url.includes("://")) return null;
  const at = url.indexOf("@");
  const colon = url.indexOf(":");
  if (colon === -1) return null;
  const hostStart = at === -1 ? 0 : at + 1;
  if (colon <= hostStart) return null;
  const host = url.slice(hostStart, colon);
  if (host.length === 0 || host.includes("/")) return null;
  return host;
}

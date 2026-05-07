#!/usr/bin/env node
// @ts-check
// Pattern: deterministic gate over `novel/dashboard-web/src/{bind,start}.ts`
// substrate cohesion — pins the loopback-by-default bind contract that
// `resolveBindHostname` + `bindHostnameWarning` operationalise. The pure
// resolver in `bind.ts` (default `127.0.0.1`, override via
// `MINSKY_DASHBOARD_BIND`) is the substrate; `start.ts` is the I/O boundary
// that calls `serve({ hostname })` with the resolved value. This lint pins
// both sides so a future rewrite that hardcodes `0.0.0.0` or omits the
// `hostname` field from `serve(...)` trips the gate deterministically
// rather than silently re-exposing the dashboard to LAN.
// Source: vision.md rule #13 minimum-bar item #4 ("Dashboard binds to
//   127.0.0.1 by default — never 0.0.0.0 without explicit operator
//   opt-in"); TASKS.md `dashboard-localhost-only-by-default` P0; rule #10
//   (deterministic enforcement — substrate-cohesion is a CI lint, not a
//   hope); NIST SP 800-53 SC-7 boundary protection (rule #1 — don't
//   reinvent — adopt the standard primitive).
//   Conformance: full — pure function over the file texts; the only I/O is
//   reading the two source files in `main()`.
//
// Why this gate exists: PR #283 shipped the doc (`docs/security/dashboard-exposure.md`)
// and `bind.ts` shipped earlier as the substrate. `start.ts` already calls
// `resolveBindHostname(process.env)` and threads the result through
// `serve({ fetch, hostname, port })`. Without a deterministic pin, a future
// edit could remove the import (resurrecting the default-host of `0.0.0.0`
// that `@hono/node-server` falls back to when `hostname` is omitted), or
// hardcode a literal hostname in the call site, or change `BIND_DEFAULT`
// from `127.0.0.1` to a non-loopback address — each silent regression that
// re-exposes the dashboard. This lint pins the load-bearing tokens; prose
// phrasing, comments, and ordering are left free.
//
// Pivot (rule #9): if the resolver grows to support multiple binds (e.g.,
// IPv6 `::1` alongside IPv4 `127.0.0.1`), expand `BIND_DEFAULT` to a Set of
// loopback literals rather than retire — the requirement is "loopback by
// default", not specifically `127.0.0.1`.

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

export const BIND_TS_PATH = "novel/dashboard-web/src/bind.ts";
export const START_TS_PATH = "novel/dashboard-web/src/start.ts";

/**
 * The literal loopback default that `BIND_DEFAULT` must resolve to. Pinned
 * here rather than imported from `bind.ts` so the lint runs as a pure
 * `.mjs` over file text — no TS compile, no module graph load. If this
 * value diverges from `bind.ts`, the lint fires.
 */
export const REQUIRED_BIND_DEFAULT = "127.0.0.1";

const BIND_DEFAULT_RE = /\bexport\s+const\s+BIND_DEFAULT\s*=\s*"([^"]+)"/;
const RESOLVE_EXPORT_RE = /\bexport\s+function\s+resolveBindHostname\b/;
const WARNING_EXPORT_RE = /\bexport\s+function\s+bindHostnameWarning\b/;

const RESOLVE_IMPORT_RE =
  /\bimport\s*\{[^}]*\bresolveBindHostname\b[^}]*\}\s*from\s*["']\.\/bind\.js["']/;
const RESOLVE_CALL_RE = /\bresolveBindHostname\s*\(\s*process\.env\s*\)/;
const SERVE_HOSTNAME_RE = /\bserve\s*\(\s*\{[^}]*\bhostname\b[^}]*\}/;

/**
 * @typedef {{ ok: true } | { ok: false, errors: string[] }} CheckResult
 */

/**
 * Pure check over the two source files' text. Asserts the substrate /
 * boundary cohesion that `dashboard-localhost-only-by-default` rests on.
 *
 * Substrate (`bind.ts`):
 *   1. exports `BIND_DEFAULT` literally equal to "127.0.0.1"
 *   2. exports `resolveBindHostname` (the pure resolver)
 *   3. exports `bindHostnameWarning` (the operator-visible warning)
 *
 * Boundary (`start.ts`):
 *   4. imports `resolveBindHostname` from `./bind.js`
 *   5. calls `resolveBindHostname(process.env)` to compute the hostname
 *   6. passes a `hostname` field to `serve({ ... })`
 *
 * Pure function — no I/O. The caller in `main()` reads the files.
 *
 * @param {{ bindTs: string, startTs: string }} sources
 * @returns {CheckResult}
 */
export function checkDashboardLocalhostBind(sources) {
  /** @type {string[]} */
  const errors = [];

  const defaultMatch = sources.bindTs.match(BIND_DEFAULT_RE);
  if (defaultMatch === null) {
    errors.push(
      `${BIND_TS_PATH}: missing \`export const BIND_DEFAULT = "<literal>"\` declaration.`,
    );
  } else if (defaultMatch[1] !== REQUIRED_BIND_DEFAULT) {
    errors.push(
      `${BIND_TS_PATH}: BIND_DEFAULT is "${defaultMatch[1]}", required "${REQUIRED_BIND_DEFAULT}" (loopback IPv4 — vision.md rule #13.4).`,
    );
  }

  if (!RESOLVE_EXPORT_RE.test(sources.bindTs)) {
    errors.push(`${BIND_TS_PATH}: missing \`export function resolveBindHostname\`.`);
  }

  if (!WARNING_EXPORT_RE.test(sources.bindTs)) {
    errors.push(`${BIND_TS_PATH}: missing \`export function bindHostnameWarning\`.`);
  }

  if (!RESOLVE_IMPORT_RE.test(sources.startTs)) {
    errors.push(
      `${START_TS_PATH}: missing \`import { resolveBindHostname } from "./bind.js"\` — start.ts must consume the substrate, not bypass it.`,
    );
  }

  if (!RESOLVE_CALL_RE.test(sources.startTs)) {
    errors.push(
      `${START_TS_PATH}: missing call \`resolveBindHostname(process.env)\` — the resolved hostname must come from the substrate, not a hardcoded literal.`,
    );
  }

  if (!SERVE_HOSTNAME_RE.test(sources.startTs)) {
    errors.push(
      `${START_TS_PATH}: \`serve({ ... })\` call does not include a \`hostname\` field; @hono/node-server falls back to 0.0.0.0 (LAN-exposed) when hostname is omitted.`,
    );
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

/**
 * @returns {Promise<number>}
 */
async function main() {
  const bindTs = await readFile(resolve(REPO_ROOT, BIND_TS_PATH), "utf8");
  const startTs = await readFile(resolve(REPO_ROOT, START_TS_PATH), "utf8");
  const result = checkDashboardLocalhostBind({ bindTs, startTs });
  if (result.ok) {
    process.stdout.write(
      "dashboard-localhost-bind ok: bind.ts substrate + start.ts boundary cohere (loopback-by-default contract intact).\n",
    );
    return 0;
  }
  process.stderr.write("dashboard-localhost-bind violation:\n");
  for (const err of result.errors) process.stderr.write(`  - ${err}\n`);
  process.stderr.write(
    [
      "",
      "Per vision.md rule #13 minimum-bar item #4 ('Dashboard binds to 127.0.0.1 by",
      "default — never 0.0.0.0 without explicit operator opt-in'), the dashboard's",
      "bind hostname must come from `resolveBindHostname` in `bind.ts`, and `serve()`",
      "must receive it via the `hostname` field. Re-add the substrate call rather",
      "than hardcoding a literal — the override env `MINSKY_DASHBOARD_BIND` is the",
      "documented operator opt-in for LAN exposure (with a stderr warning).",
      "",
    ].join("\n"),
  );
  return 1;
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("check-dashboard-localhost-bind.mjs");
if (invokedDirectly) {
  const code = await main();
  process.exit(code);
}

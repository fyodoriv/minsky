#!/usr/bin/env node
// @ts-check
// <!-- scope: human-approved long-term guard: pnpm-lock.yaml must resolve only from public registries (added 2026-06-01 after an internal package-mirror leak; keeps the public repo free of corporate registry hosts) -->
//
// check-lockfile-registry — pnpm-lock.yaml must resolve every package from a
// PUBLIC, allowlisted registry.
//
// Why this exists: a lockfile generated behind a corporate package mirror (an
// internal registry proxy) bakes the internal registry host into every
// `tarball:` URL. That:
//   1. LEAKS the corporate registry hostname into this public repo, and
//   2. BREAKS `pnpm install` for anyone outside the corporate network (the
//      internal host does not resolve).
// On 2026-06-01 `pnpm-lock.yaml` carried 127 such URLs pointing at an internal
// package mirror instead of the public registry. The existing
// `check-no-corporate-refs` guard scanned the file but its taxonomy had no
// registry-mirror token, so it slipped through. This guard closes that class
// with a POSITIVE allowlist: any resolution host that is not a known public
// registry fails — robust against any internal mirror, not just one vendor's
// tokens.
//
// Deterministic, no network (rule #10). Paired test:
// `scripts/check-lockfile-registry.test.mjs` (live-lockfile scan case runs in
// CI on every PR). Also runnable standalone:
//   node scripts/check-lockfile-registry.mjs
//
// Note: a canonical pnpm lockfile resolved against the default public registry
// usually OMITS the `tarball:` field entirely (the URL is implied). Explicit
// public `tarball:` URLs are tolerated; only NON-public hosts fail.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const LOCKFILE = join(REPO_ROOT, "pnpm-lock.yaml");

// Hosts a public, lock-clean dependency graph may legitimately resolve from.
export const ALLOWED_REGISTRY_HOSTS = new Set([
  "registry.npmjs.org", // the canonical public npm registry
  "registry.yarnpkg.com", // yarn's public mirror of npm
  "codeload.github.com", // GitHub git/tarball dependencies
  "github.com", // GitHub git dependencies
]);

/**
 * Find every URL in the lockfile whose host is not an allowlisted public
 * registry. Scans all `https?://` URLs (pnpm only emits package-resolution
 * URLs in the lockfile, so this is precise).
 *
 * @param {string} lockContent
 * @returns {{ line: number, host: string, url: string }[]}
 */
export function findForeignRegistryHosts(lockContent) {
  /** @type {{ line: number, host: string, url: string }[]} */
  const hits = [];
  const lines = lockContent.split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (const { host, url } of urlsInLine(lines[i] ?? "")) {
      if (!ALLOWED_REGISTRY_HOSTS.has(host)) {
        hits.push({ line: i + 1, host, url });
      }
    }
  }
  return hits;
}

/**
 * Extract every http(s) URL on a line with its parsed host (unparseable URLs
 * are skipped). Split out of `findForeignRegistryHosts` to keep each function
 * simple.
 *
 * @param {string} line
 * @returns {{ host: string, url: string }[]}
 */
function urlsInLine(line) {
  /** @type {{ host: string, url: string }[]} */
  const out = [];
  for (const m of line.matchAll(/https?:\/\/[^\s,}'"]+/g)) {
    const raw = m[0];
    let host;
    try {
      host = new URL(raw).hostname;
    } catch {
      continue;
    }
    out.push({ host, url: raw.length > 160 ? `${raw.slice(0, 160)}…` : raw });
  }
  return out;
}

const isCli =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isCli) {
  if (!existsSync(LOCKFILE)) {
    process.stdout.write("check-lockfile-registry ok: no pnpm-lock.yaml to scan.\n");
    process.exit(0);
  }
  const hits = findForeignRegistryHosts(readFileSync(LOCKFILE, "utf-8"));
  if (hits.length > 0) {
    const hosts = [...new Set(hits.map((h) => h.host))].sort();
    process.stderr.write(
      `check-lockfile-registry: pnpm-lock.yaml resolves ${hits.length} URL(s) from ${hosts.length} non-public registry host(s): ${hosts.join(", ")}\n`,
    );
    for (const h of hits.slice(0, 20)) {
      process.stderr.write(`  pnpm-lock.yaml:${h.line}  [${h.host}]  ${h.url}\n`);
    }
    if (hits.length > 20) process.stderr.write(`  …and ${hits.length - 20} more.\n`);
    process.stderr.write(
      "\nFix: regenerate the lockfile against the public registry " +
        "(`npm_config_registry=https://registry.npmjs.org/ pnpm install --lockfile-only`) " +
        "or rewrite the internal-mirror host to `registry.npmjs.org`. " +
        "Never commit a lockfile generated behind a corporate package proxy.\n",
    );
    process.exit(1);
  }
  process.stdout.write(
    "check-lockfile-registry ok: pnpm-lock.yaml resolves only from public registries.\n",
  );
  process.exit(0);
}

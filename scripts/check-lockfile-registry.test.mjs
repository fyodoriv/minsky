// @ts-check
// Paired test + live gate for `check-lockfile-registry.mjs`.
//
// The "live lockfile scan" case IS the CI enforcement: it fails the `test` job
// the moment `pnpm-lock.yaml` resolves any package from a non-public registry
// (the 2026-06-01 Artifactory leak class). The fixture cases pin the
// allowlist and the URL-host extraction.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { ALLOWED_REGISTRY_HOSTS, findForeignRegistryHosts } from "./check-lockfile-registry.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const LOCKFILE = resolve(HERE, "..", "pnpm-lock.yaml");

describe("findForeignRegistryHosts", () => {
  it("flags an internal package-mirror URL (the leak class)", () => {
    const sample =
      "    resolution: {integrity: sha512-abc==, tarball: https://npm.internal.example:443/repository/npm-proxy/@biomejs/cli-darwin-arm64/-/cli-darwin-arm64-2.4.16.tgz}";
    const hits = findForeignRegistryHosts(sample);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.host).toBe("npm.internal.example");
  });

  it("flags any non-allowlisted host generically (not just one vendor)", () => {
    const sample = "    tarball: https://nexus.internal.corp/repository/npm/foo/-/foo-1.0.0.tgz";
    const hits = findForeignRegistryHosts(sample);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.host).toBe("nexus.internal.corp");
  });

  it("accepts the public npm registry", () => {
    const sample =
      "    resolution: {integrity: sha512-abc==, tarball: https://registry.npmjs.org/@biomejs/biome/-/biome-2.4.16.tgz}";
    expect(findForeignRegistryHosts(sample)).toEqual([]);
  });

  it("accepts allowlisted GitHub git/tarball hosts", () => {
    const sample =
      "    resolution: {tarball: https://codeload.github.com/owner/repo/tar.gz/abc123}";
    expect(findForeignRegistryHosts(sample)).toEqual([]);
  });

  it("ignores integrity-only lines with no URL", () => {
    expect(findForeignRegistryHosts("    resolution: {integrity: sha512-xyz==}")).toEqual([]);
  });

  it("ALLOWED_REGISTRY_HOSTS contains the canonical public registry", () => {
    expect(ALLOWED_REGISTRY_HOSTS.has("registry.npmjs.org")).toBe(true);
  });
});

describe("live lockfile scan", () => {
  it("LIVE GATE: pnpm-lock.yaml resolves only from public registries", () => {
    if (!existsSync(LOCKFILE)) return; // nothing to scan
    const hits = findForeignRegistryHosts(readFileSync(LOCKFILE, "utf-8"));
    if (hits.length > 0) {
      const hosts = [...new Set(hits.map((h) => h.host))].sort();
      throw new Error(
        [
          `pnpm-lock.yaml resolves from ${hosts.length} non-public registry host(s): ${hosts.join(", ")}`,
          ...hits.slice(0, 10).map((h) => `  line ${h.line} [${h.host}] ${h.url}`),
        ].join("\n"),
      );
    }
    expect(hits).toEqual([]);
  });
});

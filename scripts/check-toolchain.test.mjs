import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assessToolchain,
  biomePlatformPkgCandidates,
  gatherToolchainFacts,
  parseNodeMajorMinor,
} from "./check-toolchain.mjs";

/** A healthy baseline; spread + override per case. */
const HEALTHY = Object.freeze({
  runningNodeVersion: "v24.14.0",
  pinnedNodeVersion: "24.14.0",
  platform: "darwin",
  arch: "arm64",
  biomePlatformPkgPresent: true,
  lefthookResolvable: true,
});

describe("parseNodeMajorMinor", () => {
  it("parses a leading-v full version", () => {
    expect(parseNodeMajorMinor("v24.14.0")).toEqual({ major: 24, minor: 14 });
  });
  it("parses a bare major.minor and a bare major", () => {
    expect(parseNodeMajorMinor("24.14")).toEqual({ major: 24, minor: 14 });
    expect(parseNodeMajorMinor("24")).toEqual({ major: 24, minor: 0 });
  });
  it("returns null for unparseable input", () => {
    expect(parseNodeMajorMinor("lts/iron")).toBeNull();
    expect(parseNodeMajorMinor("")).toBeNull();
    expect(parseNodeMajorMinor(null)).toBeNull();
    expect(parseNodeMajorMinor(undefined)).toBeNull();
  });
});

describe("biomePlatformPkgCandidates", () => {
  it("returns a single darwin candidate", () => {
    expect(biomePlatformPkgCandidates("darwin", "arm64")).toEqual(["@biomejs/cli-darwin-arm64"]);
  });
  it("returns glibc + musl candidates on linux", () => {
    expect(biomePlatformPkgCandidates("linux", "x64")).toEqual([
      "@biomejs/cli-linux-x64",
      "@biomejs/cli-linux-x64-musl",
    ]);
  });
});

describe("assessToolchain", () => {
  it("is ok when everything matches", () => {
    const r = assessToolchain({ ...HEALTHY });
    expect(r.ok).toBe(true);
    expect(r.problems).toEqual([]);
  });

  it("tolerates a patch-only node drift (major.minor equal)", () => {
    const r = assessToolchain({
      ...HEALTHY,
      runningNodeVersion: "v24.14.7",
      pinnedNodeVersion: "24.14.0",
    });
    expect(r.ok).toBe(true);
  });

  it("flags a node minor drift with an actionable fnm message", () => {
    const r = assessToolchain({
      ...HEALTHY,
      runningNodeVersion: "v24.15.0",
      pinnedNodeVersion: "24.14.0",
    });
    expect(r.ok).toBe(false);
    expect(r.problems.join("\n")).toMatch(/node v24\.15\.0 ≠ pinned v24\.14\.0/);
    expect(r.problems.join("\n")).toMatch(/fnm use/);
    expect(r.problems.join("\n")).toMatch(/MODULE_NOT_FOUND/);
  });

  it("flags a node major drift", () => {
    const r = assessToolchain({
      ...HEALTHY,
      runningNodeVersion: "v22.14.0",
      pinnedNodeVersion: "24.14.0",
    });
    expect(r.ok).toBe(false);
  });

  it("flags a missing host-arch biome platform package", () => {
    const r = assessToolchain({ ...HEALTHY, biomePlatformPkgPresent: false });
    expect(r.ok).toBe(false);
    expect(r.problems.join("\n")).toMatch(/@biomejs\/cli-darwin-arm64 is not installed/);
    expect(r.problems.join("\n")).toMatch(/MODULE_NOT_FOUND/);
    expect(r.problems.join("\n")).toMatch(/BIOME_BINARY/);
  });

  it("flags an unresolvable lefthook", () => {
    const r = assessToolchain({ ...HEALTHY, lefthookResolvable: false });
    expect(r.ok).toBe(false);
    expect(r.problems.join("\n")).toMatch(/lefthook is not resolvable/);
  });

  it("reports every independent problem at once", () => {
    const r = assessToolchain({
      runningNodeVersion: "v24.15.0",
      pinnedNodeVersion: "24.14.0",
      platform: "darwin",
      arch: "arm64",
      biomePlatformPkgPresent: false,
      lefthookResolvable: false,
    });
    expect(r.ok).toBe(false);
    expect(r.problems.length).toBe(3);
  });

  it("skips the node-version check when no pin file is present", () => {
    const r = assessToolchain({
      ...HEALTHY,
      runningNodeVersion: "v18.0.0",
      pinnedNodeVersion: null,
    });
    expect(r.ok).toBe(true);
  });

  it("reports a malformed pin file as a problem, never throws", () => {
    const r = assessToolchain({ ...HEALTHY, pinnedNodeVersion: "lts/iron" });
    expect(r.ok).toBe(false);
    expect(r.problems.join("\n")).toMatch(/not a parseable node version/);
  });
});

describe("real toolchain — slice-1 invariant on this branch", () => {
  const root = resolve(import.meta.dirname, "..");

  it("ships a parseable .node-version pin", () => {
    const pinPath = resolve(root, ".node-version");
    expect(existsSync(pinPath)).toBe(true);
    const pin = readFileSync(pinPath, "utf8").trim();
    expect(parseNodeMajorMinor(pin)).not.toBeNull();
  });

  it("the running CI/dev node matches the pin (no minor drift)", () => {
    const facts = gatherToolchainFacts(root);
    // Only assert the node-version verdict here; biome/lefthook presence is
    // covered by the dedicated unit cases and depends on `pnpm install`
    // having run, which is not guaranteed in every test sandbox.
    const r = assessToolchain({
      ...facts,
      biomePlatformPkgPresent: true,
      lefthookResolvable: true,
    });
    expect(r.problems, r.problems.join(" | ")).toEqual([]);
  });
});

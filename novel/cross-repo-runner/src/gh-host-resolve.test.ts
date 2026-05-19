// Tests for `resolveGhHost` (pure helper). When the daemon runs against
// a host whose remote is `github.com`, gh defaults to the operator's
// other authenticated host (`github.example.com`) which produces:
//
//     HTTP 401: Must authenticate to access this API. (https://github.example.com/api/graphql)
//     GraphQL: Could not resolve to a Repository with the name 'fyodoriv/minsky'.
//
// Repeated per-iteration ≥6×. Per rule #17 (proactive healing) the daemon
// must self-correct: read the host's `git remote get-url origin`, parse
// the hostname, and set `GH_HOST` to that hostname for every gh call
// the iteration makes — never assume one corporate host.
//
// Source: rule #17 (vision.md § proactive healing); rule #2 (every
// dependency behind an interface — git remote is just another I/O
// dep); rule #6 (graceful-degrade — fall back to gh's own default
// when the probe fails, never crash); operator directive 2026-05-19.
// Conformance: full — pure function over an injected probe, no I/O.

import { describe, expect, test } from "vitest";

import { resolveGhHost } from "./gh-host-resolve.js";

describe("resolveGhHost — pure", () => {
  test("explicit GH_HOST env wins over everything", () => {
    expect(
      resolveGhHost({
        envGhHost: "github.example.com",
        gitRemoteUrl: "https://github.com/fyodoriv/minsky.git",
      }),
    ).toEqual({ host: "github.example.com", source: "env" });
  });

  test("https github.com remote → github.com", () => {
    expect(
      resolveGhHost({
        envGhHost: undefined,
        gitRemoteUrl: "https://github.com/fyodoriv/minsky.git",
      }),
    ).toEqual({ host: "github.com", source: "git-remote" });
  });

  test("ssh github.com remote → github.com", () => {
    expect(
      resolveGhHost({
        envGhHost: undefined,
        gitRemoteUrl: "git@github.com:fyodoriv/minsky.git",
      }),
    ).toEqual({ host: "github.com", source: "git-remote" });
  });

  test("https github.example.com remote → github.example.com", () => {
    expect(
      resolveGhHost({
        envGhHost: undefined,
        gitRemoteUrl: "https://github.example.com/team/repo.git",
      }),
    ).toEqual({ host: "github.example.com", source: "git-remote" });
  });

  test("ssh github.example.com remote → github.example.com", () => {
    expect(
      resolveGhHost({
        envGhHost: undefined,
        gitRemoteUrl: "git@github.example.com:team/repo.git",
      }),
    ).toEqual({ host: "github.example.com", source: "git-remote" });
  });

  test("git:// scheme is parsed", () => {
    expect(
      resolveGhHost({
        envGhHost: undefined,
        gitRemoteUrl: "git://github.com/fyodoriv/minsky.git",
      }),
    ).toEqual({ host: "github.com", source: "git-remote" });
  });

  test("https with port → host only (no port)", () => {
    expect(
      resolveGhHost({
        envGhHost: undefined,
        gitRemoteUrl: "https://github.example.com:8443/team/repo.git",
      }),
    ).toEqual({ host: "github.example.com", source: "git-remote" });
  });

  test("env=empty-string is treated as unset (matches gh's own behaviour)", () => {
    expect(
      resolveGhHost({
        envGhHost: "",
        gitRemoteUrl: "https://github.com/fyodoriv/minsky.git",
      }),
    ).toEqual({ host: "github.com", source: "git-remote" });
  });

  test("malformed remote URL → null host + fallback source (gh uses its own default)", () => {
    expect(
      resolveGhHost({
        envGhHost: undefined,
        gitRemoteUrl: "not-a-url",
      }),
    ).toEqual({ host: null, source: "fallback" });
  });

  test("missing remote URL (e.g. fresh clone, no remote) → null host", () => {
    expect(
      resolveGhHost({
        envGhHost: undefined,
        gitRemoteUrl: undefined,
      }),
    ).toEqual({ host: null, source: "fallback" });
  });

  test("trailing /.git is stripped from path, hostname intact", () => {
    expect(
      resolveGhHost({
        envGhHost: undefined,
        gitRemoteUrl: "https://github.com/fyodoriv/minsky",
      }),
    ).toEqual({ host: "github.com", source: "git-remote" });
  });

  test("env GH_HOST 'github.com' is treated as explicit override", () => {
    expect(
      resolveGhHost({
        envGhHost: "github.com",
        gitRemoteUrl: "https://github.example.com/team/repo.git",
      }),
    ).toEqual({ host: "github.com", source: "env" });
  });
});

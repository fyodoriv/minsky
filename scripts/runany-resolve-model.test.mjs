// <!-- scope: human-approved runany-dynamic-model-or-local-fallback slice 3 — paired tests for the resolver CLI's pure parsers + the TCP probe seam. -->
// Tests for runany-resolve-model: the env/argv/backend parsers and the
// TCP probe (verified against a real unreachable port — deterministic,
// no external service). xUnit paired fixtures (Meszaros 2007).

import { describe, expect, it } from "vitest";

import { makeTcpProbe, parseArgs, parseBackends, resolvePin } from "./runany-resolve-model.mjs";

describe("parseBackends", () => {
  it("defaults to the single Anthropic backend when unset", () => {
    const out = parseBackends(undefined);
    expect(out).toEqual([{ id: "claude", host: "api.anthropic.com", port: 443 }]);
  });

  it("defaults when given an empty / whitespace value", () => {
    expect(parseBackends("   ")).toHaveLength(1);
  });

  it("parses multiple id=host:port entries", () => {
    const out = parseBackends("claude=api.anthropic.com:443,bedrock=bedrock.local:8443");
    expect(out).toEqual([
      { id: "claude", host: "api.anthropic.com", port: 443 },
      { id: "bedrock", host: "bedrock.local", port: 8443 },
    ]);
  });

  it("treats a bare id as the default Anthropic host", () => {
    expect(parseBackends("claude")).toEqual([
      { id: "claude", host: "api.anthropic.com", port: 443 },
    ]);
  });

  it("falls back to port 443 when the port is non-numeric", () => {
    expect(parseBackends("x=h:notaport")[0]?.port).toBe(443);
  });
});

describe("resolvePin", () => {
  it("returns undefined when neither env var is set", () => {
    expect(resolvePin({})).toBeUndefined();
  });

  it("reads MINSKY_STRATEGIC_PIN_MODEL", () => {
    expect(resolvePin({ MINSKY_STRATEGIC_PIN_MODEL: "claude-opus-4-7" })).toBe("claude-opus-4-7");
  });

  it("accepts the MINSKY_PIN_MODEL alias", () => {
    expect(resolvePin({ MINSKY_PIN_MODEL: "claude-sonnet-4-6" })).toBe("claude-sonnet-4-6");
  });

  it("prefers the canonical name over the alias", () => {
    expect(resolvePin({ MINSKY_STRATEGIC_PIN_MODEL: "canonical", MINSKY_PIN_MODEL: "alias" })).toBe(
      "canonical",
    );
  });

  it("ignores a whitespace-only pin", () => {
    expect(resolvePin({ MINSKY_STRATEGIC_PIN_MODEL: "   " })).toBeUndefined();
  });
});

describe("parseArgs", () => {
  it("defaults both flags off", () => {
    expect(parseArgs([])).toEqual({ json: false, force: false });
  });

  it("reads --json and --force-probe", () => {
    expect(parseArgs(["--json", "--force-probe"])).toEqual({ json: true, force: true });
  });
});

describe("makeTcpProbe", () => {
  it("reports an unreachable backend (closed port) as not reachable", async () => {
    // Port 1 on localhost is privileged + unbound — connect fails fast.
    const probe = makeTcpProbe([{ id: "claude", host: "127.0.0.1", port: 1 }]);
    const [result] = await probe(["claude"]);
    expect(result?.reachable).toBe(false);
    expect(typeof result?.reason).toBe("string");
  });

  it("marks an id with no matching spec as unconfigured", async () => {
    const probe = makeTcpProbe([{ id: "claude", host: "127.0.0.1", port: 1 }]);
    const [result] = await probe(["bedrock"]);
    expect(result).toEqual({ id: "bedrock", reachable: false, reason: "unconfigured" });
  });
});

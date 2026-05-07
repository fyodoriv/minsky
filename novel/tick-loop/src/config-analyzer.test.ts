import { describe, expect, it } from "vitest";
import { type ConfigContext, analyzeConfig, formatRecommendations } from "./config-analyzer.js";

const SELF: ConfigContext = {
  env: {},
  argv: [],
  isSelfDogfood: true,
  isLaunchd: false,
};

describe("analyzeConfig — self-dogfood with no env", () => {
  it("recommends enabling MINSKY_CTO_AUDIT_ENABLE", () => {
    const recs = analyzeConfig(SELF);
    const cto = recs.find((r) => r.setting === "MINSKY_CTO_AUDIT_ENABLE");
    expect(cto).toBeDefined();
    expect(cto?.kind).toBe("enable");
    expect(cto?.recommended).toBe("1");
    expect(cto?.estimatedTokenDelta).toBeGreaterThan(0);
  });

  it("recommends enabling MINSKY_CHANGELOG_ENABLE", () => {
    const recs = analyzeConfig(SELF);
    const cl = recs.find((r) => r.setting === "MINSKY_CHANGELOG_ENABLE");
    expect(cl).toBeDefined();
    expect(cl?.kind).toBe("enable");
    expect(cl?.recommended).toBe("1");
  });

  it("recommends configuring MINSKY_OTEL_ENDPOINT", () => {
    const recs = analyzeConfig(SELF);
    const otel = recs.find((r) => r.setting === "MINSKY_OTEL_ENDPOINT");
    expect(otel?.kind).toBe("tune");
    expect(otel?.recommended).toContain("localhost");
  });

  it("recommends configuring MINSKY_NTFY_TOPIC", () => {
    const recs = analyzeConfig(SELF);
    const ntfy = recs.find((r) => r.setting === "MINSKY_NTFY_TOPIC");
    expect(ntfy?.kind).toBe("enable");
  });
});

describe("analyzeConfig — env already configured", () => {
  it("does NOT recommend MINSKY_CTO_AUDIT_ENABLE when already set to 1", () => {
    const recs = analyzeConfig({ ...SELF, env: { MINSKY_CTO_AUDIT_ENABLE: "1" } });
    expect(recs.find((r) => r.setting === "MINSKY_CTO_AUDIT_ENABLE")).toBeUndefined();
  });

  it("treats MINSKY_CTO_AUDIT_ENABLE=true (case-insensitive) as enabled", () => {
    const recs = analyzeConfig({ ...SELF, env: { MINSKY_CTO_AUDIT_ENABLE: "TRUE" } });
    expect(recs.find((r) => r.setting === "MINSKY_CTO_AUDIT_ENABLE")).toBeUndefined();
  });

  it("still recommends when MINSKY_CTO_AUDIT_ENABLE=0 (explicit off)", () => {
    const recs = analyzeConfig({ ...SELF, env: { MINSKY_CTO_AUDIT_ENABLE: "0" } });
    expect(recs.find((r) => r.setting === "MINSKY_CTO_AUDIT_ENABLE")).toBeDefined();
  });

  it("does NOT recommend MINSKY_OTEL_ENDPOINT when already set", () => {
    const recs = analyzeConfig({ ...SELF, env: { MINSKY_OTEL_ENDPOINT: "http://elsewhere:5081" } });
    expect(recs.find((r) => r.setting === "MINSKY_OTEL_ENDPOINT")).toBeUndefined();
  });

  it("treats empty-string env values as unset (matches bind.ts semantics)", () => {
    const recs = analyzeConfig({ ...SELF, env: { MINSKY_OTEL_ENDPOINT: "" } });
    expect(recs.find((r) => r.setting === "MINSKY_OTEL_ENDPOINT")).toBeDefined();
  });
});

describe("analyzeConfig — non-self-dogfood (cross-repo)", () => {
  const CROSS: ConfigContext = { ...SELF, isSelfDogfood: false };

  it("does NOT recommend MINSKY_CTO_AUDIT_ENABLE for cross-repo", () => {
    const recs = analyzeConfig(CROSS);
    expect(recs.find((r) => r.setting === "MINSKY_CTO_AUDIT_ENABLE")).toBeUndefined();
  });

  it("does NOT recommend MINSKY_CHANGELOG_ENABLE for cross-repo", () => {
    const recs = analyzeConfig(CROSS);
    expect(recs.find((r) => r.setting === "MINSKY_CHANGELOG_ENABLE")).toBeUndefined();
  });

  it("does NOT recommend MINSKY_NTFY_TOPIC for cross-repo", () => {
    const recs = analyzeConfig(CROSS);
    expect(recs.find((r) => r.setting === "MINSKY_NTFY_TOPIC")).toBeUndefined();
  });

  it("STILL recommends OTEL — orthogonal to dogfood", () => {
    const recs = analyzeConfig(CROSS);
    expect(recs.find((r) => r.setting === "MINSKY_OTEL_ENDPOINT")).toBeDefined();
  });
});

describe("analyzeConfig — flag simplification", () => {
  it("recommends dropping --paused-sentinel when it matches the minsky CLI default", () => {
    const recs = analyzeConfig({
      ...SELF,
      argv: ["--paused-sentinel=/tmp/minsky-worker-0-never-paused"],
    });
    const ps = recs.find((r) => r.setting === "--paused-sentinel");
    expect(ps?.kind).toBe("simplify");
    expect(ps?.recommended).toContain("omit");
  });

  it("does NOT recommend dropping --paused-sentinel when it points elsewhere", () => {
    const recs = analyzeConfig({
      ...SELF,
      argv: ["--paused-sentinel=/some/other/path"],
    });
    expect(recs.find((r) => r.setting === "--paused-sentinel")).toBeUndefined();
  });
});

describe("formatRecommendations", () => {
  it("returns a single OK line when there are no recommendations", () => {
    const out = formatRecommendations([]);
    expect(out).toContain("OK");
    expect(out.split("\n")).toHaveLength(1);
  });

  it("renders one line per recommendation with the rationale and token delta", () => {
    const recs = analyzeConfig(SELF);
    const out = formatRecommendations(recs);
    const lines = out.split("\n");
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]).toContain(`${recs.length} recommendation(s)`);
    for (const r of recs) {
      const matched = lines.some((l) => l.includes(r.setting));
      expect(matched, `expected a line for ${r.setting}`).toBe(true);
    }
  });
});

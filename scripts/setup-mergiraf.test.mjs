import { describe, expect, it } from "vitest";
import { planMergirafSetup } from "./setup-mergiraf.mjs";

describe("planMergirafSetup", () => {
  it("returns binary-missing with install hint when mergiraf is not on PATH", () => {
    const plan = planMergirafSetup({ binaryPresent: false, configuredDriver: undefined });
    expect(plan.verdict).toBe("binary-missing");
    expect(plan.commands).toHaveLength(0);
    expect(plan.installHint).toMatch(/Install Mergiraf/);
    expect(plan.installHint).toMatch(/brew install mergiraf/);
    expect(plan.installHint).toMatch(/cargo install mergiraf/);
  });

  it("returns binary-missing even when a stale config exists — install must come first", () => {
    const plan = planMergirafSetup({
      binaryPresent: false,
      configuredDriver: "mergiraf merge ...",
    });
    expect(plan.verdict).toBe("binary-missing");
  });

  it("returns configured when binary is present AND git config matches the canonical driver", () => {
    const canonicalDriver = "mergiraf merge --git %O %A %B -p %P -s %S -x %X -y %Y";
    const plan = planMergirafSetup({ binaryPresent: true, configuredDriver: canonicalDriver });
    expect(plan.verdict).toBe("configured");
    expect(plan.commands).toHaveLength(0);
    expect(plan.installHint).toBeNull();
  });

  it("returns needs-config when binary is present but no driver is configured yet", () => {
    const plan = planMergirafSetup({ binaryPresent: true, configuredDriver: undefined });
    expect(plan.verdict).toBe("needs-config");
    expect(plan.commands.length).toBeGreaterThanOrEqual(2);
    expect(plan.commands.some((c) => c.includes("merge.mergiraf.driver"))).toBe(true);
  });

  it("returns needs-config when driver is configured but with stale/wrong command", () => {
    const plan = planMergirafSetup({
      binaryPresent: true,
      configuredDriver: "mergiraf merge --old-flag %A %B",
    });
    expect(plan.verdict).toBe("needs-config");
    expect(plan.commands.some((c) => c.includes("merge.mergiraf.driver"))).toBe(true);
  });

  it("commands set name + driver + recursive (3 keys minimum) so config is complete", () => {
    const plan = planMergirafSetup({ binaryPresent: true, configuredDriver: undefined });
    expect(plan.verdict).toBe("needs-config");
    expect(plan.commands.some((c) => c.includes("merge.mergiraf.name"))).toBe(true);
    expect(plan.commands.some((c) => c.includes("merge.mergiraf.driver"))).toBe(true);
    expect(plan.commands.some((c) => c.includes("merge.mergiraf.recursive"))).toBe(true);
  });

  it("driver command uses git's standard merge driver placeholders %O %A %B for three-way merge", () => {
    const plan = planMergirafSetup({ binaryPresent: true, configuredDriver: undefined });
    const driverCmd = plan.commands.find((c) => c.includes("merge.mergiraf.driver"));
    expect(driverCmd).toBeDefined();
    expect(driverCmd).toMatch(/%O/);
    expect(driverCmd).toMatch(/%A/);
    expect(driverCmd).toMatch(/%B/);
  });
});

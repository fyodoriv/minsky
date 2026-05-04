// Tests for the doctor diagnostic. xUnit paired fixtures (Meszaros 2007).

import { describe, expect, test } from "vitest";

import { type DoctorSignals, diagnose } from "./doctor.js";

const allGreenSignals: DoctorSignals = {
  repoYamlExists: true,
  repoYamlValid: true,
  visionMdIsSymlink: true,
  visionMdSymlinkResolves: true,
  experimentsDirExists: true,
  gitIgnoresMinskyDir: true,
};

describe("diagnose — happy path", () => {
  test("all signals true → green aggregate", () => {
    const report = diagnose(allGreenSignals);
    expect(report.status).toBe("green");
    expect(report.rows.every((r) => r.status === "green")).toBe(true);
  });
});

describe("diagnose — failure paths (red)", () => {
  test("missing repo.yaml → red", () => {
    const report = diagnose({ ...allGreenSignals, repoYamlExists: false });
    expect(report.status).toBe("red");
  });

  test("invalid repo.yaml → red (with the `validation failed` row visible)", () => {
    const report = diagnose({ ...allGreenSignals, repoYamlValid: false });
    expect(report.status).toBe("red");
    expect(report.rows.some((r) => r.message.includes("validation"))).toBe(true);
  });

  test("missing experiments dir → red", () => {
    const report = diagnose({ ...allGreenSignals, experimentsDirExists: false });
    expect(report.status).toBe("red");
  });

  test("vision.md not a symlink → red", () => {
    const report = diagnose({ ...allGreenSignals, visionMdIsSymlink: false });
    expect(report.status).toBe("red");
    expect(report.rows.some((r) => r.message.includes("not a symlink"))).toBe(true);
  });

  test("vision.md symlink broken → red", () => {
    const report = diagnose({
      ...allGreenSignals,
      visionMdIsSymlink: true,
      visionMdSymlinkResolves: false,
    });
    expect(report.status).toBe("red");
    expect(report.rows.some((r) => r.message.includes("broken"))).toBe(true);
  });
});

describe("diagnose — soft-fail paths (yellow)", () => {
  test("git does NOT ignore .minsky/ → yellow (sidecar may pollute history)", () => {
    const report = diagnose({ ...allGreenSignals, gitIgnoresMinskyDir: false });
    expect(report.status).toBe("yellow");
    expect(
      report.rows.some((r) => r.status === "yellow" && r.message.includes("does NOT ignore")),
    ).toBe(true);
  });
});

describe("diagnose — aggregation rules (Avizienis lattice)", () => {
  test("red dominates yellow", () => {
    const report = diagnose({
      ...allGreenSignals,
      repoYamlExists: false, // red
      gitIgnoresMinskyDir: false, // yellow
    });
    expect(report.status).toBe("red");
  });

  test("yellow dominates green", () => {
    const report = diagnose({
      ...allGreenSignals,
      gitIgnoresMinskyDir: false, // yellow
    });
    expect(report.status).toBe("yellow");
  });

  test("all green → green", () => {
    const report = diagnose(allGreenSignals);
    expect(report.status).toBe("green");
  });
});

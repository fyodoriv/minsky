import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  findMissingMergirafGlobs,
  REQUIRED_MERGIRAF_GLOBS,
} from "./check-gitattributes-mergiraf.mjs";

describe("findMissingMergirafGlobs", () => {
  it("returns empty array when every required glob is declared", () => {
    const text = REQUIRED_MERGIRAF_GLOBS.map((g) => `${g} merge=mergiraf`).join("\n");
    expect(findMissingMergirafGlobs(text)).toEqual([]);
  });

  it("returns the missing globs when some are absent", () => {
    const text = "*.ts merge=mergiraf\n*.md merge=mergiraf\n";
    const missing = findMissingMergirafGlobs(text);
    expect(missing).toContain("*.json");
    expect(missing).toContain("*.yaml");
    expect(missing).not.toContain("*.ts");
    expect(missing).not.toContain("*.md");
  });

  it("ignores comment lines starting with #", () => {
    const text = "# *.ts merge=mergiraf  (commented out)\n*.md merge=mergiraf\n";
    expect(findMissingMergirafGlobs(text)).toContain("*.ts");
  });

  it("ignores trailing comments after a valid declaration", () => {
    const text = "*.ts merge=mergiraf  # tracked\n";
    expect(findMissingMergirafGlobs(text)).not.toContain("*.ts");
  });

  it("returns all globs as missing for an empty file", () => {
    expect(findMissingMergirafGlobs("")).toEqual([...REQUIRED_MERGIRAF_GLOBS]);
  });

  it("returns all globs as missing when only the comment header is present", () => {
    const text =
      "# Mergiraf semantic merge driver — auto-resolves conflicts.\n# Activation:\n#   node scripts/setup-mergiraf.mjs\n";
    expect(findMissingMergirafGlobs(text)).toEqual([...REQUIRED_MERGIRAF_GLOBS]);
  });

  it("does not match other merge drivers", () => {
    const text = REQUIRED_MERGIRAF_GLOBS.map((g) => `${g} merge=union`).join("\n");
    expect(findMissingMergirafGlobs(text)).toEqual([...REQUIRED_MERGIRAF_GLOBS]);
  });

  it("matches even with multiple attributes per line", () => {
    const text = "*.ts merge=mergiraf diff=typescript\n";
    expect(findMissingMergirafGlobs(text)).not.toContain("*.ts");
  });
});

describe("real .gitattributes — slice-5 invariant on main", () => {
  it("declares merge=mergiraf for every required high-conflict glob", () => {
    const root = resolve(import.meta.dirname, "..");
    const text = readFileSync(resolve(root, ".gitattributes"), "utf8");
    const missing = findMissingMergirafGlobs(text);
    expect(missing, `missing globs: ${missing.join(", ")}`).toEqual([]);
  });
});

// @ts-check
// Claude-first start, as in agentbrew, dotfiles, and careerbrew: the README
// opens with one prompt that installs or updates Minsky through INSTALL.md
// and starts it. This test keeps the prompt and the playbook in step.
// Pattern: deterministic docs gate (vision.md rule #10).

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** @param {string} path */
const read = (path) => readFileSync(join(REPO_ROOT, path), "utf8");
const README = read("README.md");
const INSTALL = read("INSTALL.md");

/** @param {string} text @returns {Array<[string, string]>} */
const blocks = (text) =>
  [...text.matchAll(/^```(\w*)\n([\s\S]*?)^```/gm)].map((m) => [m[1] ?? "", m[2] ?? ""]);

const PROMPT_PARTS = [
  "blob/HEAD/INSTALL.md",
  "updates an existing clone",
  "only use Minsky or also contribute",
  "minsky daemon doctor",
  "fix every failing line",
  "propose adopt or merge",
  "start Minsky for the first time",
  "offer an issue or PR",
];

describe("README one-prompt setup", () => {
  test("the first block is a text prompt that names each part", () => {
    const [lang, prompt] = blocks(README)[0] ?? ["", ""];
    expect(lang).toBe("text");
    for (const part of PROMPT_PARTS) expect(prompt, part).toContain(part);
  });

  test("the bash line is one line, safe to rerun, and ends with the doctor", () => {
    const line = (blocks(README).find(([lang]) => lang === "bash")?.[1] ?? "").trim();
    expect(line).not.toContain("\n");
    expect(line.startsWith("[ -d ~/minsky ] || git clone ")).toBe(true);
    expect(line).toContain("git pull --ff-only");
    expect(line).toContain("pnpm install --frozen-lockfile");
    expect(line.endsWith("bin/minsky daemon doctor")).toBe(true);
  });
});

describe("INSTALL.md carries out each part of the prompt", () => {
  test("each part has its step", () => {
    for (const part of [
      "git pull --ff-only",
      "Use and contribute",
      "## Step 5.5 — contributor setup",
      "## Step 5.6 — check and fix with the doctor",
      "no `FAIL` line",
      "## Step 5.7 — audit what the machine already has",
      "**adopt**",
      "**merge**",
      "## Step 6 — start Minsky for the first time",
      "## Step 8 — offer improvements",
      "offer an issue or a PR",
    ]) {
      expect(INSTALL, part).toContain(part);
    }
    expect(INSTALL.indexOf("## Step 6 — start")).toBeLessThan(INSTALL.indexOf("## Step 8 — offer"));
  });

  test("every script and bin file both docs name exists", () => {
    const named = new Set(
      [
        ...(README + INSTALL).matchAll(
          /\b((?:scripts|bin)\/[\w.-]+\.(?:sh|mjs|py)|bin\/minsky)\b/g,
        ),
      ].map((m) => m[1] ?? ""),
    );
    for (const path of named) expect(existsSync(join(REPO_ROOT, path)), path).toBe(true);
  });
});

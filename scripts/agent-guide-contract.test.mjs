// @ts-check
// This file pins the docs contract from agentbrew's
// docs/agent-guide-baseline.md: a short, routed AGENTS.md that Claude Code
// loads through CLAUDE.md, a docs map with no orphan docs, and a README that
// opens with a quickstart and the map link.
// Pattern: deterministic docs gate (vision.md rule #10).

import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** @param {string} path */
const read = (path) => readFileSync(join(REPO_ROOT, path), "utf8");

const AGENT_GUIDE_BUDGET_BYTES = 10_000;
const CONTRACT_HEADINGS = [
  "## Start here",
  "## Commands",
  "## Where to change what",
  "## Rules",
  "## Gotchas",
  "## Delivery",
  "## Docs upkeep",
];
// The reader-orientation frame (scripts/check-docs-frame-coherence.mjs) adds
// these two H2s before the contract sections.
const FRAME_HEADINGS = ["## What this file is", "## What this file is not"];

/** @param {string} markdown */
function h2Headings(markdown) {
  return markdown.split("\n").filter((line) => line.startsWith("## "));
}

/**
 * Relative link targets in a markdown file, without anchors.
 * @param {string} markdown
 */
function relativeLinks(markdown) {
  return [...markdown.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)]
    .map((match) => match[1] ?? "")
    .filter((target) => target !== "" && !/^[a-z]+:/i.test(target));
}

describe("agent guide contract", () => {
  const guide = read("AGENTS.md");

  test("has the frame, then the contract sections in order", () => {
    expect(h2Headings(guide)).toEqual([...FRAME_HEADINGS, ...CONTRACT_HEADINGS]);
  });

  test("stays under the always-loaded byte budget", () => {
    expect(Buffer.byteLength(guide, "utf8")).toBeLessThanOrEqual(AGENT_GUIDE_BUDGET_BYTES);
  });

  test("is what Claude Code loads through CLAUDE.md", () => {
    expect(realpathSync(join(REPO_ROOT, "CLAUDE.md"))).toBe(
      realpathSync(join(REPO_ROOT, "AGENTS.md")),
    );
  });
});

describe("docs map", () => {
  const map = read("docs/README.md");
  const linked = new Set(relativeLinks(map).map((target) => resolve(REPO_ROOT, "docs", target)));

  test("lists every top-level doc", () => {
    const docs = readdirSync(join(REPO_ROOT, "docs")).filter(
      (name) => name.endsWith(".md") && name !== "README.md",
    );
    const missing = docs.filter((name) => !linked.has(resolve(REPO_ROOT, "docs", name)));
    expect(missing, "add a row to docs/README.md for each new doc").toEqual([]);
  });

  test("links only to files and folders that exist", () => {
    for (const target of linked) {
      expect(existsSync(target), `docs/README.md links to missing ${target}`).toBe(true);
    }
  });
});

describe("README opening", () => {
  const opening = read("README.md").split("\n").slice(0, 60).join("\n");

  test("starts with a quickstart code block and the docs map link", () => {
    expect(opening).toMatch(/```(bash|sh)\n/);
    expect(opening).toContain("docs/README.md");
  });
});

describe("relativeLinks", () => {
  test("keeps relative targets and drops anchors and URLs", () => {
    expect(relativeLinks("[a](docs/x.md#y) [b](https://x.dev) [c](../y/) [d](#z)")).toEqual([
      "docs/x.md",
      "../y/",
    ]);
  });
});

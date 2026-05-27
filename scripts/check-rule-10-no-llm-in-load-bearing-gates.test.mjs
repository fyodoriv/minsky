// @ts-check
// Tests for `check-rule-10-no-llm-in-load-bearing-gates.mjs`.

import { describe, expect, it } from "vitest";
import { checkRule10NoLlmInLoadBearingGates } from "./check-rule-10-no-llm-in-load-bearing-gates.mjs";

/**
 * @param {{
 *   manifest: { name: string, args: string[], cmd?: string }[];
 *   files: Record<string, string>;
 * }} input
 */
function makeOpts(input) {
  return {
    repoRoot: "/repo",
    manifest: input.manifest,
    fileExists: (/** @type {string} */ p) =>
      p.startsWith("/repo/") && input.files[p.slice(6)] !== undefined,
    readText: (/** @type {string} */ p) => input.files[p.slice(6)] ?? "",
  };
}

describe("checkRule10NoLlmInLoadBearingGates", () => {
  it("passes when no load-bearing gate imports an LLM SDK", () => {
    const result = checkRule10NoLlmInLoadBearingGates(
      makeOpts({
        manifest: [
          { name: "biome", cmd: "pnpm", args: ["biome", "check"] },
          {
            name: "rule-3-doc-first",
            cmd: "node",
            args: ["scripts/check-rule-3-doc-first.mjs"],
          },
        ],
        files: {
          "scripts/check-rule-3-doc-first.mjs":
            "import { readFileSync } from 'node:fs';\nexport function check() {}\n",
        },
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.loadBearingCount).toBe(1);
  });

  it("flags a load-bearing gate that imports @anthropic-ai/sdk (the canonical violation)", () => {
    const result = checkRule10NoLlmInLoadBearingGates(
      makeOpts({
        manifest: [
          {
            name: "evil-llm-gate",
            cmd: "node",
            args: ["scripts/check-evil-llm-gate.mjs"],
          },
        ],
        files: {
          "scripts/check-evil-llm-gate.mjs":
            "import Anthropic from '@anthropic-ai/sdk';\nconst c = new Anthropic();\nawait c.messages.create({});\n",
        },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.violations[0]).toMatch(/@anthropic-ai\/sdk/);
    expect(result.violations[0]).toMatch(/scripts\/check-evil-llm-gate.mjs:1/);
  });

  it("flags openai SDK import", () => {
    const result = checkRule10NoLlmInLoadBearingGates(
      makeOpts({
        manifest: [{ name: "x", cmd: "node", args: ["scripts/check-x.mjs"] }],
        files: { "scripts/check-x.mjs": "import OpenAI from 'openai';\n" },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("flags @google/generative-ai SDK import", () => {
    const result = checkRule10NoLlmInLoadBearingGates(
      makeOpts({
        manifest: [{ name: "x", cmd: "node", args: ["scripts/check-x.mjs"] }],
        files: {
          "scripts/check-x.mjs": "import { GoogleGenerativeAI } from '@google/generative-ai';\n",
        },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("flags langchain import", () => {
    const result = checkRule10NoLlmInLoadBearingGates(
      makeOpts({
        manifest: [{ name: "x", cmd: "node", args: ["scripts/check-x.mjs"] }],
        files: {
          "scripts/check-x.mjs":
            "import { ChatAnthropic } from 'langchain/chat_models/anthropic';\n",
        },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toMatch(/langchain/);
  });

  it("flags fetch against api.anthropic.com", () => {
    const result = checkRule10NoLlmInLoadBearingGates(
      makeOpts({
        manifest: [{ name: "x", cmd: "node", args: ["scripts/check-x.mjs"] }],
        files: {
          "scripts/check-x.mjs":
            "await fetch('https://api.anthropic.com/v1/messages', { method: 'POST' });\n",
        },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toMatch(/api\.anthropic\.com/);
  });

  it("flags fetch against api.openai.com", () => {
    const result = checkRule10NoLlmInLoadBearingGates(
      makeOpts({
        manifest: [{ name: "x", cmd: "node", args: ["scripts/check-x.mjs"] }],
        files: {
          "scripts/check-x.mjs": "await fetch('https://api.openai.com/v1/chat/completions');\n",
        },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("flags fetch against generativelanguage.googleapis.com", () => {
    const result = checkRule10NoLlmInLoadBearingGates(
      makeOpts({
        manifest: [{ name: "x", cmd: "node", args: ["scripts/check-x.mjs"] }],
        files: {
          "scripts/check-x.mjs":
            "const URL = 'https://generativelanguage.googleapis.com/v1/models';\n",
        },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("flags ollama localhost:11434 reference", () => {
    const result = checkRule10NoLlmInLoadBearingGates(
      makeOpts({
        manifest: [{ name: "x", cmd: "node", args: ["scripts/check-x.mjs"] }],
        files: {
          "scripts/check-x.mjs": "const ollamaUrl = 'http://localhost:11434/api/generate';\n",
        },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("flags `claude --print` bash exec", () => {
    const result = checkRule10NoLlmInLoadBearingGates(
      makeOpts({
        manifest: [{ name: "x", cmd: "node", args: ["scripts/check-x.mjs"] }],
        files: {
          "scripts/check-x.mjs":
            "execSync('claude --print \"is this a problem?\"', { encoding: 'utf8' });\n",
        },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.violations[0]).toMatch(/claude/);
  });

  it("ignores LLM imports in scripts NOT in STACK_MANIFEST (e.g. benchmarks)", () => {
    const result = checkRule10NoLlmInLoadBearingGates(
      makeOpts({
        manifest: [{ name: "rule-3", cmd: "node", args: ["scripts/check-rule-3-doc-first.mjs"] }],
        files: {
          "scripts/check-rule-3-doc-first.mjs": "// clean\n",
          // This file imports anthropic-ai but it's NOT in the manifest — should be ignored.
          "scripts/benchmark-anthropic.mjs": "import Anthropic from '@anthropic-ai/sdk';\n",
        },
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("ignores allowlisted files even when in STACK_MANIFEST (defensive — operator escape hatch)", () => {
    const result = checkRule10NoLlmInLoadBearingGates(
      makeOpts({
        manifest: [
          {
            name: "llm-provider-throughput",
            cmd: "node",
            args: ["scripts/llm-provider-throughput.mjs"],
          },
        ],
        files: {
          "scripts/llm-provider-throughput.mjs": "import Anthropic from '@anthropic-ai/sdk';\n",
        },
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("skips scripts that don't exist (preparation-PR shape)", () => {
    const result = checkRule10NoLlmInLoadBearingGates(
      makeOpts({
        manifest: [{ name: "future", cmd: "node", args: ["scripts/check-future.mjs"] }],
        files: {}, // script not on disk
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("only considers `cmd: 'node'` entries — pnpm/npx entries don't count as load-bearing scripts", () => {
    const result = checkRule10NoLlmInLoadBearingGates(
      makeOpts({
        manifest: [
          { name: "biome", cmd: "pnpm", args: ["biome", "ci", "."] },
          { name: "tasks-lint", cmd: "npx", args: ["-y", "@tasks-md/lint"] },
        ],
        files: {},
      }),
    );
    expect(result.ok).toBe(true);
    expect(result.loadBearingCount).toBe(0);
  });

  it("reports multiple violations across multiple scripts", () => {
    const result = checkRule10NoLlmInLoadBearingGates(
      makeOpts({
        manifest: [
          { name: "a", cmd: "node", args: ["scripts/check-a.mjs"] },
          { name: "b", cmd: "node", args: ["scripts/check-b.mjs"] },
        ],
        files: {
          "scripts/check-a.mjs": "import OpenAI from 'openai';\n",
          "scripts/check-b.mjs": "await fetch('https://api.anthropic.com/v1/messages');\n",
        },
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.violations.length).toBe(2);
  });

  it("uses match against the real production STACK_MANIFEST (smoke)", () => {
    // No opts — uses defaults. The current main branch must pass.
    const result = checkRule10NoLlmInLoadBearingGates();
    expect(result.ok).toBe(true);
    expect(result.loadBearingCount).toBeGreaterThan(20);
  });
});

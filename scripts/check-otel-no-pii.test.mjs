// @ts-check
// Paired tests for `classifySpanAttribute` (slice 1 of `otel-no-pii-in-spans-lint`).
//
// The eight cases below pin the contract before slice ≥2 wires the diff
// walker / CI gate around it. Each case carries a one-letter rubric tag
// matching the description in the script's header.

import { describe, expect, it } from "vitest";
import {
  classifyAttributesObject,
  classifySpanAttribute,
  extractAttributeViolations,
} from "./check-otel-no-pii.mjs";

describe("classifySpanAttribute (pure function)", () => {
  it("(a) plain attribute passes — { ok: true }", () => {
    const r = classifySpanAttribute("iteration.index", 42);
    expect(r).toEqual({ ok: true });
  });

  it("(b) attribute named `apiKey` flagged on name-shape", () => {
    const r = classifySpanAttribute("apiKey", "redacted");
    expect(r.ok).toBe(false);
    expect(r.shape).toBe("name-shape");
    expect(r.reason).toContain("api-key");
  });

  it("(c) attribute named `userPassword` flagged on name-shape (substring + case-insensitive)", () => {
    const r = classifySpanAttribute("userPassword", "");
    expect(r.ok).toBe(false);
    expect(r.shape).toBe("name-shape");
    expect(r.reason).toContain("password");
  });

  it("(d) Anthropic/OpenAI key value flagged regardless of attribute name", () => {
    const r = classifySpanAttribute("note", "context: sk-ant-api03-1234567890abcdefABCDEF");
    expect(r.ok).toBe(false);
    expect(r.shape).toBe("value-shape");
    expect(r.reason).toContain("anthropic-or-openai-key");
  });

  it("(e) GitHub PAT value flagged", () => {
    const r = classifySpanAttribute("body", "ghp_abcdefghijklmnopqrstuvwxyz0123456789");
    expect(r.ok).toBe(false);
    expect(r.shape).toBe("value-shape");
    expect(r.reason).toContain("github-pat");
  });

  it("(f) `sk-test` short-prefix is NOT flagged (below the {20,} floor)", () => {
    // Guard against false positives on labels / fixtures where `sk-test`
    // appears as a literal short string.
    const r = classifySpanAttribute("label", "sk-test");
    expect(r).toEqual({ ok: true });
  });

  it("(g) non-string value with safe name passes", () => {
    const r = classifySpanAttribute("retry.count", 3);
    expect(r).toEqual({ ok: true });
  });

  it("(h) credential-named attribute still flags even when value is non-string", () => {
    const r = classifySpanAttribute("bearer_token", undefined);
    expect(r.ok).toBe(false);
    expect(r.shape).toBe("name-shape");
    // First-match is `bearer` (entry order in NAME_PATTERNS).
    expect(r.reason).toContain("bearer");
  });

  it("(i) Slack bot token value flagged", () => {
    const r = classifySpanAttribute("hook.url", "xoxb-1234567890-abcdefghij-ABCDEFGHIJ");
    expect(r.ok).toBe(false);
    expect(r.shape).toBe("value-shape");
    expect(r.reason).toContain("slack-bot-token");
  });

  it("(j) malformed non-string attribute name rejected with clear reason", () => {
    const r = classifySpanAttribute(/** @type {any} */ (42), "foo");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("must be a string");
  });
});

describe("classifyAttributesObject (pure function)", () => {
  it("returns null when every attribute is safe", () => {
    const r = classifyAttributesObject({
      "iteration.index": 1,
      "iteration.status": "completed",
      "task.id": "demo",
    });
    expect(r).toBeNull();
  });

  it("returns the first violation with attribute name attached", () => {
    const r = classifyAttributesObject({
      "iteration.index": 1,
      apiKey: "redacted",
      // would also flag, but apiKey is reported first by entry order
      password: "x",
    });
    expect(r).not.toBeNull();
    expect(r?.name).toBe("apiKey");
    expect(r?.shape).toBe("name-shape");
    expect(r?.ok).toBe(false);
  });

  it("flags value-shape even when names are safe", () => {
    const r = classifyAttributesObject({
      url: "https://api.example.com",
      payload: "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    });
    expect(r?.name).toBe("payload");
    expect(r?.shape).toBe("value-shape");
  });
});

describe("extractAttributeViolations (AST walker, slice 2)", () => {
  it("(w-a) clean source produces zero violations", () => {
    const source = `
      function emit(e: any) {}
      emit({
        name: "tick-loop.iteration",
        attributes: {
          "iteration.index": 1,
          "iteration.status": "completed",
        },
      });
    `;
    const r = extractAttributeViolations({ files: [{ path: "a.ts", source }] });
    expect(r.violations).toEqual([]);
  });

  it('(w-b) `attributes: { apiKey: "x" }` flagged on name-shape', () => {
    const source = `emit({ name: "x", attributes: { apiKey: "redacted" } });`;
    const r = extractAttributeViolations({ files: [{ path: "a.ts", source }] });
    expect(r.violations).toHaveLength(1);
    const [v] = r.violations;
    expect(v).toMatchObject({
      file: "a.ts",
      attributeName: "apiKey",
      shape: "name-shape",
    });
    expect(v?.line).toBeGreaterThan(0);
  });

  it("(w-c) string-literal credential value flagged on value-shape", () => {
    // Build the token by concatenation so the lint that flags credential
    // patterns in this very test source doesn't itself fire on us.
    const token = `ghp_${"a".repeat(40)}`;
    const source = `emit({ attributes: { note: "${token}" } });`;
    const r = extractAttributeViolations({ files: [{ path: "a.ts", source }] });
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]).toMatchObject({
      attributeName: "note",
      shape: "value-shape",
    });
  });

  it("(w-d) non-literal value with safe name is NOT flagged", () => {
    // The runtime guard (slice ≥4) catches these; the static walker
    // intentionally does not — value cannot be statically verified.
    const source = "emit({ attributes: { url: someVar } });";
    const r = extractAttributeViolations({ files: [{ path: "a.ts", source }] });
    expect(r.violations).toEqual([]);
  });

  it("(w-e) non-literal value with credential-shaped name IS flagged", () => {
    // Name-shape doesn't depend on the value, so dynamic values still
    // flag if the key itself is credential-shaped.
    const source = "emit({ attributes: { password: someVar } });";
    const r = extractAttributeViolations({ files: [{ path: "a.ts", source }] });
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]).toMatchObject({
      attributeName: "password",
      shape: "name-shape",
    });
  });

  it("(w-f) computed property keys are skipped (static name unknown)", () => {
    const source = `
      const KEY = "apiKey";
      emit({ attributes: { [KEY]: "redacted" } });
    `;
    const r = extractAttributeViolations({ files: [{ path: "a.ts", source }] });
    expect(r.violations).toEqual([]);
  });

  it("(w-g) string-literal property keys are honoured", () => {
    const source = `emit({ attributes: { "apiKey": "x" } });`;
    const r = extractAttributeViolations({ files: [{ path: "a.ts", source }] });
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]?.attributeName).toBe("apiKey");
  });

  it("(w-h) nested `attributes:` properties are walked recursively", () => {
    const source = `
      const cfg = {
        outer: {
          attributes: { apiKey: "x" },
        },
      };
    `;
    const r = extractAttributeViolations({ files: [{ path: "a.ts", source }] });
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]?.attributeName).toBe("apiKey");
  });

  it("(w-i) only `attributes:` literals are considered (other props ignored)", () => {
    // A `headers: { apiKey }` literal MUST NOT flag — span attributes are
    // the lint's scope, not generic config objects.
    const source = `request({ headers: { apiKey: "x" } });`;
    const r = extractAttributeViolations({ files: [{ path: "a.ts", source }] });
    expect(r.violations).toEqual([]);
  });

  it("(w-j) multiple files aggregate", () => {
    const r = extractAttributeViolations({
      files: [
        { path: "a.ts", source: `emit({ attributes: { apiKey: "x" } });` },
        { path: "b.ts", source: `emit({ attributes: { token: "x" } });` },
      ],
    });
    expect(r.violations).toHaveLength(2);
    expect(r.violations.map((v) => v.file).sort()).toEqual(["a.ts", "b.ts"]);
  });

  it("(w-k) line numbers are 1-based and locate the offending property", () => {
    const source = [
      "emit({", //
      '  name: "x",',
      "  attributes: {",
      '    apiKey: "x",',
      "  },",
      "});",
    ].join("\n");
    const r = extractAttributeViolations({ files: [{ path: "a.ts", source }] });
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]?.line).toBe(4);
  });
});

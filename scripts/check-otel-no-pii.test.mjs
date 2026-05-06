// @ts-check
// Paired tests for `classifySpanAttribute` (slice 1 of `otel-no-pii-in-spans-lint`).
//
// The eight cases below pin the contract before slice ≥2 wires the diff
// walker / CI gate around it. Each case carries a one-letter rubric tag
// matching the description in the script's header.

import { describe, expect, it } from "vitest";
import { classifyAttributesObject, classifySpanAttribute } from "./check-otel-no-pii.mjs";

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

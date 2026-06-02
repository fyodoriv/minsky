// Tests for check-anchor-primary-source.mjs. Pattern: deterministic gate
// over the rule-#9 `anchor` field — promotion of spec-monitor advisory
// rule A3 ("anchor citation is not a primary source"). Paired
// positive/negative fixtures (Meszaros 2007).

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  ALLOWLIST,
  checkAnchorPrimarySource,
  DENYLIST,
  detectSkipComment,
  mainDirectory,
} from "./check-anchor-primary-source.mjs";

describe("checkAnchorPrimarySource — deny-list hits → fail", () => {
  test("case 1: `https://medium.com/some-blog/post` → fail (deny-list)", () => {
    const r = checkAnchorPrimarySource("https://medium.com/some-blog/post");
    expect(r.level).toBe("fail");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("medium.com");
  });

  test("case 2: `Wikipedia: Watchdog timer` → fail (deny-list)", () => {
    const r = checkAnchorPrimarySource("Wikipedia: Watchdog timer");
    expect(r.level).toBe("fail");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Wikipedia/);
  });

  test('case 3: `a tweet by @some-user` → fail (deny-list "tweet by")', () => {
    const r = checkAnchorPrimarySource("a tweet by @some-user");
    expect(r.level).toBe("fail");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("tweet by");
  });

  test("case 4: `ChatGPT said this is best practice` → fail (deny-list)", () => {
    const r = checkAnchorPrimarySource("ChatGPT said this is best practice");
    expect(r.level).toBe("fail");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("ChatGPT said");
  });

  test("substack URL → fail", () => {
    const r = checkAnchorPrimarySource("https://someone.substack.com/p/post");
    expect(r.level).toBe("fail");
    expect(r.reason).toContain("substack");
  });

  test("twitter.com URL → fail", () => {
    const r = checkAnchorPrimarySource("https://twitter.com/user/status/12345");
    expect(r.level).toBe("fail");
    expect(r.reason).toContain("twitter.com");
  });

  test("reddit.com URL → fail", () => {
    const r = checkAnchorPrimarySource("https://reddit.com/r/programming/comments/abc");
    expect(r.level).toBe("fail");
    expect(r.reason).toContain("reddit.com");
  });

  test("stackoverflow.com URL → fail", () => {
    const r = checkAnchorPrimarySource("https://stackoverflow.com/questions/123/why");
    expect(r.level).toBe("fail");
    expect(r.reason).toContain("stackoverflow.com");
  });

  test("chatgpt.com URL → fail", () => {
    const r = checkAnchorPrimarySource("https://chatgpt.com/share/abc");
    expect(r.level).toBe("fail");
    expect(r.reason).toContain("chatgpt.com");
  });

  test("`blog post by Jane` → fail (deny-list)", () => {
    const r = checkAnchorPrimarySource("see this blog post by Jane Doe");
    expect(r.level).toBe("fail");
    expect(r.reason).toContain("blog post");
  });
});

describe("checkAnchorPrimarySource — allowlist hits → pass", () => {
  test("case 5: `Beyer et al., *Site Reliability Engineering*, 2016, Ch. 3` → pass (book + chapter)", () => {
    const r = checkAnchorPrimarySource("Beyer et al., *Site Reliability Engineering*, 2016, Ch. 3");
    expect(r.level).toBe("pass");
    expect(r.ok).toBe(true);
    // At least one of the recognised primary-source patterns should fire.
    expect(r.reason).toMatch(/italicised title|Ch\./);
  });

  test("case 6: `rule #9 (vision.md § 9)` → pass (internal cross-ref)", () => {
    const r = checkAnchorPrimarySource("rule #9 (vision.md § 9)");
    expect(r.level).toBe("pass");
    expect(r.ok).toBe(true);
    expect(r.reason).toMatch(/rule #|vision\.md/);
  });

  test("case 7: `DOI: 10.1234/abcd` → pass (DOI)", () => {
    const r = checkAnchorPrimarySource("DOI: 10.1234/abcd");
    expect(r.level).toBe("pass");
    expect(r.ok).toBe(true);
    expect(r.reason).toContain("DOI");
  });

  test("ISBN cite → pass", () => {
    const r = checkAnchorPrimarySource("ISBN 978-0-13-468599-1, *The Pragmatic Programmer*");
    expect(r.level).toBe("pass");
    expect(r.ok).toBe(true);
  });

  test("`Munafò et al., *Nature Human Behaviour* 1, 0021, 2017` → pass (italicised journal)", () => {
    const r = checkAnchorPrimarySource(
      "Munafò et al., *Nature Human Behaviour* 1, 0021, 2017 (pre-registration)",
    );
    expect(r.level).toBe("pass");
    expect(r.ok).toBe(true);
    expect(r.reason).toMatch(/italicised title/);
  });

  test("`Gray & Cheriton, SOSP 1989` → pass (<VENUE> <YEAR>)", () => {
    const r = checkAnchorPrimarySource("Gray & Cheriton, SOSP 1989");
    expect(r.level).toBe("pass");
    expect(r.ok).toBe(true);
  });

  test("spec-advisories cross-ref → pass", () => {
    const r = checkAnchorPrimarySource("spec-advisories/2026-05-03-quarterly-audit.md");
    expect(r.level).toBe("pass");
    expect(r.ok).toBe(true);
  });

  test("allowlist wins over deny-list (citation that mentions Wikipedia inside a primary cite)", () => {
    // A primary-source citation that also happens to name "Wikipedia"
    // (e.g., contrasting against it) should still pass — the italicised
    // title carries the load-bearing signal.
    const r = checkAnchorPrimarySource(
      "Beyer et al., *Site Reliability Engineering*, 2016, Ch. 3 (not Wikipedia)",
    );
    expect(r.level).toBe("pass");
    expect(r.ok).toBe(true);
  });
});

describe("checkAnchorPrimarySource — neither list → warn / pass-with-note", () => {
  test("case 8: `unknown short anchor` → warn (no signal either way)", () => {
    const r = checkAnchorPrimarySource("unknown short anchor");
    expect(r.level).toBe("warn");
    expect(r.ok).toBe(true);
    expect(r.reason).toContain("residual judgement");
  });

  test("long unrecognised prose → pass (advisory layer covers it)", () => {
    // ≥25 chars, no allowlist hit, no deny-list hit. The deterministic
    // gate stays silent on the long-tail.
    const r = checkAnchorPrimarySource(
      "Some long-form prose citation that doesn't match any specific pattern but is plausible",
    );
    expect(r.level).toBe("pass");
    expect(r.ok).toBe(true);
  });

  test("empty string → fail (degenerate)", () => {
    const r = checkAnchorPrimarySource("");
    expect(r.level).toBe("fail");
    expect(r.ok).toBe(false);
  });

  test("whitespace-only → fail (degenerate)", () => {
    const r = checkAnchorPrimarySource("   \n  \t  ");
    expect(r.level).toBe("fail");
    expect(r.ok).toBe(false);
  });
});

describe("checkAnchorPrimarySource — false-positive guards", () => {
  test("`wikileaks` does NOT match `wikipedia` (boundary on `pedia`)", () => {
    // `wikileaks` shares a prefix with `wikipedia` but is not deny-listed;
    // long enough to fall through to pass-with-note.
    const r = checkAnchorPrimarySource(
      "as documented on the wikileaks-style internal mailing list archive",
    );
    expect(r.level).toBe("pass");
  });

  test("italicised single asterisk (bullet marker) does NOT match italicised title", () => {
    // The matcher requires an alphabetic char inside `*…*`; bullet markers
    // like `* item` or stray `*` characters with whitespace don't qualify.
    const r = checkAnchorPrimarySource("short * cite");
    // 12 chars → warn (no allowlist, no denylist).
    expect(r.level).toBe("warn");
  });
});

describe("checkAnchorPrimarySource — repo's own EXPERIMENT.yaml shape", () => {
  test("the existing pivot-success-margin anchor passes (book + cross-ref)", () => {
    // Snapshot of the current repo's EXPERIMENT.yaml `anchor` field.
    const anchor =
      "Ries, *The Lean Startup*, 2011 (build-measure-learn / pivot-or-persevere — a meaningful pivot threshold must carry information distinct from the success threshold); rule #10 (vision.md § 10 — deterministic enforcement; ratchet rule: when an advisory rule is promoted to a deterministic linter, the advisory counterpart is removed in the same PR); `spec-advisories/2026-05-03-quarterly-audit.md` (audit decision to promote A2).";
    const r = checkAnchorPrimarySource(anchor);
    expect(r.level).toBe("pass");
    expect(r.ok).toBe(true);
  });
});

describe("detectSkipComment", () => {
  test("recognises the opt-out comment", () => {
    const yaml = "# rule: ci-lint-anchor-primary-source: skip legitimate Medium quote\nid: test\n";
    const r = detectSkipComment(yaml);
    expect(r.skip).toBe(true);
    if (r.skip) expect(r.reason).toContain("legitimate Medium quote");
  });

  test("ignores unrelated comments", () => {
    const yaml = "# regular comment\n# rule: ci-lint-pivot-success-margin: skip foo\nid: test\n";
    const r = detectSkipComment(yaml);
    expect(r.skip).toBe(false);
  });
});

describe("DENYLIST + ALLOWLIST shape (locked for review)", () => {
  test("DENYLIST contains the documented non-primary tokens", () => {
    const names = new Set(DENYLIST.map((r) => r.name));
    for (const required of [
      "medium.com",
      "substack.com",
      "wikipedia.org",
      "twitter.com",
      "reddit.com",
      "stackoverflow.com",
      "chatgpt.com",
      "claude.ai",
      "ChatGPT said",
      "tweet by",
      "blog post",
    ]) {
      expect(names.has(required)).toBe(true);
    }
  });

  test("ALLOWLIST contains the documented primary-source patterns", () => {
    const names = new Set(ALLOWLIST.map((r) => r.name));
    for (const required of [
      "italicised title (*Title*)",
      "Ch. <n>",
      "pp. <n> / p. <n>",
      "DOI",
      "ISBN",
      "<VENUE> <YEAR>",
      "rule #<n>",
      "vision.md §",
      "spec-advisories/<date>.md",
    ]) {
      expect(names.has(required)).toBe(true);
    }
  });

  test("DENYLIST stays under the 15-entry pivot threshold", () => {
    // The task's pivot triggers if the deny-list grows past ~15 entries.
    expect(DENYLIST.length).toBeLessThanOrEqual(15);
  });
});

describe("mainDirectory — experiments-directory-migration walker", () => {
  /** @type {string} */
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "anchor-walker-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** @param {string} id @param {string} anchor */
  const validRecord = (id, anchor) => `id: ${id}
hypothesis: |
  This is a test hypothesis with at least twenty characters of substantive content.
success: ">= 10 percent"
pivot: "< 5 percent"
measurement: "test -f foo && grep something"
anchor: |
  ${anchor}
`;

  test("returns 0 when directory does not exist", async () => {
    const code = await mainDirectory(join(dir, "nonexistent-subdir"));
    expect(code).toBe(0);
  });

  test("returns 0 when directory has no *.yaml files", async () => {
    const code = await mainDirectory(dir);
    expect(code).toBe(0);
  });

  test("returns 0 when all yaml files have valid anchors", async () => {
    writeFileSync(
      join(dir, "a.yaml"),
      validRecord("test-a", "*Site Reliability Engineering*, Beyer SRE 2016, Ch. 6"),
    );
    writeFileSync(
      join(dir, "b.yaml"),
      validRecord("test-b", "rule #9 (vision.md § 9 — pre-registration)"),
    );
    const code = await mainDirectory(dir);
    expect(code).toBe(0);
  });

  test("returns 1 when ANY file has a deny-list anchor (max wins)", async () => {
    writeFileSync(
      join(dir, "good.yaml"),
      validRecord("test-good", "*Site Reliability Engineering*, Beyer SRE 2016, Ch. 6"),
    );
    writeFileSync(
      join(dir, "bad.yaml"),
      validRecord("test-bad", "https://medium.com/@someone/blog-post-2026"),
    );
    const code = await mainDirectory(dir);
    expect(code).toBe(1);
  });

  test("ignores non-yaml files in the directory", async () => {
    writeFileSync(join(dir, "README.md"), "# notes");
    writeFileSync(
      join(dir, "good.yaml"),
      validRecord("test-good", "*Site Reliability Engineering*, Beyer SRE 2016, Ch. 6"),
    );
    const code = await mainDirectory(dir);
    expect(code).toBe(0);
  });
});

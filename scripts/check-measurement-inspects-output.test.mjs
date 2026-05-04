// Tests for check-measurement-inspects-output.mjs. Pattern: deterministic
// gate over the rule-#9 `measurement` field — promotion of spec-monitor
// advisory rule A4 ("measurement runs but doesn't actually inspect output").
// Paired positive/negative fixtures (Meszaros 2007).

import { describe, expect, test } from "vitest";

import {
  ALLOWLIST,
  BLACKLIST,
  checkMeasurementInspectsOutput,
} from "./check-measurement-inspects-output.mjs";

describe("checkMeasurementInspectsOutput — allowlist hits → pass", () => {
  test('case 1: `test "$(grep -c X file)" -ge 1` → pass (test + grep -c both win)', () => {
    const r = checkMeasurementInspectsOutput('test "$(grep -c X file)" -ge 1');
    expect(r.level).toBe("pass");
    expect(r.ok).toBe(true);
    // Both allowlist tokens fire; the message lists at least one.
    expect(r.reason).toMatch(/test|grep -c/);
  });

  test("case 5: `curl -s URL | jq -e '.ok'` → pass (curl piped to jq -e — allowlist wins)", () => {
    const r = checkMeasurementInspectsOutput("curl -s https://api.example/usage | jq -e '.ok'");
    expect(r.level).toBe("pass");
    expect(r.ok).toBe(true);
    expect(r.reason).toContain("jq -e");
  });

  test("case 6: `node scripts/check-foo.mjs` → pass (allowlist via node scripts/check-*.mjs)", () => {
    const r = checkMeasurementInspectsOutput("node scripts/check-foo.mjs");
    expect(r.level).toBe("pass");
    expect(r.ok).toBe(true);
    expect(r.reason).toContain("node scripts/check-*.mjs");
  });

  test("case 7: `pnpm vitest run scripts/foo.test.mjs` → pass (vitest)", () => {
    const r = checkMeasurementInspectsOutput("pnpm vitest run scripts/foo.test.mjs");
    expect(r.level).toBe("pass");
    expect(r.ok).toBe(true);
    expect(r.reason).toContain("vitest");
  });

  test("case 8: `echo hi && grep -q X file` → pass (grep -q wins over echo blacklist)", () => {
    const r = checkMeasurementInspectsOutput("echo hi && grep -q X file");
    expect(r.level).toBe("pass");
    expect(r.ok).toBe(true);
    expect(r.reason).toContain("grep -q");
  });
});

describe("checkMeasurementInspectsOutput — blacklist hits → fail", () => {
  test("case 2: `echo done` → fail (blacklist `echo`)", () => {
    const r = checkMeasurementInspectsOutput("echo done");
    expect(r.level).toBe("fail");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("echo");
  });

  test("case 3: `true` → fail (blacklist `true`)", () => {
    const r = checkMeasurementInspectsOutput("true");
    expect(r.level).toBe("fail");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("true");
  });

  test("case 4: `curl http://localhost/health` → fail (bare curl, no piped consumer)", () => {
    const r = checkMeasurementInspectsOutput("curl http://localhost/health");
    expect(r.level).toBe("fail");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("curl");
  });

  test("bare `node count.mjs` (not under scripts/check-*.mjs) → fail", () => {
    const r = checkMeasurementInspectsOutput("node count.mjs");
    expect(r.level).toBe("fail");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("node");
  });
});

describe("checkMeasurementInspectsOutput — neither list → warn", () => {
  test("case 9: `some-prose-only-no-command` → warn (no recognised inspector or blacklist)", () => {
    const r = checkMeasurementInspectsOutput("some-prose-only-no-command");
    expect(r.level).toBe("warn");
    expect(r.ok).toBe(true);
    expect(r.reason).toContain("residual judgement");
  });

  test("empty string → fail (degenerate)", () => {
    const r = checkMeasurementInspectsOutput("");
    expect(r.level).toBe("fail");
    expect(r.ok).toBe(false);
  });

  test("whitespace-only → fail (degenerate)", () => {
    const r = checkMeasurementInspectsOutput("   \n  \t  ");
    expect(r.level).toBe("fail");
    expect(r.ok).toBe(false);
  });
});

describe("checkMeasurementInspectsOutput — false-positive guards (word boundaries)", () => {
  test("`pnpm vitest run --reporter latest` does NOT match `test` via `latest` — but DOES match `vitest`, so it passes correctly", () => {
    const r = checkMeasurementInspectsOutput("pnpm vitest run --reporter latest");
    expect(r.level).toBe("pass");
    expect(r.reason).toContain("vitest");
    // Crucially: the result still passes for the right reason; if the
    // matcher mistook `latest` for `test`, we'd see the `test` token in the
    // reason as well. We check the false-positive trap below in isolation.
  });

  test("`assert(condition)` — `assert` matches via \\b word boundary; `true` substring inside an identifier does NOT (shell-separator guard)", () => {
    // `assert` matches at the word boundary between `assert` and `(`.
    // `true` is NOT present in the buffer, but if it were embedded in an
    // identifier like `assertTrue` the blacklist matcher would still skip
    // it — the blacklist requires shell-separator boundaries on both sides.
    const r = checkMeasurementInspectsOutput("assert(value)");
    expect(r.level).toBe("pass");
    expect(r.reason).toContain("assert");
  });

  test("`echo assertTrue` — `assert` allowlist hits via word boundary; `Trueblood` style identifier embedding `true` substring does NOT trigger blacklist", () => {
    // The buffer has `assert` (allowlist hit, word-boundary at start, then
    // `T` doesn't boundary at end — wait, `assert` followed by `T` (word
    // char) means no word boundary, so `\bassert\b` does NOT match here).
    // What WOULD match: `echo` (blacklist). And neither `assert` nor `true`
    // matches because both are embedded in identifiers. So → fail via echo.
    const r = checkMeasurementInspectsOutput("echo assertTrue Trueblood");
    expect(r.level).toBe("fail");
    expect(r.reason).toContain("echo");
    // Crucially: the reason should NOT mention `true` (Trueblood is not
    // surrounded by shell separators).
    expect(r.reason).not.toMatch(/\btrue\b/);
  });

  test("`pretest hooks` does NOT match `test` (word-boundary guard)", () => {
    // No allowlist hit, no blacklist hit → warn.
    const r = checkMeasurementInspectsOutput("pretest hooks ran");
    expect(r.level).toBe("warn");
  });
});

describe("checkMeasurementInspectsOutput — repo's own EXPERIMENT.yaml-shaped command", () => {
  test("the supervisor-integration-tests measurement passes (`test -x …` + `grep -q …`)", () => {
    // Snapshot of the current repo's EXPERIMENT.yaml `measurement` field.
    const measurement =
      "test -x distribution/test-supervisor.sh && grep -q 'linux-supervisor-integration:' .github/workflows/ci.yml && grep -q 'macos-supervisor-integration:' .github/workflows/ci.yml && grep -q 'linux-supervisor-integration' .github/workflows/ci.yml && bash distribution/lint-units.sh >/dev/null";
    const r = checkMeasurementInspectsOutput(measurement);
    expect(r.level).toBe("pass");
    expect(r.ok).toBe(true);
  });
});

describe("ALLOWLIST + BLACKLIST shape (locked for review)", () => {
  test("ALLOWLIST contains the documented inspector tokens", () => {
    const names = new Set(ALLOWLIST.map((r) => r.name));
    for (const required of [
      "test",
      "[ ... ]",
      "[[ ... ]]",
      "jq -e",
      "grep -q",
      "grep -c",
      "assert",
      "vitest",
      "pnpm test",
      "pnpm typecheck",
      "pnpm lint",
      "@tasks-md/lint",
      "markdownlint-cli2",
      "gh run list ... --jq",
      "node scripts/check-*.mjs",
    ]) {
      expect(names.has(required)).toBe(true);
    }
  });

  test("BLACKLIST contains the documented degenerate-form tokens", () => {
    const names = new Set(BLACKLIST.map((r) => r.name));
    for (const required of ["echo", "true", "curl (bare)", "node (bare)"]) {
      expect(names.has(required)).toBe(true);
    }
  });
});

// @ts-check
import { describe, expect, it } from "vitest";
import { checkPrePushHookFast } from "./check-pre-push-hook-fast.mjs";

const VALID_YAML = `pre-push:
  commands:
    pre-pr-lint:
      run: pnpm pre-pr-lint --stage=fast
`;

const FULL_STAGE_YAML = `pre-push:
  commands:
    pre-pr-lint:
      run: pnpm pre-pr-lint --stage=full
`;

const MISSING_PRE_PUSH_YAML = `pre-commit:
  commands:
    biome:
      run: pnpm biome check
`;

// pre-pr-lint nested under the wrong hook (pre-commit, not pre-push).
const WRONG_KEY_YAML = `pre-commit:
  commands:
    pre-pr-lint:
      run: pnpm pre-pr-lint --stage=fast
`;

describe("checkPrePushHookFast", () => {
  it("passes the current valid --stage=fast shape", () => {
    const result = checkPrePushHookFast({ yamlText: VALID_YAML, env: {} });
    expect(result.ok).toBe(true);
    expect(result.error).toBeNull();
    expect(result.warning).toBeNull();
  });

  it("rejects --stage=full with the actionable message", () => {
    const result = checkPrePushHookFast({ yamlText: FULL_STAGE_YAML, env: {} });
    expect(result.ok).toBe(false);
    expect(result.error).toBe(
      "pre-push must use --stage=fast (current: --stage=full); see TASKS.md pre-push-hook-stays-fast",
    );
  });

  it("rejects a missing pre-push block with an actionable message", () => {
    const result = checkPrePushHookFast({ yamlText: MISSING_PRE_PUSH_YAML, env: {} });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/pre-push must use --stage=fast/);
    expect(result.error).toMatch(/missing pre-push\.commands\.pre-pr-lint\.run/);
  });

  it("rejects pre-pr-lint nested under the wrong hook key", () => {
    const result = checkPrePushHookFast({ yamlText: WRONG_KEY_YAML, env: {} });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/missing pre-push\.commands\.pre-pr-lint\.run/);
  });

  it("accepts ALLOW_SLOW_PRE_PUSH=1 opt-out with a warning, even on --stage=full", () => {
    const result = checkPrePushHookFast({
      yamlText: FULL_STAGE_YAML,
      env: { ALLOW_SLOW_PRE_PUSH: "1" },
    });
    expect(result.ok).toBe(true);
    expect(result.error).toBeNull();
    expect(result.warning).toMatch(/pre-push-slow-justified/);
  });

  it("treats ALLOW_SLOW_PRE_PUSH=0 / empty / false as NOT opted out", () => {
    for (const v of ["0", "", "false"]) {
      const result = checkPrePushHookFast({
        yamlText: FULL_STAGE_YAML,
        env: { ALLOW_SLOW_PRE_PUSH: v },
      });
      expect(result.ok, `ALLOW_SLOW_PRE_PUSH=${JSON.stringify(v)}`).toBe(false);
    }
  });

  it("returns the missing-block message when the text has no resolvable chain", () => {
    const result = checkPrePushHookFast({ yamlText: "::: not a key line :::", env: {} });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/missing pre-push\.commands\.pre-pr-lint\.run/);
  });

  it("real production lefthook.yml passes (smoke)", () => {
    const result = checkPrePushHookFast({ env: {} });
    expect(result.ok).toBe(true);
    expect(result.error).toBeNull();
  });
});

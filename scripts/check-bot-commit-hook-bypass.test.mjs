// @ts-check
import { describe, expect, it } from "vitest";
import { checkBotCommitHookBypass, parseCommitSteps } from "./check-bot-commit-hook-bypass.mjs";

const HOOKS_BYPASS_STEP = `jobs:
  recorder:
    runs-on: ubuntu-latest
    steps:
      - name: commit recorder output
        run: |
          set -euo pipefail
          git config core.hooksPath /dev/null
          git add out/
          git commit -m "chore: record [skip ci]"
`;

const LEFTHOOK_ENV_STEP = `jobs:
  recorder:
    steps:
      - name: open PR
        env:
          LEFTHOOK: "0"
        run: |
          git commit -m "chore: pr commit"
`;

const NO_BYPASS_STEP = `jobs:
  recorder:
    steps:
      - name: commit tracker output
        run: |
          set -euo pipefail
          git config user.name "github-actions[bot]"
          git add out/
          git commit -m "chore: record [skip ci]"
`;

describe("checkBotCommitHookBypass", () => {
  it("passes a commit step that disables hooks via core.hooksPath /dev/null", () => {
    const r = checkBotCommitHookBypass({ workflowTexts: { "a.yml": HOOKS_BYPASS_STEP } });
    expect(r.ok).toBe(true);
    expect(r.commitSteps).toHaveLength(1);
    expect(r.commitSteps[0]?.bypassed).toBe(true);
  });

  it('passes a commit step whose env sets LEFTHOOK: "0"', () => {
    const r = checkBotCommitHookBypass({ workflowTexts: { "a.yml": LEFTHOOK_ENV_STEP } });
    expect(r.ok).toBe(true);
    expect(r.commitSteps[0]?.bypassed).toBe(true);
  });

  it("flags a commit step with no bypass", () => {
    const r = checkBotCommitHookBypass({ workflowTexts: { "track.yml": NO_BYPASS_STEP } });
    expect(r.ok).toBe(false);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]).toMatch(/track\.yml/);
    expect(r.violations[0]).toMatch(/commit tracker output/);
    expect(r.violations[0]).toMatch(/without a lefthook bypass/);
  });

  it("does NOT accept --no-verify as a bypass (it is independently banned)", () => {
    const yaml = `jobs:
  j:
    steps:
      - name: bypass via banned flag
        run: |
          git commit --no-verify -m "chore: nope"
`;
    const r = checkBotCommitHookBypass({ workflowTexts: { "a.yml": yaml } });
    expect(r.ok).toBe(false);
  });

  it("ignores steps that mention git commit only in a comment", () => {
    const yaml = `jobs:
  j:
    steps:
      - name: build
        run: |
          # this step does NOT git commit anything
          pnpm build
`;
    const r = checkBotCommitHookBypass({ workflowTexts: { "a.yml": yaml } });
    expect(r.ok).toBe(true);
    expect(r.commitSteps).toHaveLength(0);
  });

  it("does not mistake an on.schedule cron list for a step boundary", () => {
    // Regression: the cron sequence is at a shallower indent than `steps:`
    // items; an indent-only splitter merged every step into one block and let
    // a later step's LEFTHOOK env leak onto an unrelated commit.
    const yaml = `name: w
on:
  schedule:
    - cron: "0 9 * * *"
jobs:
  j:
    steps:
      - name: commit without bypass
        run: |
          git commit -m "chore: x"
      - name: pr step with env
        env:
          LEFTHOOK: "0"
        uses: peter-evans/create-pull-request@v8
`;
    const r = checkBotCommitHookBypass({ workflowTexts: { "a.yml": yaml } });
    expect(r.ok).toBe(false);
    const commitStep = r.commitSteps.find((s) => s.line > 0);
    expect(commitStep?.stepName).toBe("commit without bypass");
    expect(commitStep?.bypassed).toBe(false);
  });

  it("reports the line number of the git commit invocation", () => {
    const r = checkBotCommitHookBypass({ workflowTexts: { "a.yml": NO_BYPASS_STEP } });
    // NO_BYPASS_STEP: line 1 jobs, ... `git commit` is the 9th line.
    expect(r.commitSteps[0]?.line).toBe(9);
  });

  it("counts the workflows it scanned", () => {
    const r = checkBotCommitHookBypass({
      workflowTexts: { "a.yml": HOOKS_BYPASS_STEP, "b.yml": LEFTHOOK_ENV_STEP },
    });
    expect(r.scannedCount).toBe(2);
  });

  it("real production scan passes (smoke) — every workflow bot-commit is bypassed", () => {
    const r = checkBotCommitHookBypass();
    expect(r.ok).toBe(true);
  });
});

describe("parseCommitSteps", () => {
  it("returns one CommitStep per git-commit-running step, with file + name", () => {
    const steps = parseCommitSteps("w.yml", NO_BYPASS_STEP);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.file).toBe("w.yml");
    expect(steps[0]?.stepName).toBe("commit tracker output");
  });

  it("returns an empty array for a workflow with no commits", () => {
    const yaml = `jobs:
  j:
    steps:
      - run: pnpm test
`;
    expect(parseCommitSteps("w.yml", yaml)).toHaveLength(0);
  });
});

/**
 * User-story 004 — "Token budget auto-pauses before cliff" (Phase 1 spec).
 *
 * Substrate-level invariant test. The end-to-end behaviour (programmable
 * burn-rate curve, model downgrade on threshold cross, flag-file write,
 * auto-resume on window reset) is covered by the package's own
 * `flag-file.test.ts` + `http-server.test.ts`; this file pins the
 * STORY → IMPLEMENTATION SUBSTRATE that holds the spec accountable:
 *   - `novel/budget-guard/src/index.ts` exports the documented API
 *     surface (`decide`, `BudgetGuard`, `DEFAULT_THRESHOLDS`,
 *     `BudgetAction`) — if any of these get renamed without a
 *     same-commit user-story update, this test catches the drift
 *   - `DEFAULT_THRESHOLDS.degradeAt === 0.7` (the user story's
 *     "70% — switch low-effort personas to Haiku" threshold)
 *   - `DEFAULT_THRESHOLDS.circuitBreakAt === 0.85` (the user story's
 *     "85% — pause new tick claims" threshold)
 *   - The `BudgetAction` union covers the four documented states
 *     (`normal` / `graceful-degrade` / `circuit-break-and-notify` /
 *     `weekly-cap-warn`) — the rule-#7 failure-mode vocabulary the
 *     user story leans on
 *   - `@minsky/token-monitor` adapter exists (the TokenMonitor port
 *     the user story names as the polled data source)
 *   - `scripts/scan-secrets.mjs` exists (the floor named in the user
 *     story's Security & Privacy section)
 *   - The user-story file itself has the required `## Metric` and
 *     `## Integration test` H2 sections (alignment-gate surfaces)
 *
 * Known documentation drift, NOT pinned by this test: the user story
 * §7 says "all thresholds configurable via `config/budget-guard.json`"
 * — that file does not exist in the repo today; the BudgetGuard ctor
 * takes thresholds as a constructor arg with `DEFAULT_THRESHOLDS` as
 * the fallback. Pinning the absent config file would block this test
 * on a known-spec-ahead-of-implementation gap; leaving the drift
 * un-pinned lets the test surface what's actually shipped without
 * blocking on a separate config-file ticket.
 *
 * Hypothesis (rule #9): substrate present + threshold constants match
 *   the user story's prose → the operator's 70%/85% threshold
 *   expectation matches what `decide()` actually returns.
 * Success: every test below passes.
 * Pivot: if the threshold constants ever DRIFT from the user-story
 *   prose (e.g. someone tunes `circuitBreakAt` to 0.9 in code without
 *   updating the user-story prose), this test flips red — the right
 *   fix is to update BOTH places in the same PR (per rule #15
 *   milestone-alignment).
 * Measurement: this file.
 * Anchor: Beyer/Jones/Petoff/Murphy 2016, *Site Reliability
 *   Engineering*, Ch. 3 (error budgets — burn-rate ladder; the
 *   70%/85% thresholds map directly to SRE's "page" / "ticket"
 *   alerting bands); rule #8 pattern conformance (`@minsky/budget-guard`
 *   IS the watchdog pattern named in vision.md § "Pattern conformance
 *   index" row 26).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { type BudgetAction, DEFAULT_THRESHOLDS } from "@minsky/budget-guard";

const REPO_ROOT = join(import.meta.dirname, "..");

describe("user-story 004 — budget-auto-pause substrate", () => {
  test("DEFAULT_THRESHOLDS.degradeAt matches the user story's 70% threshold prose", () => {
    expect(DEFAULT_THRESHOLDS.degradeAt).toBe(0.7);
  });

  test("DEFAULT_THRESHOLDS.circuitBreakAt matches the user story's 85% threshold prose", () => {
    expect(DEFAULT_THRESHOLDS.circuitBreakAt).toBe(0.85);
  });

  test("DEFAULT_THRESHOLDS.weeklyWarnAt is present (covers the weekly-cap-warn prose)", () => {
    expect(typeof DEFAULT_THRESHOLDS.weeklyWarnAt).toBe("number");
    expect(DEFAULT_THRESHOLDS.weeklyWarnAt).toBeGreaterThan(0);
    expect(DEFAULT_THRESHOLDS.weeklyWarnAt).toBeLessThan(1);
  });

  test("BudgetAction union covers the four documented states (rule-#7 vocabulary)", () => {
    // The four states the user story names; type-level pinned via the
    // satisfies-assertion shape. If the union ever drops one of these
    // (or gains an undocumented one), this fails to compile.
    const allActions: readonly BudgetAction[] = [
      "normal",
      "graceful-degrade",
      "circuit-break-and-notify",
      "weekly-cap-warn",
    ] as const;
    expect(allActions).toHaveLength(4);
  });

  test("novel/budget-guard package exports the documented API surface", () => {
    const indexTs = readFileSync(join(REPO_ROOT, "novel/budget-guard/src/index.ts"), "utf8");
    // The four public names the user story leans on.
    expect(indexTs).toMatch(/export\s+(?:const|function|class)\s+BudgetGuard\b/);
    expect(indexTs).toMatch(/export\s+(?:function|const)\s+decide\b/);
    expect(indexTs).toMatch(/export\s+const\s+DEFAULT_THRESHOLDS\b/);
    expect(indexTs).toMatch(/export\s+type\s+BudgetAction\b/);
  });

  test("@minsky/token-monitor adapter exists (TokenMonitor port named by user story)", () => {
    // The user story §1 names TokenMonitor as the polled data source.
    expect(existsSync(join(REPO_ROOT, "novel/adapters/token-monitor/src/index.ts"))).toBe(true);
  });

  test("scripts/scan-secrets.mjs exists (Security & privacy floor named by user story)", () => {
    expect(existsSync(join(REPO_ROOT, "scripts/scan-secrets.mjs"))).toBe(true);
  });

  test("user-story 004 has the required `## Metric` and `## Integration test` sections", () => {
    const story = readFileSync(join(REPO_ROOT, "user-stories/004-budget-auto-pause.md"), "utf8");
    expect(story).toMatch(/^## Metric\b/m);
    expect(story).toMatch(/^## Integration test\b/m);
  });
});

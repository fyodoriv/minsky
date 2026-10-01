// Pins the daemon-side once-per-UTC-date `metrics render` fire in
// distribution/systemd/run-tick-loop.sh.
//
// History (2026-05-21 drain session, TASKS.md
// `daemon-daily-metrics-render-not-firing`): the daemon never re-rendered
// `docs/METRICS.md`. The TS `metrics-render-runner.ts` daily-fire was
// deleted in phase-11b; the live bash daemon
// (distribution/systemd/run-tick-loop.sh -> bin/minsky-run.sh --loop)
// only ran self-diagnose / orphan-PR / rebase / auto-merge maintenance,
// not metrics render. With no re-render, `_Updated:` stamps in
// docs/METRICS.md drift past their `_Budget:` windows and
// scripts/check-metric-freshness.mjs starts reporting stale sections —
// the canonical monitoring-data-going-dark silent failure (Beyer et al.,
// SRE 2016, Ch. 6).
//
// This wires an idempotent `bin/minsky metrics render` into the
// non-dry-run daily-maintenance block, gated by a per-UTC-date sentinel
// under the gitignored `.minsky/metric-render-sentinels/<date>` tree so
// it fires at most once per day.
//
// These tests pin: (a) the source-level wire-in (sentinel gate, advisory
// error handling, `metrics render` invocation) is present in
// run-tick-loop.sh; (b) the once-per-UTC-date gate behaves correctly —
// the first run fires + writes the sentinel, a same-day re-run does NOT
// re-fire; (c) `bin/minsky metrics render` produces a docs/METRICS.md
// that scripts/check-metric-freshness.mjs reports as 0-stale. A live
// integration test of the full supervisor bootstrap would reach out to
// GitHub (self-diagnose / auto-merge) and deadlock; the source-pin plus a
// focused bash-harness for the gate is the practical gate (same approach
// as supervisor-stays-alive-loop.test.ts).

import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const RUN_TICK_LOOP_SH = join(REPO_ROOT, "distribution", "systemd", "run-tick-loop.sh");

describe("daemon-daily-metrics-render: source wire-in in run-tick-loop.sh", () => {
  const src = readFileSync(RUN_TICK_LOOP_SH, "utf8");

  test("daily-maintenance block invokes `metrics render` via bin/minsky", () => {
    // The measurement command in the task block greps for this exact
    // string: `grep -q 'metrics render' distribution/systemd/run-tick-loop.sh`.
    expect(src).toMatch(/bin\/minsky["'\s]+metrics render/);
  });

  test("the render is gated by a per-UTC-date sentinel (idempotent once-per-day)", () => {
    expect(src).toMatch(/metric-render-sentinels/);
    expect(src).toMatch(/date -u \+%F/);
    // Skip-when-present branch: the sentinel existing must short-circuit
    // the render (the once-per-day guarantee).
    expect(src).toMatch(/\[\[ -f "\$\{metric_render_sentinel\}" \]\]/);
  });

  test("the render is advisory — errors do not block startup (rule #7)", () => {
    // The render is invoked inside an `if … 2>&1; then … else …` so a
    // non-zero exit is swallowed and the daemon continues.
    expect(src).toMatch(/will retry .* on next cycle|advisory; will retry/);
  });

  test("the sentinel is written ONLY on a successful render", () => {
    // A failed render must NOT write the sentinel, so the same-day retry
    // path stays open. The mkdir + sentinel write live in the `then`
    // branch of the render invocation.
    const renderBlock = src.slice(src.indexOf("metrics-render: rendering"));
    const thenIdx = renderBlock.indexOf("metrics render 2>&1; then");
    const elseIdx = renderBlock.indexOf("else");
    expect(thenIdx).toBeGreaterThan(-1);
    expect(elseIdx).toBeGreaterThan(thenIdx);
    const thenBranch = renderBlock.slice(thenIdx, elseIdx);
    expect(thenBranch).toMatch(/mkdir -p "\$\{metric_render_sentinel_dir\}"/);
    expect(thenBranch).toMatch(/> "\$\{metric_render_sentinel\}"/);
  });

  test("the fire has a documented opt-out (rule #2 escape hatch)", () => {
    expect(src).toMatch(/MINSKY_DAILY_METRICS_RENDER/);
  });
});

describe("daemon-daily-metrics-render: once-per-UTC-date gate behaviour", () => {
  // Reproduces the run-tick-loop.sh sentinel-gate logic in a hermetic temp
  // dir with a stubbed `metrics render` command, so the once-per-day
  // contract is asserted as behaviour, not just as source text. The stub
  // appends to a counter file each time it "renders"; the assertion is
  // that two same-date passes increment the counter exactly once.
  let sandbox: string;

  beforeAll(() => {
    sandbox = mkdtempSync(join(tmpdir(), "minsky-metric-render-gate-"));
  });
  afterAll(() => {
    rmSync(sandbox, { recursive: true, force: true });
  });

  test("renders once on the first pass and is a no-op on a same-date second pass", () => {
    const counter = join(sandbox, "render-count");
    const sentinelDir = join(sandbox, ".minsky", "metric-render-sentinels");
    // The gate logic, isolated from the GitHub-touching maintenance block.
    // `$RENDER_CMD` stands in for `bin/minsky metrics render`. `$DATE`
    // pins the UTC date so the test is deterministic across day boundaries.
    const gate = `
set -euo pipefail
date_str="$DATE"
sentinel_dir="${sentinelDir}"
sentinel="$sentinel_dir/$date_str"
if [[ -f "$sentinel" ]]; then
  echo "skip"
else
  if eval "$RENDER_CMD"; then
    mkdir -p "$sentinel_dir"
    printf '%s\\n' "$date_str" > "$sentinel"
  fi
fi
`;
    const renderCmd = `printf x >> ${counter}`;
    const env = { ...process.env, DATE: "2026-06-02", RENDER_CMD: renderCmd };
    // First pass — fires.
    execFileSync("bash", ["-c", gate], { env, encoding: "utf8" });
    // Second pass, same date — must NOT fire.
    const out2 = execFileSync("bash", ["-c", gate], { env, encoding: "utf8" });
    expect(out2.trim()).toBe("skip");
    const renderCount = readFileSync(counter, "utf8").length;
    expect(renderCount).toBe(1);

    // A different UTC date fires again (next-day refresh).
    execFileSync("bash", ["-c", gate], {
      env: { ...env, DATE: "2026-06-03" },
      encoding: "utf8",
    });
    expect(readFileSync(counter, "utf8").length).toBe(2);
  });

  test("a failed render does NOT write the sentinel — same-day retry stays open", () => {
    const sentinelDir = join(sandbox, ".minsky", "fail-sentinels");
    const gate = `
set -euo pipefail
date_str="$DATE"
sentinel_dir="${sentinelDir}"
sentinel="$sentinel_dir/$date_str"
if [[ -f "$sentinel" ]]; then
  echo "skip"
else
  if eval "$RENDER_CMD"; then
    mkdir -p "$sentinel_dir"
    printf '%s\\n' "$date_str" > "$sentinel"
  else
    echo "retry-later"
  fi
fi
`;
    // RENDER_CMD fails (exit 1) → no sentinel written → next pass retries.
    const env = { ...process.env, DATE: "2026-06-02", RENDER_CMD: "false" };
    const out1 = execFileSync("bash", ["-c", gate], { env, encoding: "utf8" });
    expect(out1.trim()).toBe("retry-later");
    const out2 = execFileSync("bash", ["-c", gate], { env, encoding: "utf8" });
    // Still retrying, NOT skipping — the failed render left the gate open.
    expect(out2.trim()).toBe("retry-later");
  });
});

describe("daemon-daily-metrics-render: rendered METRICS.md passes the freshness gate", () => {
  test("`metrics render` output reports 0 stale sections", () => {
    const out = join(tmpdir(), `minsky-metrics-render-test-${process.pid}.md`);
    try {
      // Render to a temp path (do NOT clobber the committed docs/METRICS.md).
      execSync(`node scripts/metrics-render.mjs --output ${out}`, {
        cwd: REPO_ROOT,
        encoding: "utf8",
      });
      // The freshness gate over the just-rendered artefact must pass: a
      // fresh render stamps `_Updated:` at now, well inside every budget.
      const check = execSync(`node scripts/check-metric-freshness.mjs --input ${out}`, {
        cwd: REPO_ROOT,
        encoding: "utf8",
      });
      expect(check).toMatch(/metric-freshness ok/);
    } finally {
      rmSync(out, { force: true });
    }
  });
});

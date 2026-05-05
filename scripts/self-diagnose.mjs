#!/usr/bin/env node
// Pattern: invariant-runner (Liskov 1987 — invariants as the substrate of
// correctness; Brilliant et al. 1990 — N-version programming, where one
// version probes the other for disagreement). Self-diagnose probes the
// running Minsky for invariant violations a normal supervisor wouldn't
// surface; findings escalate via TASKS.md so the parent (`/next-task`)
// picks them up automatically.
//
// Source: 2026-05-04 dogfood debug — TokenMonitor was summing
// cache_read_input_tokens at full rate, pegging every plan to 100%, and
// every iteration logged `budget-paused`. The bug was visible in
// supervisor logs but no automation noticed; the operator did. The
// self-diagnose pattern asks: what invariant would have caught that?
// → "if all 4 plans read 100% used, the sum is wrong". Encoded below.
//
// Conformance: full — pure runner + injectable invariants (rule #2
// Strategy seam); deterministic given the same probe outputs (rule
// #10); each invariant carries its own anchor + suggested task title +
// suggested fix (rule #9 — pre-registered hypothesis at the moment of
// detection, not after).
//
// Pivot (rule #9): if the invariants produce ≥1 false-positive task per
// week (e.g., a transient probe failure during start-up that resolves
// on retry), add a `consecutiveFailures: 2` retry gate before
// surfacing — the false-positive rate, not the architecture, is what
// would change.

import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { MaciekTokenMonitor, PLAN_CAPS } from "@minsky/token-monitor";

const execFileAsync = promisify(execFile);

/**
 * @typedef {object} InvariantOk
 * @property {string} id
 * @property {true} ok
 *
 * @typedef {object} InvariantViolation
 * @property {string} id
 * @property {false} ok
 * @property {string} evidence — human-readable proof of the violation
 * @property {string} suggestedTaskTitle — one-line title for TASKS.md
 * @property {string} suggestedFix — one-paragraph hypothesis for the fix
 *
 * @typedef {InvariantOk | InvariantViolation} InvariantResult
 *
 * @typedef {() => Promise<InvariantResult>} Invariant
 */

/**
 * Pure runner — runs every invariant; returns the violations list.
 * Exceptions inside an invariant become violations with `evidence` =
 * the error message (rule #7 — graceful-degrade, explicit not silent).
 *
 * Tests inject a synthetic `invariants` array; production calls
 * {@link defaultInvariants}.
 *
 * @param {readonly Invariant[]} invariants
 * @returns {Promise<InvariantViolation[]>}
 */
export async function runInvariants(invariants) {
  /** @type {InvariantViolation[]} */
  const findings = [];
  for (const invariant of invariants) {
    /** @type {InvariantResult} */
    let result;
    try {
      result = await invariant();
    } catch (err) {
      const id =
        /** @type {{ invariantId?: string, name?: string }} */ (invariant).invariantId ??
        invariant.name ??
        "<anonymous>";
      const message = err instanceof Error ? err.message : String(err);
      findings.push({
        id,
        ok: false,
        evidence: `invariant threw: ${message}`,
        suggestedTaskTitle: `self-diagnose: ${id} probe is itself broken`,
        suggestedFix: `The probe for invariant ${id} threw before it could decide. Either the probe is wrong or its inputs (env, file paths, network) drifted. Read the probe at scripts/self-diagnose.mjs and the throwing site in the tracelog above.`,
      });
      continue;
    }
    if (!result.ok) findings.push(result);
  }
  return findings;
}

/**
 * @typedef {import("../novel/adapters/token-monitor/dist/index.d.ts").TokenSnapshot} TokenSnapshot
 *
 * @typedef {object} TokenMonitorInvariantOpts
 * @property {(plan: "pro"|"max5"|"max20"|"custom") => Promise<TokenSnapshot>} snapshotPerPlan
 */

/**
 * Seed invariant: when MaciekTokenMonitor reports every plan at 100 %
 * used, the sum is almost certainly wrong (the user can't simultaneously
 * have over-spent pro+max5+max20+custom — those plans have ~12× spread).
 *
 * Concretely: we read the live snapshot for each plan and check whether
 * any plan has remaining > 0. If all four are pegged to 0, the
 * active-block sum is overshooting in a unit-mismatched way.
 *
 * Strategy seam: `snapshotPerPlan` is injected so tests can drive the
 * decision function with synthetic snapshots without touching disk.
 *
 * @param {TokenMonitorInvariantOpts} opts
 * @returns {Invariant}
 */
export function tokenMonitorNotAllPeggedInvariant(opts) {
  const { snapshotPerPlan } = opts;
  /** @type {Invariant} */
  const fn = async () => {
    /** @type {readonly ("pro"|"max5"|"max20"|"custom")[]} */
    const planNames = ["pro", "max5", "max20", "custom"];
    /** @type {{ plan: "pro"|"max5"|"max20"|"custom", remaining: number }[]} */
    const snapshots = [];
    for (const plan of planNames) {
      const s = await snapshotPerPlan(plan);
      snapshots.push({ plan, remaining: s.tokensRemainingInWindow });
    }
    const allPegged = snapshots.every((s) => s.remaining === 0);
    if (!allPegged) return { id: "token-monitor-not-all-pegged", ok: true };
    const evidence = snapshots
      .map((s) => `${s.plan}: cap=${PLAN_CAPS[s.plan]}, remaining=${s.remaining}`)
      .join("; ");
    return {
      id: "token-monitor-not-all-pegged",
      ok: false,
      evidence,
      suggestedTaskTitle:
        "token-monitor reports every plan at 100% used — sum or cap is unit-mismatched",
      suggestedFix:
        "MaciekTokenMonitor is summing more tokens than the 5h cap allows on every plan simultaneously. Two known causes: (1) cache_read_input_tokens being summed at full rate (fixed in PR #155 — verify the build includes it), or (2) PLAN_CAPS still calibrated to Maciek upstream's outdated estimates (max20=220k vs Anthropic's actual ~50M+/5h). Inspect the active-block raw token breakdown via `node scripts/inspect-active-block.mjs` (or the inline probe in PR #155's commit body) and either patch the sum or recalibrate PLAN_CAPS.",
    };
  };
  /** @type {Invariant & { invariantId?: string }} */ (fn).invariantId =
    "token-monitor-not-all-pegged";
  return fn;
}

/**
 * @typedef {object} ClaudeBinaryInvariantOpts
 * @property {(name: string) => Promise<{ ok: boolean }>} probe — returns
 *   `{ ok: true }` when the binary is reachable from the current PATH;
 *   `{ ok: false }` otherwise. Tests inject a fake; production calls
 *   `claude --version`.
 */

/**
 * Invariant: the `claude` CLI must be reachable from the supervisor's
 * PATH. The tick-loop spawns `claude --print` per iteration; a missing
 * binary triggers `ENOENT`, which the daemon surfaces as an unhandled
 * exception → process exit → launchd respawn loop at `ThrottleInterval`
 * cadence. This invariant catches the failure at boot, so the operator
 * sees a one-line task instead of a 12-times-per-minute respawn loop.
 *
 * Live observed 2026-05-04 during the post-#158 dogfood restart: the
 * launchd minimal PATH didn't include `~/.local/bin`, so the CLI wasn't
 * found and tick-loop crashed on its first spawn.
 *
 * Strategy seam: `probe` is injected so tests can simulate
 * available/unavailable without touching the real CLI.
 *
 * @param {ClaudeBinaryInvariantOpts} opts
 * @returns {Invariant}
 */
export function claudeBinaryReachableInvariant(opts) {
  const { probe } = opts;
  /** @type {Invariant} */
  const fn = async () => {
    const result = await probe("claude");
    if (result.ok) return { id: "claude-binary-reachable", ok: true };
    return {
      id: "claude-binary-reachable",
      ok: false,
      evidence:
        "the `claude` CLI is not reachable from the supervisor's PATH; spawning it raises ENOENT.",
      suggestedTaskTitle:
        "supervisor cannot find the `claude` CLI on its PATH — every iteration crashes",
      suggestedFix:
        "Locate the `claude` binary (`which claude` from your shell) and ensure its directory is on the launchd / systemd-user PATH. The supervisor bootstrap (`distribution/systemd/run-tick-loop.sh`) extends PATH with common installer locations (~/.local/bin, ~/.npm-global/bin, /opt/homebrew/bin, /usr/local/bin) — if your install lives elsewhere, add it to that loop. Without this fix the daemon ENOENT-crashes on first iteration and launchd respawns it at ThrottleInterval (5s) indefinitely.",
    };
  };
  /** @type {Invariant & { invariantId?: string }} */ (fn).invariantId = "claude-binary-reachable";
  return fn;
}

/**
 * Default probe: spawns `<name> --version` and resolves based on exit code.
 *
 * @param {string} name
 * @returns {Promise<{ ok: boolean }>}
 */
async function spawnVersionProbe(name) {
  try {
    await execFileAsync(name, ["--version"], { timeout: 5_000 });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/**
 * Production wiring — the invariants the supervisor probes at start-up.
 * Each invariant closes over its production data source; tests bypass
 * this by calling {@link runInvariants} directly with synthetic
 * invariants.
 *
 * @returns {readonly Invariant[]}
 */
export function defaultInvariants() {
  const configDir = join(homedir(), ".claude");
  /** @type {(plan: "pro"|"max5"|"max20"|"custom") => Promise<TokenSnapshot>} */
  const snapshotPerPlan = async (plan) => new MaciekTokenMonitor({ configDir, plan }).snapshot();
  return [
    tokenMonitorNotAllPeggedInvariant({ snapshotPerPlan }),
    claudeBinaryReachableInvariant({ probe: spawnVersionProbe }),
  ];
}

/**
 * Render findings as a TASKS.md-shaped block per finding. Per the
 * file-level policy "every new task entry MUST include … Measurement
 * and Pivot threshold", we encode both — the measurement is the probe
 * itself; the pivot is "if the same finding fires for >7 consecutive
 * days, the invariant is wrong, not the system".
 *
 * @param {readonly InvariantViolation[]} findings
 * @param {string} nowIso
 * @returns {string}
 */
export function findingsToTasksMd(findings, nowIso) {
  if (findings.length === 0) return "";
  const blocks = findings.map((f) => {
    const id = `self-diagnose-${f.id}-${nowIso.slice(0, 10)}`;
    return [
      `- [ ] \`${id}\` — ${f.suggestedTaskTitle}`,
      `  - **ID**: ${id}`,
      `  - **Tags**: self-detected, ${f.id}`,
      "  - **Estimate**: 1d",
      `  - **Hypothesis**: ${f.suggestedFix}`,
      `  - **Evidence**: ${f.evidence}`,
      `  - **Surfaced-by**: \`scripts/self-diagnose.mjs\` invariant \`${f.id}\` at ${nowIso}.`,
      `  - **Measurement**: re-running \`node scripts/self-diagnose.mjs --json\` no longer surfaces invariant \`${f.id}\` in the findings array. Concretely: \`node scripts/self-diagnose.mjs --json | jq -e '[.[] | select(.id == "${f.id}")] | length == 0'\` exits 0.`,
      "  - **Pivot**: if the same finding fires for >7 consecutive days despite attempted fixes, the invariant is wrong (false-positive); audit and adjust the probe rather than chase the underlying state.",
      "  - **Anchor**: rule #9 (pre-registered HDD); Liskov 1987 (invariants as the substrate of correctness).",
      "",
    ].join("\n");
  });
  return blocks.join("\n");
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const findings = await runInvariants(defaultInvariants());
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(findings, null, 2)}\n`);
  } else if (findings.length === 0) {
    process.stdout.write("self-diagnose: all invariants pass\n");
  } else {
    for (const f of findings) {
      process.stdout.write(`✗ ${f.id}: ${f.evidence}\n`);
      process.stdout.write(`  fix: ${f.suggestedFix}\n`);
    }
    if (process.argv.includes("--write-tasks-md")) {
      const block = findingsToTasksMd(findings, new Date().toISOString());
      process.stdout.write(`\n${block}`);
    }
  }
  process.exit(findings.length === 0 ? 0 : 1);
}

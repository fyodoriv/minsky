<!-- scope: human-approved namespace README for novel/observer/ — required by rule #1 (justification for the new novel/ namespace) AND rule #7 (chaos coverage at the namespace level). The TASKS.md task `agents-can-self-heal-minsky-m1-13` already lists this file in its Files block; this comment is the explicit rule-12 opt-out. -->
<!-- rule-1: existing SRE / chaos-engineering tooling (litmuschaos, chaos-mesh, gremlin, ChaosToolkit, k6-disruptor) rejected because: those frameworks inject failures into LIVE pod/container infrastructure to test resilience under chaos — they do NOT (a) detect-and-fix categorical failure modes from per-host agent-runtime symptoms (the stale-pid / missing-node-modules / stale-tsbuildinfo / stuck-command catalogue), (b) provide a tight `detect → apply → verify` 3-method API with seam-injected fs/exec for hermetic test execution, or (c) write a structured JSONL ledger keyed by failure_class for downstream MTTR computation against a per-host `.minsky/` substrate. The observer package wraps Beyer SRE 2016 Ch. 6 + Ch. 11 patterns (MTTR as SLI, troubleshooting loop) directly onto the agent-iteration loop rather than the cluster-level deploy loop those frameworks target. The skill-plugin side (`skill-plugins/observer/minsky/SKILL.md` §4) is the operator-facing catalogue; this `novel/observer/heals/` workspace is the executable substrate. A generic "watch and react" tool (systemd-restart-on-failure, monit, supervisord) operates at the process level only — it cannot read `.minsky/heal-events.jsonl` or compute per-failure-class MTTR; we already use supervisord-style restart via launchd / systemd at the daemon level (vision.md row 75 — `distribution/launchd/com.minsky.daemon.plist` / `distribution/systemd/minsky-daemon.service`). The heals substrate is the layer ABOVE those — it restores invariants the supervisor restart did NOT fix (a stale pid file persists across restart; a missing node_modules persists across pnpm install retry; a stale .tsbuildinfo persists across `tsc -b` rerun). Pattern conformance row 89 in vision.md cites this dependency direction explicitly. -->

# `novel/observer/` — Observer substrate

Top-level namespace for the **Observer skill** (`skill-plugins/observer/minsky/SKILL.md`) and its executable helpers. Currently hosts:

- **`heals/`** — `@minsky/observer-heals` workspace: 4 automated heal helpers + MTTR ledger + reporter (phase 1 of M1.13). See [`heals/README.md`](heals/README.md).

Future sub-packages (phase 2 / 3 of M1.13):

- (planned) `signals/` — typed signal parsers for `daemon.log` / stderr → catalogued failure classes
- (planned) `mttr-fleet/` — cross-host MTTR aggregation analogous to `fleet-stability-report.mjs`

## Failure modes & chaos verification

Per constitutional rule #7. The Observer substrate's failure modes are tested at the package level (`heals/test/chaos/heal-catalogue-mttr.test.ts`); this top-level README documents the namespace-level invariants that compose across future sub-packages.

- **Steady-state hypothesis (namespace-wide)**: every automated heal substrate under `novel/observer/` exposes `detect → apply → verify` with seam-injected I/O, writes only to `.minsky/` / build artifacts, and emits a HealEvent row to `.minsky/heal-events.jsonl`.
- **Blast radius**: each sub-package is independently testable in `mkdtempSync` isolation. No global state. Failure in one helper does not impact another.
- **Operator escape hatch**: `MINSKY_DISABLE_AUTO_HEAL=1` disables the heal catalogue daemon-wide; advisory recipes stay in `skill-plugins/observer/minsky/SKILL.md` §4 for manual execution.

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | Sub-package boundary leak (one helper writes outside its blast radius) | hypothetical: a future helper attempts to write to source code | CI lint blocks the PR (write-path lint planned in `scripts/check-heal-blast-radius.mjs`) | Per-helper invariants asserted in `novel/observer/heals/src/heal-stale-pid.test.ts` (no write outside `pidFilePath`) and the other paired tests; namespace-level chaos verification at `novel/observer/heals/test/chaos/heal-catalogue-mttr.test.ts` |
| 2 | Stale heal-events.jsonl growth across years | Long-running daemon accumulates >N MB ledger | Reporter only reads 30d window; older entries are harmless (rotation deferred to follow-up) | Window-filter assertion in `novel/observer/heals/src/ledger.test.ts` (monotonic append) plus `scripts/heal-mttr-report.test.mjs` `"only counts events inside the window"` test |
| 3 | Cross-sub-package race (two helpers in the same iteration target the same `.minsky/` path) | Two helpers' apply() run concurrently | Per-helper advisory lock at `~/.minsky/heal-locks/<name>.lock`; staleness rule = pid dead OR >10min old (documented in plan Risks) | `novel/observer/heals/test/chaos/heal-catalogue-mttr.test.ts` `"CHAOS_CASES count matches automated catalogue size"` test asserts the catalogue/chaos cross-reference; the concrete race test lands with the 2nd sub-package |

## Relationship to `skill-plugins/observer/minsky/`

The Skill file is the operator-facing catalogue + escalation playbook. This `novel/observer/` package is the executable substrate — the helpers the Skill catalogue references for `automated` rows.

Catalogue lookup:

1. Operator (or agent) sees a failure signal.
2. They consult `skill-plugins/observer/minsky/SKILL.md` §4 "Heal catalogue".
3. If the row's Status is `automated`, they invoke the corresponding helper from `novel/observer/heals/` directly.
4. If Status is `operator-recipe`, they run the recipe text manually.
5. If Status is `blocked-by-policy`, they escalate (do NOT automate).

## See also

- [`skill-plugins/observer/minsky/SKILL.md`](../../skill-plugins/observer/minsky/SKILL.md) — the operator-facing Skill (catalogue, restart policy, escalation)
- [`user-stories/007-agent-self-heals-catalogued-failures.md`](../../user-stories/007-agent-self-heals-catalogued-failures.md) — the rule-#3 GWT anchor
- [`docs/plans/agents-can-self-heal-minsky-m1-13.md`](../../docs/plans/agents-can-self-heal-minsky-m1-13.md) — the reviewer-approved plan for phase 1
- [`vision.md`](../../vision.md) row 89 — pattern conformance citation

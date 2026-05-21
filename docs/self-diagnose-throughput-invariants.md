<!-- pattern: see vision.md § "Pattern conformance index" rows tagged `rule #9` (pre-registered HDD) and Liskov 1987 (invariants as the substrate of correctness) — this doc is the operator-facing explanation of the throughput-class self-diagnose invariants that TASKS.md `daemon-self-detect-throughput-issues` ships. -->

# Self-diagnose throughput invariants

> The daemon should notice its own low-throughput patterns before the operator does. `scripts/self-diagnose.mjs` runs a set of throughput-class invariants on every supervisor boot; each violation renders a P0 task block that the existing `scripts/drain-concerns.mjs` pipeline files autonomously. If this doc and the script disagree, the script is right.

This task exists because the operator authored `daemon-pre-pr-lint-gate` and `daemon-fix-own-pr-on-ci-failure` by hand after watching 88 iterations of low throughput, and then said: *"I expect minsky to come up with these issues itself."* The self-diagnose substrate (PR #156, `scripts/self-diagnose.mjs`) is the natural surface — these invariants extend it with throughput-class checks so the gap between "an inefficiency exists" and "a task block exists for it" drops from operator-author-time (hours–days) to ≤1 day (the rolling-window measurement frequency).

## The invariants

Each is a pure `(opts) => () => InvariantResult` registered in `defaultInvariants()`. Each fires → `findingsToTasksMd` renders a self-contained P0 task block.

| Invariant id | Fires when |
| --- | --- |
| `daemon-noop-iteration-rate-too-high` | >3 consecutive iterations on the same task with no commit |
| `daemon-pr-stuck-on-ci-failure` | ≥2 failed CI runs on a daemon PR with no daemon-authored fix commit |
| `daemon-iteration-vs-shipped-ratio` | rolling 7d shipped-PR-count / iteration-count below the floor (≈1 PR per 20 iterations) |
| `daemon-in-flight-pr-collision` | ≥2 open PRs with overlapping file-sets for the same task-id |
| `daemon-task-id-staleness` | the daemon still has work in flight referencing a task block that no longer exists in TASKS.md |

(Additional adjacent invariants — runtime-exceeded, lint-pass-rate, stuck-dirty, scope-explosion — live in the same registry and follow the same render/file path.)

## The autonomous-filing path (why the `p0` tag is load-bearing)

Detection alone is not the acceptance bar — the finding must become a **daemon-pickable P0 task** without operator involvement. The path:

```text
supervisor boot
  └─ node scripts/self-diagnose.mjs --json        (distribution/systemd/run-tick-loop.sh)
        └─ findingsToTasksMd(findings, nowIso)     renders one task block per violation
              └─ block written to the drain pending/ dir
                    └─ scripts/drain-concerns.mjs
                          ├─ parsePriority(block)  ── /\b(p[0-3])\b/i  on the **Tags** line
                          │     └─ no match → block moved to invalid/  ❌ finding dropped silently
                          │     └─ "p0"    → "## P0"                   ✓ routed
                          └─ insertIntoTasksMd(block, "## P0")         filed at end of the P0 section
                                └─ novel/tick-loop pickTask → daemon picks it up next iteration
```

The contract is narrow and brittle: `drain-concerns.mjs` decides a block's priority section **solely** by matching `/\b(p[0-3])\b/i` against its `**Tags**:` line. The rendered Tags line therefore **must lead with `p0`**:

```text
  - **Tags**: p0, self-detected, <invariant-id>
```

Before this was fixed the line read `self-detected, <invariant-id>` with no priority tag — `parsePriority` returned `null`, the drainer moved every finding to `invalid/`, and the daemon could detect a throughput issue but never file it. The contract is now pinned by a test in `scripts/self-diagnose.test.mjs` ("emits a p0 priority tag the drain-concerns pipeline routes to ## P0") so a future edit that drops the tag fails loudly instead of silently re-breaking autonomous filing.

## Measurement & pivot

- **Measurement**: `node scripts/self-diagnose.mjs --json | jq '[.[] | select(.id | startswith("daemon-"))] | length'` — the count of throughput-class violations on the live supervisor. 0 = healthy; ≥1 = a daemon self-improvement task is needed (and the invariant has filed it).
- **Pivot** (rule #9): if the invariants false-positive ≥20%/week (a legitimately long-running task flagged as deadlock), tighten the thresholds or add per-task-class exclusions. Do not retire the architecture; tune it.
- **Anchor**: Liskov 1987 (invariants as the substrate of correctness); rule #9 (each invariant pre-registered with its hypothesis + threshold); the operator's 2026-05-05 directive "I expect minsky to come up with these issues itself".

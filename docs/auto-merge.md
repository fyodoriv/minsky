# Auto-merge

Minsky runs an autonomous daemon that opens PRs against a host repo on every iteration. Without an automatic merge path, those PRs pile up monotonically — the 2026-05-20 backlog audit found 49 open PRs accumulated over ~4 days because nothing closed the loop between "PR opened" and "PR landed in main".

The auto-merge feature closes that loop. Every 5 minutes, a supervisor-managed periodic task runs the existing `scripts/local-gate-merge.mjs` script against the daemon's open PRs. Greens land in main; reds stay open with their gate verdict logged.

## Default behaviour

**For the minsky repo itself (the dogfood case):** ON by default. `setup.sh --dogfood` installs the auto-merge unit alongside the other supervisor children (tick-loop, budget-guard, watchdog). Rule #16 — default by default.

**For other repos minsky operates on:** OFF by default. The supervisor unit is only installed if the operator explicitly enables it. This is the "destructive operations require explicit consent" boundary — auto-merging PRs against someone else's repo without their consent would be unacceptable.

## What gets merged

The gate runs `local-gate-merge.mjs --no-review --limit=10` per cycle. That means per-cycle:

- **Pick** up to 10 open MERGEABLE non-CONFLICTING non-draft PRs targeting `main` (the existing `pickGateCandidates` filter).
- **Vet** each one in a scratch `git clone --shared` worktree: rebase onto current `main`, run `pre-pr-lint --stage=full` (the full 22-check lint stack including vitest, typecheck, biome, every rule lint).
- **Merge** if the gate is green: `gh pr merge <N> --squash --admin`.
- **Skip** if red, with the failed step recorded in the ledger at `.minsky/local-gate-merge.jsonl`.

`--no-review` skips the optional Claude Opus brain layer. The operator's directive (2026-05-20) was explicit: "without reviews if everything else passes" — the deterministic gate IS sufficient for the dogfood case.

## Schedule

Every 5 minutes from supervisor-target activation. The supervisor fires the unit at boot + 1 min (drain whatever queued during downtime), then every 5 min from previous-start. Systemd uses `OnUnitActiveSec=5min` with `RandomizedDelaySec=30s`; launchd uses `StartInterval=300`.

A long cycle (>5 min) doesn't push subsequent cycles farther apart — the next cycle starts 5 min after the previous one *started*, even if the previous one is still running. Both schedulers serialise concurrent invocations of the same unit so the gate doesn't race itself.

## Opt-out

Three escape hatches, in order of granularity:

| Path | Effect | When to use |
|---|---|---|
| `MINSKY_AUTO_MERGE=off` in the operator's shell profile | Disables auto-merge for the next cycle; the runner exits with `auto-merge disabled` and returns 0. | Temporary disable for one debugging session. |
| `MINSKY_AUTO_MERGE=off` in `~/.minsky/config.json` | Same effect, persisted across reboots. | Persistent per-machine disable without removing the supervisor unit. |
| `launchctl bootout gui/$UID com.minsky.auto-merge` (macOS) / `systemctl --user disable --now minsky-auto-merge.timer` (Linux) | Removes the unit from the supervisor entirely. | Permanent disable + reclaim the disk space the plist/timer occupies. Rerun `setup.sh --dogfood` to reinstall. |

## What it does NOT do

- **Doesn't merge drafts.** Drafts are explicitly excluded by `pickGateCandidates`.
- **Doesn't merge CONFLICTING PRs.** The `mergeable === "CONFLICTING"` filter drops them; they stay open until the author rebases.
- **Doesn't re-vet a PR within the same cycle.** If `gh pr list` returns 10 PRs, the gate processes those 10 in order; the next cycle is a fresh `gh pr list` against the current state of main.
- **Doesn't auto-revert after merge.** If a green-vetted PR somehow breaks main after merge, the next iteration's `pre-pr-lint --stage=full` (run by the inner tick-loop daemon) catches it on the next PR's vet. Hardened post-merge regression revert is filed as a P0 follow-up (`auto-merge-post-merge-regression-revert`).

## Logs

Both launchd and systemd write to `~/.minsky/auto-merge.log`. The runner script also tees each cycle's start/end timestamps + the `local-gate-merge.mjs` stdout for forensic clarity.

The per-PR ledger lives at `.minsky/local-gate-merge.jsonl` (one line per cycle, `{ts, merged: [pr#s], skipped: count}`). `node scripts/local-gate-merge.mjs --self-metric` aggregates the ledger into a rolling success-rate metric.

## Why a periodic task and not a daemon-iteration hook

The natural place to wire this is inside `runDaemon`'s post-iteration flow (after `maybeRunPrePrLintGate`). That was the original design (filed as task `daemon-auto-merge-own-prs` for the per-iteration sync path). The launchd/systemd periodic-task substrate is simpler, hits the same outcome, and decouples auto-merge from the worker spawn cycle — a hung agent in `runOneIteration` doesn't block the next auto-merge cycle.

Both paths are valid; the periodic-task path ships first because it's a smaller diff and a smaller chaos surface. The per-iteration hook is a P1 follow-up if measurement shows the 5-min cadence introduces unacceptable PR-open-to-merge latency.

## Anchors

- Beyer SRE 2016 ch. on toil-reduction — automate every step that can be automated; humans are for novel work.
- Borg/Bashir/Burns/Hightower *Designing Distributed Systems* 2017 — the periodic-task pattern, supervisor-as-cadence-kernel.
- vision.md rule #6 (stay alive — stability features default-on with opt-OUT) — the auto-merge unit is part of the supervisor's stability contract; without it, the "ship features autonomously" claim is half a rule.
- vision.md rule #16 (default by default — never hide a useful behaviour behind an opt-in flag) — the dogfood case ships the unit ON.

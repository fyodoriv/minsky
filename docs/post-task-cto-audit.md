# Post-task CTO audit — operator runbook

After every successfully completed daemon iteration that ships a real change, the supervisor fires a second `claude --print` invocation in **CTO mode** to identify the single highest-leverage next task and file it as a TASKS.md block via PR. This is the offensive counterpart to `daemon-self-detect-throughput-issues` (defensive — catch failure classes): every ship surfaces what would be the next leverage-multiplying improvement.

Substrate ships in `novel/tick-loop/src/post-task-cto-audit.ts` (pure builder + gate + I/O wrapper) and `novel/tick-loop/src/cto-audit-cli-wiring.ts` (file-backed lock + git/gh signals collector). Wire-in lives in `novel/tick-loop/src/daemon.ts` (`maybeRunCtoAudit`); CLI construction lives in `novel/tick-loop/bin/tick-loop.mjs`.

## Enable

Default is **OFF**. Set `MINSKY_CTO_AUDIT_ENABLE=1` (or `true`) in the supervisor environment to opt in:

```bash
launchctl setenv MINSKY_CTO_AUDIT_ENABLE 1   # macOS / launchd
systemctl --user set-environment MINSKY_CTO_AUDIT_ENABLE=1   # Linux / systemd-user
```

Then restart the supervisor unit. The CLI prints `[tick-loop] CTO audit wired (file-backed lock + git/gh signals)` on startup when the seam is constructed; `[tick-loop] no CTO audit wired (...)` otherwise.

## Disable per-iteration

`MINSKY_CTO_AUDIT=off` short-circuits the gate inside `runCtoAudit` even when the seam is wired — useful when the operator wants to land a sequence of small ships without an audit fire after each:

```bash
MINSKY_CTO_AUDIT=off pnpm minsky:setup
```

Any value other than `off` (including unset) leaves the audit armed.

## What fires, what skips

The audit runs only when the iteration:

- `status === "completed"` (failed / no-task / paused / budget-paused / missing-tasks-md all skip)
- shipped a real change (commit on the branch OR a PR URL in stdout — pure-noop iterations skip even when completed)
- has a `taskId` whose lock file at `<MINSKY_HOME>/.minsky/cto-audit-lock/<taskId>` does not yet exist (cap of one audit per task; the lock survives daemon restart)
- is not itself a CTO-audit iteration (`completedTaskId === "cto-audit"` short-circuits to prevent recursion)

Each invocation emits a `tick-loop.cto-audit` span with `audit.outcome` (`"ran"` or `"skipped"`), `audit.skip_reason` (`"gate-rejected"` / `"no-recurse"` / `"lock-held"`), and on `"ran"` the `audit.exit_code` + `audit.duration_ms`.

## Audit outputs

The CTO-mode prompt instructs the spawned `claude --print` to:

1. Open one PR per ship on a branch named `audit/<UTC-date>-<completed-task-id>` (e.g. `audit/2026-05-05-canonical-metric-list-per-repo`).
2. Label the PR `minsky:cto-audit` (creating the label idempotently if missing).
3. Write 1–3 task blocks into TASKS.md with full rule-#9 substrate (Hypothesis / Success / Pivot / Measurement / Anchor) at:
   - **P0** if the leverage is mechanical (CI lint, automation that removes operator babysitting)
   - **P1** if it's a feature
   - **P2** if it's docs / polish
4. Refuse to file vanity-metric tasks (Ries 2011 — counts that always go up: LOC, commits, hours, tasks-in-flight).
5. Say so explicitly + stop if no high-leverage task is visible (no fabrication).

The label is load-bearing for the success metric (see below); a missing label silently zeroes the audit's pre-registered measurement. The CI gate `cto-audit-pr-conventions` (`scripts/check-cto-audit-pr-conventions.mjs`) enforces the audit-branch ↔ label biconditional on every PR, so drift surfaces before merge rather than as a silent zero in the weekly query.

## Monitor

The audit's pre-registered success metric is *PR throughput at the right cadence*. Operator-facing query:

```bash
pnpm cto-audit:metrics
```

The script (`scripts/cto-audit-metrics.mjs`, paired tests in `scripts/cto-audit-metrics.test.mjs`) fires three `gh pr list --label minsky:cto-audit` calls in parallel and prints both verdicts side-by-side: rolling 7d created (`≥ 1` per week) and rolling 28d ship-rate (`merged / created ≥ 0.30`). The thresholds are pinned as exported constants so a typo in the query becomes a test break, not a 7-day silent zero — which is the failure mode the script exists to prevent (Munafò et al. 2017's pre-registration discipline only works when the post-hoc query can actually see the artefacts it was committed to count).

Raw `gh` invocations, in case the script is unavailable (offline / cold-checkout) and the operator needs to run the queries by hand:

```bash
# ≥1 audit-filed PR per week (rolling 7d)
gh pr list --label minsky:cto-audit --state all \
  --search "created:>$(date -v-7d -u +%Y-%m-%d)" \
  --json number --jq 'length'

# ≥30% of audit-filed PRs ship within 4 weeks (signal that the CTO-mode picked real leverage)
merged=$(gh pr list --label minsky:cto-audit --state merged \
  --search "merged:>$(date -v-28d -u +%Y-%m-%d)" --json number --jq 'length')
total=$(gh pr list --label minsky:cto-audit --state all \
  --search "created:>$(date -v-28d -u +%Y-%m-%d)" --json number --jq 'length')
[ "$total" -gt 0 ] && echo "scale=2; $merged / $total" | bc
```

Span dashboards (when OTEL is wired) chart the audit firing-rate, skip-reason distribution, and exit-code distribution from the `tick-loop.cto-audit` span family.

## Tune (don't retire)

The architecture is sound; only the prompt template (`CTO_PROMPT_HEADER` in `post-task-cto-audit.ts`) needs tuning when the audit drifts. Two soft-pivot signals:

- **Over-eager** (>5 audit-filed PRs/day, operator overload): tighten the "single highest-leverage" framing in the prompt header. Add explicit guard against filing more than one block per iteration.
- **Under-eager** (0 audit-filed PRs/week sustained): add explicit "find at least one" framing. Loosen the "refuse to fabricate" rule so genuine small wins surface.

**Hard-pivot trigger**: 4 consecutive weeks with <1 audit-filed PR that ships → retire and replace with operator-curated weekly review. Don't tune the prompt indefinitely; the architecture's premise is that compounding self-improvement is mechanically reachable, and 4 weeks of zero is the falsifying signal.

## Debug

The most common operator-side question is "why didn't the audit fire after iteration N?"

1. Tail the supervisor log: `tail -200 .minsky/tick-loop.out.log | grep tick-loop.cto-audit`. The `audit.skip_reason` attribute names the gate that blocked it.
2. Inspect the lock dir: `ls .minsky/cto-audit-lock/`. Each file's name is the `completedTaskId` of an already-audited task; presence is the cap. Removing a file forces the next iteration on that task to fire a fresh audit.
3. Confirm the seam is wired: the supervisor's startup log prints `[tick-loop] CTO audit wired (...)` when `MINSKY_CTO_AUDIT_ENABLE=1` is set. Absence of that line = the seam was not constructed = no audits will fire even after `MINSKY_CTO_AUDIT=off` is unset.

If the audit ran but produced no PR, inspect the spawn's `stderrTail` in the `tick-loop.cto-audit` span — `gh` rate-limit / offline / unauthenticated states cause the spawned audit to abort cleanly without opening a PR. Graceful-degrade is the documented contract (rule #7).

## See also

- `novel/tick-loop/README.md` § "Post-task CTO audit (rule #9 — compounding self-improvement)" — developer/architecture reference.
- `novel/tick-loop/src/post-task-cto-audit.ts` — pure brief + gate + I/O wrapper (with paired tests).
- `novel/tick-loop/src/cto-audit-cli-wiring.ts` — file-backed lock + signals collector (with paired tests).
- TASKS.md `post-task-cto-audit` — the umbrella task block carrying the rule-#9 substrate.
- `scripts/cto-audit-metrics.mjs` — versioned pre-registered measurement query (`pnpm cto-audit:metrics`).

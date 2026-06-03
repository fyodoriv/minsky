# Orchestrator fan-out — brain vs hands

This file exists to explain *why* Minsky pins a process role before it spawns,
and *what fails* when the pin leaks. It is the design rationale for the
`claude-orchestrator-local-worker-fanout` task — the throughput-per-dollar lever
that lets a high-quality cloud model review and merge while cheap local workers
do the implementing.

## The role split

Minsky runs two kinds of process against one repo:

- **Orchestrator (the brain).** One conductor — `scripts/orchestrate.mjs`. It
  self-heals the worker daemon, runs the gate-then-review merge sweep
  (`runGateSweep` — only gate-green AND review-approved PRs merge), and keeps the
  heartbeat ledger. It spends the scarce **cloud** budget, because reviewing and
  merging is where model quality pays off.
- **Worker (the hands).** N walks of `bin/minsky-run.sh`. Each implements one
  claimed task on the cheap **local** agent in its own isolated run namespace
  (`novel/tick-loop/src/worker-config.ts` — disjoint worktree, lock, branch,
  ledger per run-id). A worker never spends cloud budget.

The separation is the actor model (Hewitt 1973): orchestrator and workers are
message-passing actors with distinct responsibilities. The budget framing is
SRE error-budget thinking (Beyer et al. 2016) — cloud tokens are the budget, the
orchestrator is the spend-rate-aware controller.

### How the pin is wired

The role is resolved from the `MINSKY_ROLE` env var:

| `MINSKY_ROLE` | Role | Agent + model |
|---|---|---|
| `worker` | hand | `local_agent` / `local_agent_model` |
| anything else / unset | brain | `cloud_agent` / `cloud_agent_model` |

The default is **orchestrator** on purpose: an unlabelled or typo'd process can
only ever become *more* conservative on cloud spend (it falls back to the brain
lane only when explicitly told it is the brain via the merge sweep), never less.
A worker must opt **in** to the cheap lane.

Two seams implement the pin:

- **Pure decision** — `resolveSpawnRole(env)` and
  `decideAgentForRole(role, cfg)` in `scripts/orchestrate.mjs` (unit-tested).
  `decideAgentForRole` maps a role to `{agent, model}`; the operator hard-pin
  `MINSKY_STRATEGIC_PIN_MODEL` wins the model slot for either role (so an
  operator can deliberately point a worker at the cloud model for debugging).
- **Runner wiring** — `bin/minsky-run.sh` reads `MINSKY_ROLE`; `worker` forces
  the existing local-agent lane (the one lever that selects the local model,
  local base-url, and the non-thinking spawn flags), so the whole downstream
  spawn shape follows for free.

### Observability

The orchestrator's `--once --json` mode emits a single machine-readable summary
on stdout (`{merged, skipped, role, ...}`) so the merge decision is verifiable:

```bash
node scripts/orchestrate.mjs --once --json
```

A non-gate-green PR is counted in `skipped`, never `merged` — the conductor does
no model calls itself; it delegates judgement to the review seam, which only
returns a merge for gate-green AND review-approved PRs.

## Failure modes & chaos verification

Every row below is a cross-layer failure the role split can hit, the expected
behavior, the deterministic chaos test that exercises it, and the blast radius
plus operator escape hatch (rule #7).

| Failure mode | Expected behavior | Chaos test | Blast radius | Operator escape hatch |
|---|---|---|---|---|
| **Role pin leaks** — a worker dispatches to the cloud model and burns the brain's budget | `circuit-break-and-notify`: `orchestrator-budget-monopoly` invariant fires when the orchestrator:worker cloud-token ratio drops below 9.0 with workers alive | `orchestrator-budget-monopoly` test (`scripts/self-diagnose.test.mjs`) asserts fire/pass across the ratio floor | Cloud budget drained faster than the brain can review; throughput-per-dollar collapses | Pivot to the hard env gate (`MINSKY_ROLE=worker` refuses cloud dispatch); inspect `.minsky/orchestrate.jsonl` per-role token attribution |
| **Zombie worker** — the orchestrator PID exits but a worker keeps running, holding compute (and possibly cloud budget) hostage | `loud-crash-supervisor-restart`: a detached worker finishes its in-flight iteration then self-terminates (`decideDetachedWorkerAction`); idle workers exit immediately; `orchestrator-detached-worker-finish` invariant fires on any survivor past the grace window | `scripts/chaos-orchestrator-kill.mjs` injects the orchestrator-kill fault and asserts 0 zombies; `orchestrator-detached-worker-finish` test pins the invariant | One stranded process per orphaned worker; wasted compute until reaped | `kill <pid>` the listed zombies; re-run `node scripts/chaos-orchestrator-kill.mjs`; verify the worker spawn installs a parent-death watch |
| **Namespace collision** — two concurrent workers derive the same worktree / lock / branch and corrupt each other | `graceful-degrade`: every mutable namespace is run-id-keyed (`deriveRunNamespace`), so disjointness is by construction; the claim key serializes contested tasks to one winner | `scripts/chaos-multitenant.mjs` asserts 0 collisions / 0 corrupt worktrees / 0 double-claims across N concurrent same-repo runs | Index corruption in the shared object store; double-claimed task wastes an iteration | The OS `O_EXCL` create + `EADDRINUSE` bind loop arbitrate; `MINSKY_RUN_ID` override forces a fresh namespace |
| **Brain-down, hands idle** — the orchestrator is down so no PRs merge while workers keep producing | `loud-crash-supervisor-restart`: the conductor's `decideHeal` kickstarts the worker daemon each tick via the launchd supervisor's own liveness (`parseLaunchctlRunning`, not an argv grep), and launchd `KeepAlive` respawns a crashed conductor | `decideHeal` + `parseLaunchctlRunning` tests (`scripts/orchestrate.test.mjs`) | Open PRs pile up unmerged; the queue stalls behind the brain | `launchctl kickstart -k gui/<uid>/com.minsky.opus-sonnet-run`; check `minsky daemon status` |
| **False merge** — the conductor merges a PR that is not gate-green | `circuit-break-and-notify`: the merge sweep is gate-then-review; a non-gate-green PR lands in `skipped`, never `merged`; `--once --json` makes the split auditable | `buildOnceJsonSummary` test (`scripts/orchestrate.test.mjs`) pins `skipped` as a count and `merged` as the merged-PR-number list | A broken PR could ship to the protected branch | `--no-review` is never the default; the `runGateSweep` `--stage=full` gate is the hard floor; revert + re-open on a fresh branch |

### Pivot (rule #9)

If the soft role preference keeps leaking (orchestrator cloud-token share < 0.7
over a 24h window), replace it with a **hard env gate**: a process started with
`MINSKY_ROLE=worker` refuses any cloud dispatch outright. If that still leaks,
retire the role pin and run every worker on the local agent only.

## Anchors

- Hewitt, "A Universal Modular Actor Formalism for Artificial Intelligence",
  IJCAI 1973 — orchestrator + workers as message-passing actors.
- Basiri et al., "Principles of Chaos Engineering", IEEE Software 2016 —
  steady-state hypothesis + fault injection (the orchestrator-kill fault).
- Beyer et al., "Site Reliability Engineering", O'Reilly 2016, Ch. 3 —
  error-budget framing (cloud tokens as the budget, the orchestrator as the
  spend-rate-aware controller).
- Leach, Mealling, Salz, RFC 4122 §4.4, 2005 — UUID run-id namespacing.

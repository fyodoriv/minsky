# Throughput fixture fleet

> The seed corpus for the "code factory" throughput benchmark. Five
> stand-in host repos, each carrying a rule-9-compliant seed `TASKS.md`
> and a resolved `.minsky/repo.yaml`, so the cross-repo runner can walk
> the fleet without a per-host bootstrap step.

## Why this directory exists

`scripts/throughput-benchmark.mjs` projects PRs/day at scale by walking a
fleet of fixture hosts and running the cross-repo runner once per host.
The benchmark needs a deterministic fleet of ≥5 host repos that always
has at least one pickable task each — otherwise the dry-run walk records
`empty-queue` and the throughput projection collapses to zero. These five
hosts provide that corpus. They are git-init-able stand-ins, not real
upstream repos: the benchmark's dry-run mode plans against the seed
`TASKS.md` and records a `validated` verdict without spawning an agent.

## Layout

```text
test-fixtures/throughput/
├── README.md          ← this file
├── host-01/
│   ├── TASKS.md        ← one rule-9-compliant P1 seed task
│   └── .minsky/repo.yaml
├── host-02/ … host-05/ (same shape)
```

## How the integration test uses it

`test/integration/throughput-benchmark.test.ts` copies these seed dirs
into a temp parent, runs `git init` + an initial commit in each, then
invokes `node scripts/throughput-benchmark.mjs --hosts-dir <tmp>
--fixture-hosts=5 --duration=24h --scorecard <tmp>/scorecard.json`. The
committed dirs deliberately omit `.git/` (an embedded git repo cannot be
tracked by the parent repo); the runner's `.git/` requirement is
satisfied at test time, not at rest.

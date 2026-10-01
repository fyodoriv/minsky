# Enterprise deployment options — what would make Minsky deployable at scale

> This document is the output of the `enterprise-deployment-readiness-audit`
> (TASKS.md, M2-gated). It enumerates what would have to change for Minsky to be
> deployed across 10+ enterprises without the operator-machine-identity moat
> (user-story 012) becoming a liability. The reference shapes are CrewAI
> Enterprise (60% of Fortune 500, 2B+ agentic executions) and Devin Enterprise
> (Cognition Cloud + customer-dedicated VPC). The audit is read-only market
> research per rule #12 — it scopes the gap, it does not commit Minsky to closing
> it.

## Why this file exists

The 2026-05-23 strategic deep-dive surfaced "enterprise distribution" as one of
five honest gaps in [`competitors/README.md` § Honest gaps](../competitors/README.md)
and [`vision.md` § Honest gaps](../vision.md). CrewAI AMP runs at Fortune-500
scale; Devin offers a vendor-managed cloud plus a self-hostable VPC tier; Minsky
has ~1 deployment. This file answers the falsifiable question the task block
poses: **are ≤3 architectural changes sufficient to make Minsky
enterprise-deployable, or does the operator-machine-identity moat fundamentally
conflict with enterprise distribution?**

This is an *explanation* doc (Diátaxis quadrant; Procida 2017): it does not tell
you how to deploy Minsky to an enterprise today (no such path exists), it
explains the trade-off space so the operator can decide whether to pursue it.

## The verdict (success path)

**Three architectural changes are sufficient to make Minsky deployable across a
team, without voiding the moat.** They are, in dependency order:

1. **Multi-operator mode** — per-operator daemons sharing a queue, NOT a
   centralised control plane.
2. **Vault integration behind a credentials adapter** — read enterprise secrets
   the same way Minsky reads `~/.config/gh/hosts.yml` today.
3. **Audit-log shipping** — forward each operator's `orchestrate.jsonl` to the
   OpenObserve backend already named in [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md).

The hypothesis in the task block (≤3 changes ⇒ enterprise-deployable; >3 ⇒ the
moat is the wrong moat) **holds at 3**. Each change is filed below as a
forward-looking M2 task. None of the three requires a centralised control plane,
so none voids the operator-machine-identity moat — that's the load-bearing
finding. The moat-conflict pivot (documented at the end) is the alternative
reading the operator should keep in view if any of the three changes turns out to
require a control plane after all.

## The five audit dimensions

### (a) Identity model — multi-operator mode

Minsky's moat (user-story 012, `vision.md` § "What Minsky uniquely does" moat #2)
is that the agent runs as the operator's user, on the operator's machine, with the
operator's `~/.gitconfig` + `~/.ssh` + `~/.config/gh/`. Commits land as the
operator. This is the deliberate inverse of Devin's Brain + Devbox (commits land
as `devin-ai-integration[bot]`) and CrewAI AMP (commits land as the platform).

The naïve "enterprise = centralised control plane" reading would void the moat.
The moat-preserving reading is **N per-operator daemons, one shared queue**:

| Shape | Identity | Moat status | Reference |
|-------|----------|-------------|-----------|
| Centralised orchestrator + per-operator agents | Control-plane identity | ❌ voids moat #2 | CrewAI AMP (k8s control plane) |
| Vendor cloud + per-tenant sandbox | Vendor / VPC identity | ❌ voids moat #2 | Devin (Brain + Devbox) |
| **Per-operator daemons + shared `TASKS.md`/queue** | **Operator identity preserved** | ✅ **moat #2 intact** | Minsky-shaped (this audit) |

In the moat-preserving shape, each of 50 developers runs their own `minsky`
daemon as their own user; the shared surface is the *queue* (a git-versioned
`TASKS.md` per repo, or a thin shared task backend), not the *runtime*. Claiming
is already collision-safe — `acquireTaskClaim` (slice 1) plus the `**Touches**:`
glob disjointness check (`novel/cross-repo-runner/`, see AGENTS.md § "`**Touches**:`
field"). Multi-operator mode extends that claim protocol from "N workers on one
machine" to "N operators on N machines", which is an additive change to the
existing claim layer, not a new control plane. This is the one change the task
block flags as *possibly* touching `novel/cross-repo-runner/`.

### (b) Audit logs — centralised log shipping

Minsky writes `orchestrate.jsonl` per host (the iteration ledger). Enterprise
audit needs the per-operator ledgers shipped to a central, queryable, retained
store. The stack already names the backend: **OpenObserve** is the single-binary
OTEL backend in [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) (resolved
2026-05-03; VictoriaMetrics triad is the runner-up pivot). The change is an
OTEL log-exporter that tails each operator's ledger and forwards to a shared
OpenObserve instance — additive, behind the observability adapter, and aligned
with rule #4 ("everything visible"). No moat impact: the ledger already exists on
the operator's machine; shipping a copy does not move the runtime off it.

### (c) Secret management — vault integration

Minsky reads the operator's `~/.config/gh/hosts.yml` directly (no credential
provisioning — moat #2's corollary). Enterprises typically require a vault:
1Password Connect, AWS Secrets Manager, or HashiCorp Vault. CrewAI AMP uses a
centralised OAuth2 vault with credentials referenced by name; that's the shape to
match without adopting the control plane.

Per rule #2 (every dependency behind an interface), this is a credentials
adapter: an interface file in `novel/adapters/credentials.ts` plus per-vendor
implementations (`credentials.gh-hosts.ts` for today's behaviour,
`credentials.vault.ts` / `credentials.aws-secrets.ts` for enterprise). The
operator-machine path (`gh-hosts`) stays the default; vault is opt-in for
enterprise hosts. The agent still runs as the operator; only the *source* of a
credential changes, not the *identity* it acts under — so the moat survives.

### (d) Compliance posture — SOC2 / ISO 27001

The operator-machine-identity moat *helps* compliance: data and credentials stay
on the operator's machine (local-first software; Kleppmann et al. 2019), so there
is no multi-tenant data-isolation surface to certify and no cross-VPC IAM to
audit. What's missing is *documentation* of the launchd/systemd supervision model
(the outer supervisor — Armstrong, *Programming Erlang*, Ch. 14) for an auditor:
where the daemon runs, what it can reach, how it is started and stopped, what it
logs. This is a documentation change (a future `docs/security/compliance-posture.md`),
not an architectural one — it does NOT count against the ≤3 budget because no code
changes.

### (e) Pricing model — out of scope for the architecture budget

Minsky is MIT-licensed today. Enterprise distribution typically needs a
commercial license or SaaS hosting tier. This is a business-model decision, not
an architectural change, and is explicitly out of the ≤3 architectural-change
budget the hypothesis measures. It is recorded here for completeness so the audit
is honest about the full picture: the architecture can be made
enterprise-deployable in 3 changes, but *commercialising* it is a separate,
non-architectural decision.

## The three changes, as forward-looking M2 tasks

Per the task's Success criterion ("if ≤3 changes, file them as P1 M2-tagged
tasks … visible, not committed-to"), the three are enumerated here for the
operator to file into `TASKS.md` when M2 distribution work begins. They are NOT
filed in this PR — this audit doc is read-only market research (rule #12), and
the worktree must not edit `TASKS.md` (the orchestrator owns task-block lifecycle).

- **`multi-operator-mode`** (P1, M2-distribution) — extend the claim protocol
  (`acquireTaskClaim` + `**Touches**:` disjointness) from N-workers-one-machine to
  N-operators-N-machines sharing one queue. Touches: `novel/cross-repo-runner/`.
  Moat-preserving: per-operator daemons, no central control plane.
- **`credentials-vault-adapter`** (P1, M2-distribution) — `novel/adapters/credentials.ts`
  interface + `credentials.gh-hosts.ts` (default, today's behaviour) +
  `credentials.vault.ts` (opt-in). Rule #2 shape; default stays operator-machine.
- **`audit-log-shipping`** (P1, M2-distribution) — OTEL log-exporter tailing each
  operator's `orchestrate.jsonl` to a shared OpenObserve instance
  (`docs/ARCHITECTURE.md`). Rule #4 shape; additive, behind the observability adapter.

## Reference shapes (in-repo research)

This audit synthesises the per-vendor research files already in the corpus — no
external data was fetched:

- **CrewAI Enterprise (AMP)** — [`competitors/crewai.md`](../competitors/crewai.md)
  § "Production architecture": Kubernetes-native SaaS, PostgreSQL 16.8+,
  S3-compatible storage, multi-tenant RBAC + OAuth2 + centralised credential
  vault. 60% of Fortune 500; 2B+ cumulative executions. The control-plane shape
  Minsky must NOT copy wholesale.
- **Devin Enterprise** — [`competitors/devin.md`](../competitors/devin.md):
  Cognition Cloud (Brain) + Devbox sandbox; commits land as
  `devin-ai-integration[bot]`. A self-hostable "Devin in your VPC" tier is hinted
  but not generally available; that tier is the explicit re-evaluation trigger for
  Minsky's moat (see devin.md wrap-feasibility analysis).
- **Minsky's moat** — [`user-stories/012-operator-machine-identity-moat.md`](../user-stories/012-operator-machine-identity-moat.md)
  and [`vision.md` § "What Minsky uniquely does"](../vision.md): operator runs the
  daemon as their own user; commits land as the operator; no identity boundary.

## Pivot — when to STOP pursuing enterprise distribution

Per the task's Pivot threshold: if a closer design of any of the three changes
reveals that it CANNOT be done without a centralised control plane (e.g.,
multi-operator claiming requires a server-side lock service that the operators
must trust, or vault integration forces a platform identity onto the agent), then
the operator-machine-identity moat fundamentally conflicts with enterprise
distribution. In that case:

- **STOP** pursuing enterprise distribution as a feature track.
- **Reframe** Minsky's positioning as "the operator-tier orchestrator" — leave
  Fortune-500-scale distribution to CrewAI / Devin Enterprise.
- **Keep** the enterprise gap in the corpus as an honest, deliberately-unclosed
  gap (the existing `competitors/README.md` § Honest gaps row already says as
  much: "Rejected — TypeScript is the orchestrator-tier surface" framing for the
  adjacent Python-binding gap).

The wider pivot threshold (rule #9 shape, inherited from `vision.md` § Honest
gaps): if 12 months pass and Minsky still has zero deployed instances outside the
operator's own infrastructure, enterprise distribution was the wrong gap to file —
re-evaluate which gap actually blocks adoption.

## Moat framing — unchanged

This audit does NOT change the moat framing in `vision.md`. The three changes are
all moat-preserving (per-operator daemons, credentials adapter with operator-machine
default, additive log shipping), so the moat-#2 claim ("operator-machine
identity") survives enterprise distribution. The `vision.md` § "What Minsky
uniquely does" and § "Honest gaps" sections already classify enterprise
distribution as an M2-gated honest gap; this audit confirms that classification
rather than revising it. No `vision.md` edit is required — and per repo
convention, only the MAPE-K loop's specification-monitor amends the behavioral
spec.

## Sources

- Cognition Labs, *Enterprise Deployment Overview*, <https://docs.devin.ai/enterprise/deployment/overview>, 2026.
- CrewAI, *CrewAI OSS 1.0 GA*, <https://www.crewai.com/blog/crewai-oss-1-0>, 2026 (60% Fortune 500; 2B+ executions).
- Kleppmann, M., Wiggins, A., van Hardenberg, P., McGranaghan, M., *Local-first software: you own your data, in spite of the cloud*, Onward! / CIDR 2019, § 4.
- Armstrong, J., *Programming Erlang*, Pragmatic Bookshelf, 2013, Ch. 14 (supervision tree — the launchd/systemd outer supervisor).
- Procida, D., *The Diátaxis Documentation Framework*, <https://diataxis.fr> (this file is the *explanation* quadrant for enterprise deployment).
- `competitors/README.md` § "Honest gaps"; `competitors/crewai.md` § "Production architecture"; `competitors/devin.md`; `user-stories/012-operator-machine-identity-moat.md`; `vision.md` § "What Minsky uniquely does"; `docs/ARCHITECTURE.md` (OpenObserve backend); operator directive 2026-05-23.

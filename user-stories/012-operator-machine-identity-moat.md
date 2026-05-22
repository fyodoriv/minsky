# Story 012 — Minsky commits as me, in my repo, with my git identity

> **Moat #2 of [competitors/README.md](../competitors/README.md).** Minsky is the only orchestrator-tier system that runs as the operator's user on the operator's machine — with the operator's `~/.ssh`, `~/.gitconfig`, `~/.config/gh/`, `~/.aws/credentials`. Every other competitor introduces an identity boundary: Devin spawns a Devbox (Cognition or VPC); CrewAI Enterprise runs on the platform; AutoGen / LangGraph / MetaGPT run in whatever Python container the developer deploys. The agent loop sees the operator's home directory, the operator's credentials, the operator's existing repos. There is no separate identity to manage, no cross-VPC IAM, no "Devbox just got a new VM" identity reset.

## Story

As an operator, I run `minsky` on my MacBook. The daemon spawns Claude (or Devin, or Aider) as MY user, in MY home directory. The agent reads my `~/.gitconfig` — commits land as `Fyodor Sheremetyev <hi@shrmtv.com>`, not `devin@cognition.ai` or `crewai-platform@example.com`. It uses MY `~/.config/gh/hosts.yml` — `gh pr create` opens PRs under my account. It uses MY `~/.ssh` — clones via the same SSH key I'd use myself. When I open the PR, GitHub shows my avatar; my team's branch protection rules apply normally; my CI pipeline runs with my secrets.

No cloud sandbox. No fresh clone for every task. No Devbox snapshot to maintain. No identity boundary to cross. The agent IS me, just slower and more thorough.

## Acceptance criteria

- Every PR opened by Minsky carries the operator's `user.email` from `~/.gitconfig` as the commit author.
- Every `gh pr create` uses the operator's `~/.config/gh/hosts.yml` credentials — the operator's GitHub avatar appears next to the PR.
- The agent's working tree IS the operator's existing repo working tree (or a worktree under it for parallel-spawn safety) — not a sandbox container, not a fresh clone.
- No "Devbox snapshot" or "Brain in someone else's cloud" — the entire iteration loop runs on the operator's machine.
- The agent has access to the same env vars the operator has — including `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GH_TOKEN` etc. — without re-entering them or rotating them.
- A Minsky operator who's already done `gh auth login` once doesn't need to do it again for Minsky.
- The operator can stop the daemon and inspect the working tree the agent left behind — it's just files in the operator's filesystem, no remote VM to ssh into.

## Metric

- **Name**: `operator-machine-identity-coverage`
- **Definition**: Fraction of Minsky-spawned PRs across the trailing 30 days where the commit author matches the operator's `~/.gitconfig` `user.email` (i.e., the operator-machine-identity moat is honoured).
- **Threshold**: ≥99% — only deliberate exceptions (e.g., a bot-account host) bring this below 100%.
- **Source**: `gh pr list --json author,headRefName --limit 100 | jq -r '.[] | select(.headRefName | startswith("minsky/")) | .author.login'` against the local `git config user.email`.

## Integration test

`test/integration/operator-machine-identity.test.ts`:

1. Set up a temp directory as a fake host repo with a `TASKS.md` that has one trivial P3 task.
2. Set `git config user.email "test-operator@example.com"` in that repo.
3. Set `git config user.name "Test Operator"` in that repo.
4. Spawn `minsky run <task-id> --host <temp-dir> --dry-run` with a stubbed agent that returns a known patch.
5. Assert the resulting commit's `author.email` is `test-operator@example.com` and `author.name` is `Test Operator`.
6. Assert no Docker container was launched (the operator's $HOME is the working surface).
7. Assert no `~/.minsky/sandbox-credentials.json` or similar was created (no separate identity).

## Proof

- `novel/cross-repo-runner/bin/minsky-run.mjs` spawns the agent in the host directory via `spawn(agent, args, { cwd: hostDir })` — no Docker / no chroot / no Devbox.
- `bin/minsky` shell shim passes through `$HOME`, `$PATH`, `$ANTHROPIC_API_KEY`, etc. — no env-var stripping.
- Commits are produced by the agent (Claude / Devin / Aider) calling `git commit` from within the host worktree — using the operator's `~/.gitconfig`.
- No alternative identity is materialised anywhere in `novel/` — no `OperatorIdentity` adapter, no SSO redirect, no sandbox credentials. The absence is the proof.

Competitors that REJECT this moat by design:

- **Devin** — Brain in Cognition's cloud (Azure-hosted); Devbox is a fresh VM per session. Devin commits under `devin-ai-integration[bot]@users.noreply.github.com`. The operator gets a PR opened by Devin's bot account, not by themselves. Strong argument FOR Devin: tenant isolation, no host-machine compromise possible. Strong argument FOR Minsky: nothing to authenticate, nothing to provision, no new bot account.
- **CrewAI Enterprise** — workflows run on the CrewAI platform; the platform's identity opens PRs. Same trade-off shape as Devin.
- **AutoGen / LangGraph / MetaGPT** — frameworks; whatever Python container hosts them has the identity. In practice, deployments use either a service account (lose operator identity) or run on the operator's machine (manual setup, no daemon wiring).

## Failure modes & chaos verification

| Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|
| Operator's `~/.gitconfig` is missing `user.email` | `git config --unset user.email` before spawn | `loud-crash-supervisor-restart` — runtime invariant detects missing identity, refuses to spawn, surfaces as `severity: "error"` in `minsky watch` | `test/chaos/missing-git-identity.test.ts` |
| Operator's `~/.config/gh/hosts.yml` is missing or stale | Remove `~/.config/gh/hosts.yml` mid-iteration | `circuit-break-and-notify` — `gh pr create` fails with auth error; PR-creation step records the failure in `orchestrate.jsonl`; iteration counted as `verdict=pr-create-failed`; operator sees the ntfy notification | `test/chaos/stale-gh-credentials.test.ts` |
| Operator's API key is rate-limited or expired | Mock `ANTHROPIC_API_KEY` returning 429 | `graceful-degrade` — daemon catches the 429, applies the existing rate-limit-backoff substrate (`novel/budget-guard/`), pauses the iteration, resumes after backoff window | `test/chaos/api-key-rate-limit.test.ts` |
| Agent attempts to spawn a Docker container as a sandbox | Mock agent that tries `docker run` | `loud-crash-supervisor-restart` — scope-discipline lint catches the Docker invocation as out-of-scope edit; iteration verdict is `scope-leak`; PR is not opened. The operator-machine-identity moat is rule #12 (scope discipline) at the agent layer. | `test/chaos/agent-spawns-docker.test.ts` |
| Operator runs Minsky as `root` instead of their user | `sudo minsky --daemon` | `circuit-break-and-notify` — daemon refuses to start with a one-line `EUID=0 not supported (use your operator UID)`; the runtime invariant pins this. | `test/chaos/root-uid-refusal.test.ts` |

**Blast radius**: bounded to the operator's user account. Minsky never elevates privileges. The agent inherits exactly what the operator has — no more, no less.

**Operator escape hatch**: `minsky stop` (graceful drain) or `pkill -f minsky-run.mjs` (hard kill). The agent's open commits remain in the operator's worktree as-is (`git status` shows them); the operator can `git reset --hard HEAD~1` to undo a half-finished iteration, or `git push` to keep it.

## Pre-registered umbrella experiment

`experiments/operator-machine-identity-moat-2026-05-23.yaml`:

```yaml
id: operator-machine-identity-moat
hypothesis: "Operator-machine-identity (Minsky's moat #2) lowers the per-PR review-friction
  vs cloud-sandbox orchestrators (Devin, CrewAI Enterprise). Specifically: PRs opened
  by Minsky get reviewed faster by the operator than PRs opened by a bot account
  identity, because GitHub's notification + avatar treatment matches the operator's
  normal review flow."
success: "Median time-to-first-operator-review for Minsky-opened PRs is <50% of the
  median time-to-first-review for Devin-opened PRs in comparable repos, measured
  over 30 PRs each."
pivot: "If 60 days pass with no measurable difference (Minsky review time is within
  20% of Devin's review time), the moat's BUSINESS value is lower than claimed;
  the TECHNICAL property (operator identity) still holds but isn't producing the
  predicted UX outcome. Reframe the moat as 'no credential provisioning required'
  rather than 'faster review'."
measurement: |
  gh pr list --author '@me' --limit 100 --json createdAt,reviews --jq '
    .[] | select(.reviews | length > 0) |
    {pr: .number, lag: ((.reviews[0].submittedAt | fromdateiso8601) - (.createdAt | fromdateiso8601))}
  ' | jq -s 'sort_by(.lag) | .[length/2 | floor] | .lag'
anchor:
  - "Sheremetyev, F., Git Wasn't Designed for Agents, Medium, 2026-05 — the operator-machine-identity vs cloud-sandbox architectural distinction"
  - "Cognition Labs, Devin Enterprise Deployment Overview, docs.devin.ai, 2026 — the Brain + Devbox architecture this user story is the deliberate inverse of"
  - "competitors/README.md § What Minsky uniquely does — moat #2"
```

## Status

🟡 **Partial.** Today (2026-05-23): Minsky DOES spawn agents in the host directory with the operator's identity (this is how the daemon has always worked); the moat exists. What's NOT YET in place is the integration test that pins the property (`test/integration/operator-machine-identity.test.ts`) and the chaos coverage. The measurement (`operator-machine-identity-coverage`) is filed in METRICS.md and surfaces from the existing `gh pr list` data — no new instrumentation needed.

**Critical path to ✅ done**:

1. Land `test/integration/operator-machine-identity.test.ts` — pins the moat against a stubbed agent + temp host repo.
2. Land the five `test/chaos/*.test.ts` files in the table above.
3. Land the `operator-machine-identity-coverage` metric in `METRICS.md` + dashboard.
4. Run the umbrella experiment for 30 days; record the result in `experiments/operator-machine-identity-moat-2026-05-23.yaml`.

## Pattern conformance

- **Pattern Minsky implements**: Local-first / operator-machine identity (Kleppmann et al., _Local-first software_, CIDR 2019, §4 "You retain ownership and control") — the agent's commits, credentials, and working tree live on the operator's machine.
- **Conformance level**: full (the moat exists today; just needs the pin-against-regression test).
- **Conformance index row**: vision.md § "Pattern conformance index" row 97 (filed in the same PR as this user story).

## Security & privacy

The operator-machine-identity moat IS Minsky's security model.

- **Threat 1: Cloud sandbox compromise.** A compromised Cognition Cloud Brain could exfiltrate every customer's code. Mitigation in Minsky: no cloud Brain. The agent runs on the operator's machine, sees only what the operator's user can see.
- **Threat 2: Cross-tenant data leak.** A Devbox snapshot or AutoGen container that's misconfigured could expose customer A's code to customer B. Mitigation in Minsky: no tenancy boundary — each operator's machine is its own tenant.
- **Threat 3: Credential theft.** An agent that has access to the operator's `~/.aws/credentials` could exfiltrate AWS keys. Mitigation: same as the agent itself has — none additional. The operator must NOT install Minsky on a machine where they don't trust the agent (Claude / Devin / Aider) to read their credentials. This is the standard local-agent threat model, identical to running `claude` or `devin` directly without Minsky.
- **Threat 4: Privilege escalation.** Minsky must NEVER run as root. The runtime invariant `noRootUid` enforces this; the chaos test `test/chaos/root-uid-refusal.test.ts` pins the failure mode.
- **Threat 5: Operator-machine-identity violation by the agent itself.** An agent could in principle `git config user.email "evil@example.com"` mid-iteration and produce commits with a wrong identity. Mitigation: `scope-leak` lint catches `.gitconfig` edits as out-of-scope; runtime invariant verifies commit author after each spawn.

Rule #13 minimum-bar items reviewed: no PII in OTEL spans (commit authorship is operator-controlled, never logged separately), no secret exposure (no separate identity to manage), default loopback bind (no remote control surface from this moat), supply-chain hardening (no new dependencies introduced by this story).

# Story 012 — Minsky commits as you, in your repo, with your git identity

**Milestone(s)**: M1.10

> Minsky runs on your own machine, as you. Its commits land under your own
> name, using your own git, SSH, and GitHub credentials — no cloud sandbox, no
> separate bot account, no identity to provision.

This is **moat #2** in [competitors/README.md](../competitors/README.md): the one
property no rival has. First, the words you need.

- **Minsky** — the background program you point at your code projects. It picks
  the most important unfinished to-do, asks a coding assistant to do it, and
  hands you a draft to review.
- **operator** — the human who runs Minsky. That is you. The commits run under
  your own git and SSH credentials.
- **agent** — the coding assistant Minsky drives to do the actual work: Claude
  Code, Devin, or Aider. Minsky is not an agent; it orchestrates agents.
- **host** — one code project (a git repository) that Minsky works on.
- **daemon** — a background program that keeps running on your machine after you
  start it. Minsky is a daemon.
- **run / iteration** — one round of work: pick a task, ask an agent to do it,
  capture the result, open a draft pull request.

## Why this matters

Every rival in the orchestrator tier puts a boundary between you and the work.
The agent runs somewhere else, as someone else:

- **Devin** spawns a fresh virtual machine ("Devbox") per session, with its
  "Brain" hosted in Cognition's cloud.
- **CrewAI Enterprise** runs your workflows on the CrewAI platform, under the
  platform's identity.
- **AutoGen, LangGraph, and MetaGPT** are frameworks; whatever Python container
  hosts them carries the identity.

Each of these introduces a separate identity to manage: a new credential to
provision, a cross-cloud trust boundary to cross, a bot account that opens your
pull requests instead of you.

Minsky has none of that. The agent loop sees your home directory, your
credentials, and your existing repos. There is no separate identity, because the
identity is yours.

## Story

As an operator, I run `minsky` on my laptop. The daemon starts the agent (Claude
Code, Devin, or Aider) as my user, in my home directory.

- The agent reads my `~/.gitconfig`, so commits land under my own name and email
  — not under a bot account such as `devin-ai-integration[bot]`.
- It uses my `~/.config/gh/hosts.yml`, so `gh pr create` opens pull requests
  under my GitHub account.
- It uses my `~/.ssh`, so it clones with the same SSH key I would use myself.

When the pull request opens, GitHub shows my avatar. My team's branch-protection
rules apply normally. My continuous-integration pipeline runs with my secrets.

No cloud sandbox. No fresh clone for every task. No virtual-machine snapshot to
maintain. No identity boundary to cross. The agent is me — just slower and more
thorough.

## Acceptance criteria

- Every pull request Minsky opens carries the operator's `user.email` from
  `~/.gitconfig` as the commit author.
- Every `gh pr create` uses the operator's `~/.config/gh/hosts.yml` credentials,
  so the operator's GitHub avatar appears next to the pull request.
- The agent's working tree is the operator's existing repo working tree (or a
  worktree under it, for parallel-spawn safety) — not a sandbox container, not a
  fresh clone.
- No virtual-machine snapshot and no cloud Brain: the entire iteration loop runs
  on the operator's machine.
- The agent has the same environment variables the operator has — including
  `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, and `GH_TOKEN` — without re-entering or
  rotating them.
- An operator who has already run `gh auth login` once does not need to do it
  again for Minsky.
- The operator can stop the daemon and inspect the working tree the agent left
  behind. It is just files in the operator's filesystem — there is no remote
  virtual machine to ssh into.

## Metric

- **Name**: `operator-machine-identity-coverage`
- **Definition**: Fraction of Minsky-spawned pull requests over the trailing 30
  days where the commit author matches the operator's `~/.gitconfig`
  `user.email` — that is, where the operator-machine-identity moat held.
- **Threshold**: ≥99%. Only deliberate exceptions (such as a dedicated
  bot-account host) bring this below 100%.
- **Source**:
  `gh pr list --json author,headRefName --limit 100 | jq -r '.[] | select(.headRefName | startswith("minsky/")) | .author.login'`
  compared against the local `git config user.email`.

## Integration test

`test/integration/operator-machine-identity.test.ts`:

1. Set up a temp directory as a fake host repo with a `TASKS.md` that has one
   trivial P3 task.
2. Set `git config user.email "test-operator@example.com"` in that repo.
3. Set `git config user.name "Test Operator"` in that repo.
4. Run `minsky run <task-id> --host <temp-dir> --dry-run` with a stubbed agent
   that returns a known patch.
5. Assert the resulting commit's `author.email` is `test-operator@example.com`
   and `author.name` is `Test Operator`.
6. Assert no Docker container was launched — the operator's `$HOME` is the
   working surface.
7. Assert no `~/.minsky/sandbox-credentials.json` or similar was created — there
   is no separate identity.

## Proof

The moat is proved as much by what is absent as by what is present.

- `novel/cross-repo-runner/bin/minsky-run.mjs` starts the agent in the host
  directory via `spawn(agent, args, { cwd: hostDir })` — no Docker, no chroot,
  no virtual machine.
- The `bin/minsky` shell shim passes through `$HOME`, `$PATH`,
  `$ANTHROPIC_API_KEY`, and the rest. It strips no environment variables.
- Commits come from the agent (Claude Code, Devin, or Aider) calling
  `git commit` inside the host worktree, using the operator's `~/.gitconfig`.
- No alternative identity is created anywhere in `novel/`: no `OperatorIdentity`
  adapter, no single-sign-on redirect, no sandbox credentials. The absence is
  the proof.

Competitors reject this moat by design:

- **Devin** — the Brain runs in Cognition's cloud (Azure-hosted); the Devbox is
  a fresh virtual machine per session. Devin commits under
  `devin-ai-integration[bot]@users.noreply.github.com`, so the operator gets a
  pull request opened by Devin's bot account, not by themselves. The argument
  for Devin: tenant isolation, with no way to compromise the host machine. The
  argument for Minsky: nothing to authenticate, nothing to provision, no new bot
  account.
- **CrewAI Enterprise** — workflows run on the CrewAI platform, and the
  platform's identity opens pull requests. Same trade-off shape as Devin.
- **AutoGen / LangGraph / MetaGPT** — frameworks; whatever Python container
  hosts them carries the identity. In practice, deployments use either a service
  account (which loses operator identity) or the operator's own machine (which
  means manual setup, with no daemon wiring).

## Failure modes & chaos verification

**Steady-state hypothesis**: every Minsky-opened pull request carries the
operator's own commit identity, with no sandbox and no privilege escalation.

**Blast radius**: bounded to the operator's user account. Minsky never elevates
privileges. The agent inherits exactly what the operator has — no more, no less.

**Operator escape hatch**: `minsky stop` (graceful drain) or
`pkill -f minsky-run.mjs` (hard kill). The agent's commits stay in the
operator's worktree as-is — `git status` shows them. The operator can
`git reset --hard HEAD~1` to undo a half-finished iteration, or `git push` to
keep it.

| Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|
| Operator's `~/.gitconfig` is missing `user.email` | `git config --unset user.email` before spawn | `loud-crash-supervisor-restart` — a runtime invariant detects the missing identity, refuses to spawn, and surfaces as `severity: "error"` in `minsky watch` | `test/chaos/missing-git-identity.test.ts` |
| Operator's `~/.config/gh/hosts.yml` is missing or stale | Remove `~/.config/gh/hosts.yml` mid-iteration | `circuit-break-and-notify` — `gh pr create` fails with an auth error; the PR-creation step records the failure in `orchestrate.jsonl`; the iteration is counted as `verdict=pr-create-failed`; the operator sees the ntfy notification | `test/chaos/stale-gh-credentials.test.ts` |
| Operator's API key is rate-limited or expired | Mock `ANTHROPIC_API_KEY` returning 429 | `graceful-degrade` — the daemon catches the 429, applies the existing rate-limit-backoff substrate (`novel/budget-guard/`), pauses the iteration, and resumes after the backoff window | `test/chaos/api-key-rate-limit.test.ts` |
| Agent tries to start a Docker container as a sandbox | Mock agent that runs `docker run` | `loud-crash-supervisor-restart` — the scope-discipline lint catches the Docker invocation as an out-of-scope edit; the iteration verdict is `scope-leak`; the pull request is not opened. The moat is rule #12 (scope discipline) at the agent layer. | `test/chaos/agent-spawns-docker.test.ts` |
| Operator runs Minsky as `root` instead of their own user | `sudo minsky --daemon` | `circuit-break-and-notify` — the daemon refuses to start with a one-line `EUID=0 not supported (use your operator UID)`; a runtime invariant pins this. | `test/chaos/root-uid-refusal.test.ts` |

## Pre-registered umbrella experiment

This story follows pre-registered hypothesis-driven development (rule #9): the
hypothesis, success threshold, pivot threshold, measurement command, and
literature anchor are committed before the result is observed.

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

🟡 **Partial.** As of 2026-05-23, Minsky already spawns agents in the host
directory with the operator's identity — this is how the daemon has always
worked, so the moat already exists. What is not yet in place is the integration
test that pins the property
(`test/integration/operator-machine-identity.test.ts`) and the chaos coverage.
The measurement (`operator-machine-identity-coverage`) is filed in `METRICS.md`
and reads from existing `gh pr list` data, so no new instrumentation is needed.

**Critical path to ✅ done**:

1. Land `test/integration/operator-machine-identity.test.ts` — pins the moat
   against a stubbed agent and a temp host repo.
2. Land the five `test/chaos/*.test.ts` files in the table above.
3. Land the `operator-machine-identity-coverage` metric in `METRICS.md` and the
   dashboard.
4. Run the umbrella experiment for 30 days; record the result in
   `experiments/operator-machine-identity-moat-2026-05-23.yaml`.

## Pattern conformance

- **Pattern Minsky implements**: local-first / operator-machine identity
  (Kleppmann et al., _Local-first software_, CIDR 2019, §4 "You retain ownership
  and control"). The agent's commits, credentials, and working tree all live on
  the operator's machine.
- **Conformance level**: full — the moat exists today; it just needs the
  pin-against-regression test.
- **Conformance index row**: vision.md § "Pattern conformance index" row 97
  (filed in the same PR as this user story).

## Security & privacy

The operator-machine-identity moat IS Minsky's security model. This section
reviews it against rule #13 (security and privacy).

- **Trust boundary**: the operator's own user account. The agent runs as the
  operator, sees only what the operator's user can see, and crosses no network
  identity boundary. Threat 1 (cloud-sandbox compromise) and threat 2
  (cross-tenant data leak) are eliminated by construction: there is no cloud
  Brain to compromise and no tenancy boundary to misconfigure, because each
  operator's machine is its own tenant.
- **Secrets**: there is no separate identity to manage. The agent inherits the
  operator's existing `~/.gitconfig`, `~/.config/gh/hosts.yml`, `~/.ssh`, and
  API-key environment variables. Nothing is re-entered, rotated, or copied into
  a sandbox. The threat of an agent rewriting its identity mid-iteration
  (`git config user.email "evil@example.com"`) is caught by the `scope-leak`
  lint on `.gitconfig` edits, and a runtime invariant verifies the commit author
  after every spawn.
- **PII**: commit authorship is operator-controlled and is never logged
  separately. No PII enters OpenTelemetry (OTEL) spans.
- **Sandbox**: by design there is no sandbox — but privilege escalation is still
  blocked. Minsky must never run as root; the runtime invariant `noRootUid`
  enforces this and the chaos test `test/chaos/root-uid-refusal.test.ts` pins
  the failure mode. The standard local-agent threat model still applies: do not
  install Minsky on a machine where you would not trust the agent (Claude Code,
  Devin, or Aider) to read your credentials directly.
- **Performance carve-out**: none. This story adds no new dependencies, opens no
  remote control surface (the daemon keeps its default loopback bind), and
  introduces no extra supply-chain footprint.

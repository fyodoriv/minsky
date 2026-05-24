# Story 013 — Minsky is a daemon I attach, not a framework I wrap my code in

> **Moat #1 of [competitors/README.md](../competitors/README.md).** Every orchestrator-tier competitor (CrewAI, AutoGen, LangGraph, MetaGPT, OpenAI Agents SDK) is a FRAMEWORK — the developer writes Python (or TypeScript) that uses the framework's `Flow`, `Crew`, `StateGraph`, `Team`, or `Agent` primitive. Minsky is a DAEMON — the operator attaches it to an existing git repo with one command and walks away. No code to write, no DSL to learn, no state machine to define, no graph to build. The repo is the input; PRs are the output.

## Story

I have a repo at `~/apps/my-side-project`. It has a `TASKS.md` with a few P1 entries I jotted down on the train. From my laptop:

```bash
cd ~/apps/my-side-project
minsky
```

That's it. Minsky picks the top P1, spawns Claude in my repo's worktree, opens a PR, and starts the next task. I close my laptop and go to bed. In the morning my `TASKS.md` is drained of P1 work and there are draft PRs waiting for my review.

I never wrote a `Flow` class. I never defined a `StateGraph`. I never set up a `Crew` with role assignments. I never imported `from langgraph.graph import StateGraph`. The substrate is the daemon; I just gave it a queue.

## Acceptance criteria

- `minsky` (no args) starts a daemon against the current working directory.
- The operator never writes Python or TypeScript code to use Minsky — only `TASKS.md` markdown.
- The operator never wraps their own code in a Minsky primitive — Minsky reads `TASKS.md`, spawns the configured agent, opens PRs against the existing repo, never asks the operator's code to opt into Minsky.
- A repo's only interface to Minsky is two markdown files: `TASKS.md` (input queue) and `.minsky/repo.yaml` (per-host config, optional).
- Stopping Minsky is `minsky stop` (graceful) or `pkill -f minsky-run.mjs` (hard). The operator's code is unchanged when Minsky is gone — no `Flow.cleanup()` calls, no Crew teardown, no graph deallocation.
- The daemon survives the operator closing their laptop / restarting their machine — `launchctl` (macOS) or `systemctl` (Linux) restarts it.
- Switching agents (Claude → Devin → Aider) is a single edit to `~/.minsky/config.json` — not a code change to the operator's repo.

## Metric

- **Name**: `framework-lines-in-host-repo`
- **Definition**: Total number of lines of code in the host repo that import from `@minsky/*`, reference `Minsky.*`, or otherwise couple the operator's code to Minsky's APIs. Should be **zero**.
- **Threshold**: ≤0 — anything above zero is a violation of the daemon-not-framework moat.
- **Source**: `git grep -E "(from|import)\s+['\"]?@minsky/" <host-dir>/src <host-dir>/lib 2>/dev/null | wc -l`

## Integration test

`test/integration/daemon-not-framework.test.ts`:

1. Set up a temp directory as a fake host repo.
2. Initialize it with NOTHING Minsky-related — no `@minsky/*` imports, no `.minsky/` directory, no `MINSKY_*` env var references in code.
3. Add a `TASKS.md` with one trivial P3 task.
4. Run `minsky run <task-id> --host <temp-dir> --dry-run` with a stubbed agent.
5. Assert: zero new import statements in any `.ts` / `.js` / `.py` file in the host repo (only `.minsky/` sidecar + the PR diff exists). The operator's source files are untouched except for the task patch.
6. Assert: removing `.minsky/` entirely (the sidecar) leaves the host repo functioning identically — no `@minsky/*` imports to break.

## Proof

- `pnpm-workspace.yaml` declares the `@minsky/*` packages as workspace packages of the Minsky repo — not as published npm packages the host repo would import.
- `novel/cross-repo-runner/bin/minsky-run.mjs` reads the host repo via `readFileSync(host + '/TASKS.md')` and spawns the agent with `spawn(agent, args, { cwd: host })`. There is NO API the host repo is expected to call.
- `bin/minsky` is a bash shim. The host repo never sources or imports it.
- The `.minsky/` sidecar is gitignored by default (added to the host's `~/.config/git/ignore` via the bootstrap step). The host repo's tracked files contain ZERO Minsky-coupling.
- Compare to CrewAI: the developer's code imports `from crewai import Crew, Agent, Task`. Compare to LangGraph: `from langgraph.graph import StateGraph`. Compare to AutoGen: `from autogen import AssistantAgent, UserProxyAgent`. Compare to MetaGPT: subclass `Role`. Minsky: zero imports.

## Failure modes & chaos verification

| Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|
| Operator's repo has no `TASKS.md` | Spawn against a repo missing `TASKS.md` | `graceful-degrade` — daemon reports "no work" and pauses (not crash); operator sees `idle` state in `minsky watch` | `test/chaos/host-missing-tasks-md.test.ts` |
| Operator's repo has malformed `TASKS.md` (rule-9 fields missing) | `TASKS.md` has tasks but every one is missing Hypothesis/Success/Pivot/Measurement/Anchor | `graceful-degrade` — `pickHostTask` returns null; daemon reports "no pickable task"; operator sees `idle-malformed-tasks` state | `test/chaos/malformed-tasks-md.test.ts` |
| Operator's repo isn't a git repo | Spawn against a directory that has files but no `.git/` | `loud-crash-supervisor-restart` — runtime invariant `hostIsGitRepo` fires; daemon refuses to spawn; clear one-line error in `minsky watch` | `test/chaos/host-not-a-git-repo.test.ts` |
| Operator's repo has `@minsky/*` imports in source code | Detect via the `framework-lines-in-host-repo` lint | `circuit-break-and-notify` — the daemon-not-framework lint (rule #10 shape) fails the PR; operator sees the lint error before push | `test/chaos/host-imports-minsky.test.ts` (lint test, not chaos test, but pinned the same way) |
| Operator wants to "extend" Minsky by adding their own personas | Operator drops a MicroAgent markdown file into `.openhands/microagents/` | `graceful-degrade` — persona is recognized natively by OpenHands' AgentSkills-spec loader; operator extends WITHOUT writing code in the host repo, only declarative markdown in `.openhands/`. The legacy `novel/adapters/persona-spawner/` adapter was deleted 2026-05-24 (per the Path C reshape — OpenHands' native MicroAgents + DelegateTool + TaskToolSet + AgentDefinition cover every consumer of the old adapter). | `test/chaos/custom-microagent-via-markdown.test.ts` |
| Daemon dies; operator's repo state is unclear | Send `SIGKILL` to the daemon mid-iteration | `loud-crash-supervisor-restart` — launchd/systemd restarts within 5s; iteration is recorded as `verdict=daemon-killed`; operator's working tree is left as-is (the agent's commits, if any, remain); `minsky watch` shows the restart event | `test/chaos/daemon-sigkill-mid-iteration.test.ts` |

**Blast radius**: bounded to the operator's repo. The daemon never touches OTHER repos unless `--hosts-dir` is set, and even then walks them in round-robin without coupling.

**Operator escape hatch**: `minsky stop` removes Minsky from the equation; the operator's repo is unchanged.

## Pre-registered umbrella experiment

`experiments/daemon-not-framework-moat-2026-05-23.yaml`:

```yaml
id: daemon-not-framework-moat
hypothesis: "Operator setup time for Minsky-on-an-existing-repo is <5 minutes
  from `git clone https://github.com/fyodoriv/minsky.git` to first PR opened,
  WITHOUT any code change to the operator's repo. The competitor baseline
  (CrewAI / AutoGen / LangGraph) requires the operator to WRITE Python code
  before any work happens — typically 30+ minutes from clone to first
  workflow run."
success: "≥10 cold-start tests across diverse host repos (TypeScript, Python,
  Rust, Go) show median operator-time-to-first-PR <5 minutes, with ZERO
  edits to host-repo source files outside `.minsky/`."
pivot: "If median time-to-first-PR exceeds 15 minutes across 5+ host repos,
  the daemon-not-framework moat has a hidden setup cost we haven't accounted
  for. Audit the install path; consider shipping `minsky bootstrap --auto`
  for the unseen cases."
measurement: |
  for host in $TEST_HOST_REPOS; do
    start_ts=$(date +%s)
    cd "$host" && minsky --once --task "$(head -1 TASKS.md | awk '{print $NF}')"
    pr_url=$(gh pr list --author '@me' --limit 1 --json url --jq '.[0].url')
    end_ts=$(date +%s)
    [ -n "$pr_url" ] && echo "$((end_ts - start_ts))s"
  done | sort -n | awk 'NR==int(NR/2+1)'  # median
anchor:
  - "competitors/README.md § What Minsky uniquely does — moat #1"
  - "Newman, S., Building Microservices, O'Reilly, 2021, Ch. 1 — the daemon-vs-framework architectural distinction; a daemon is a service the operator attaches, a framework is a library the developer wraps"
  - "Erlang/OTP supervision tree pattern (Armstrong, Programming Erlang, 2013) — Minsky's launchd/systemd supervisor IS the daemon shape this moat names"
```

## Status

✅ **Done.** The daemon-not-framework moat exists today. `bin/minsky` is a bash entry point that the operator runs without writing code. The host repo's only interface is two markdown files (`TASKS.md` + optional `.minsky/repo.yaml`). The integration test (`test/integration/daemon-not-framework.test.ts`) is in flight; chaos tests in the table above are tracked as `daemon-not-framework-moat-chaos-coverage` in TASKS.md P2.

**Maintenance**: the `framework-lines-in-host-repo` lint is the pin-against-regression. If anyone ever adds a `@minsky/cli-helper` package the host repo is expected to import, that's a violation of moat #1 — file as a P0 task immediately.

## Pattern conformance

- **Pattern Minsky implements**: Daemon / Service pattern (Newman, _Building Microservices_, O'Reilly 2021, Ch. 1 — service interface boundary; the daemon's only contract with the operator is the file system + the CLI). Combined with Supervision tree (Armstrong, _Programming Erlang_, 2013, Ch. 14) — launchd/systemd is the outer supervisor.
- **Conformance level**: full.
- **Conformance index row**: vision.md § "Pattern conformance index" row 98 (filed in the same PR as this user story).

## Security & privacy

- **Threat: the daemon must not couple the host repo to Minsky's internals.** A future refactor that requires the host repo to import `@minsky/*` is a moat violation AND a supply-chain expansion (the host now depends on Minsky's release cadence). Mitigated by the `framework-lines-in-host-repo` lint above.
- **Threat: state in the wrong place.** Minsky writes per-host state to `.minsky/` inside the host. The host's gitignore must include `.minsky/` (added by `minsky bootstrap`). Without that, the host accidentally commits its experiment store — leaking iteration metadata. Mitigated by `bootstrap` + the global `~/.config/git/ignore` rule.
- **Threat: the daemon survives the operator.** A daemon that keeps running after the operator stops trusting Minsky is a security problem. `minsky stop` + the launchd plist's `KeepAlive=false` after stop are the operator escape hatches.
- **Threat: the daemon walks into a repo the operator didn't intend it to operate on.** Default behavior is "current directory only"; `--hosts-dir` is opt-in. The runtime invariant `hostIsApprovedByOperator` verifies the host is in `~/.minsky/config.json` `default_host` OR explicit `--host` argv before any spawn.

Rule #13 minimum-bar items reviewed: no PII in spans, no secret exposure (the daemon-not-framework moat means the host's secrets stay in the host's env, never get marshalled through a Minsky API), default loopback bind (no remote control surface), supply-chain hardening (zero `@minsky/*` deps in the host repo means a malicious Minsky release can't poison the host's lockfile).

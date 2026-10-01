# Story 013 — Minsky is a daemon you attach, not a framework you wrap your code in

> **Moat #1 of [competitors/README.md](../competitors/README.md).** You point Minsky at a code project and walk away. You never write code to use it.

Minsky is a daemon — a background program that keeps running on your machine. You attach it to a git repository (a "host") with one command, and it works on that repo's to-do list on its own.

Every orchestrator-tier competitor — CrewAI, AutoGen, LangGraph, MetaGPT, the OpenAI Agents SDK — is a *framework* instead. With a framework, you write Python or TypeScript that calls the framework's `Flow`, `Crew`, `StateGraph`, `Team`, or `Agent` primitive. You learn a small language, define a state machine, build a graph.

With Minsky there is none of that. No code to write. No DSL to learn. No graph to build. The repo is the input; draft pull requests are the output. The agent — the coding assistant Minsky drives, such as Claude Code, Devin, or Aider — does the actual work; Minsky just hands it the next task.

## Story

You have a code project at `<repos-parent>/my-side-project`. It has a `TASKS.md` — the plain-text Markdown to-do list at the project's root that Minsky reads to pick work. You jotted a few `P1` entries into it on the train. From your laptop you run two lines:

```bash
cd <repos-parent>/my-side-project
minsky
```

That is all. Minsky picks the top `P1` task, runs the agent inside a worktree of your repo, opens a draft PR with the result, and starts the next task. You close your laptop and go to bed. In the morning, `TASKS.md` is drained of `P1` work and draft PRs are waiting for your review.

You never wrote a `Flow` class. You never defined a `StateGraph`. You never set up a `Crew` with role assignments. You never wrote `from langgraph.graph import StateGraph`. The daemon is the thing you run; you just gave it a queue.

## Acceptance criteria

- `minsky` with no arguments starts a daemon against the current working directory.
- You never write Python or TypeScript to use Minsky — only `TASKS.md` Markdown.
- You never wrap your own code in a Minsky primitive. Minsky reads `TASKS.md`, runs the configured agent, and opens PRs against the existing repo. Your code never opts into Minsky.
- A repo's only interface to Minsky is two Markdown files: `TASKS.md` (the to-do list) and `.minsky/repo.yaml` (per-host config, optional).
- Stopping Minsky is `minsky stop` (graceful) or `pkill -f minsky-run.mjs` (hard). When Minsky is gone, your code is unchanged — no `Flow.cleanup()` calls, no Crew teardown, no graph deallocation.
- The daemon survives you closing your laptop or restarting your machine. A supervisor — the outer watchdog that restarts Minsky if it dies — restarts it: `launchd` on macOS, `systemd` on Linux.
- Switching agents (Claude Code → Devin → Aider) is a single edit to `~/.minsky/config.json`. It is never a code change to your repo.

## Metric

- **Name**: `framework-lines-in-host-repo`
- **Definition**: The number of lines in the host repo that import from `@minsky/*`, reference `Minsky.*`, or otherwise couple your code to Minsky's APIs. It should be **zero**.
- **Threshold**: ≤0 — anything above zero violates the daemon-not-framework moat.
- **Source**: `git grep -E "(from|import)\s+['\"]?@minsky/" <host-dir>/src <host-dir>/lib 2>/dev/null | wc -l`

## Integration test

`test/integration/daemon-not-framework.test.ts`:

1. Set up a temp directory as a fake host repo.
2. Initialize it with nothing Minsky-related — no `@minsky/*` imports, no `.minsky/` directory, no `MINSKY_*` env var references in code.
3. Add a `TASKS.md` with one trivial `P3` task.
4. Run `minsky run <task-id> --host <temp-dir> --dry-run` with a stubbed agent.
5. Assert: zero new import statements in any `.ts` / `.js` / `.py` file in the host repo. Only the `.minsky/` sidecar and the PR diff exist; your source files are untouched except for the task patch.
6. Assert: deleting `.minsky/` entirely leaves the host repo working identically — there are no `@minsky/*` imports to break.

## Proof

- `pnpm-workspace.yaml` declares the `@minsky/*` packages as workspace packages of the Minsky repo — not as published npm packages a host repo would import.
- `novel/cross-repo-runner/bin/minsky-run.mjs` reads the host repo via `readFileSync(host + '/TASKS.md')` and runs the agent with `spawn(agent, args, { cwd: host })`. There is no API the host repo is expected to call.
- `bin/minsky` is a bash shim. The host repo never sources or imports it.
- The `.minsky/` sidecar is gitignored by default (added to the host's `~/.config/git/ignore` during bootstrap). The host repo's tracked files contain zero Minsky-coupling.
- Compare the frameworks: CrewAI code imports `from crewai import Crew, Agent, Task`; LangGraph imports `from langgraph.graph import StateGraph`; AutoGen imports `from autogen import AssistantAgent, UserProxyAgent`; MetaGPT subclasses `Role`. Minsky: zero imports.

## Failure modes & chaos verification

**Steady-state hypothesis**: a host repo with a valid `TASKS.md` produces draft PRs without any change to its source files.

**Blast radius**: bounded to the operator's repo. The daemon never touches other repos unless `--hosts-dir` is set. Even then it walks them in round-robin without coupling them to Minsky.

**Escape hatch**: `minsky stop` removes Minsky from the equation; the operator's repo is unchanged.

| Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|
| Host repo has no `TASKS.md` | Run against a repo missing `TASKS.md` | `graceful-degrade` — daemon reports "no work" and pauses (does not crash); operator sees `idle` state in `minsky watch` | `test/chaos/host-missing-tasks-md.test.ts` |
| Host repo has a malformed `TASKS.md` | Tasks exist but every one is missing its rule #9 fields (Hypothesis / Success / Pivot / Measurement / Anchor — pre-registered hypothesis-driven development) | `graceful-degrade` — `pickHostTask` returns null; daemon reports "no pickable task"; operator sees `idle-malformed-tasks` state | `test/chaos/malformed-tasks-md.test.ts` |
| Host directory is not a git repo | Run against a directory that has files but no `.git/` | `loud-crash-supervisor-restart` — the runtime invariant `hostIsGitRepo` fires; daemon refuses to run; a clear one-line error shows in `minsky watch` | `test/chaos/host-not-a-git-repo.test.ts` |
| Host repo has `@minsky/*` imports in its source | Detected via the `framework-lines-in-host-repo` lint | `circuit-break-and-notify` — the daemon-not-framework lint (rule #10, deterministic enforcement) fails the PR; operator sees the lint error before push | `test/chaos/host-imports-minsky.test.ts` (a lint test, pinned the same way) |
| Operator wants to extend Minsky with their own personas | Operator drops a MicroAgent Markdown file into `.openhands/microagents/` (a persona is a role the agent takes on) | `graceful-degrade` — the persona is recognized natively by OpenHands' AgentSkills-spec loader; the operator extends Minsky with declarative Markdown only, never code in the host repo. The legacy `novel/adapters/persona-spawner/` adapter was removed (OpenHands' native MicroAgents + DelegateTool + TaskToolSet + AgentDefinition cover every consumer of the old adapter). | `test/chaos/custom-microagent-via-markdown.test.ts` |
| Daemon dies mid-iteration; host state is unclear | Send `SIGKILL` to the daemon during one iteration | `loud-crash-supervisor-restart` — `launchd`/`systemd` restarts within 5s; the iteration is recorded as `verdict=daemon-killed`; the operator's working tree is left as-is (any agent commits remain); `minsky watch` shows the restart event | `test/chaos/daemon-sigkill-mid-iteration.test.ts` |

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

✅ **Done.** The daemon-not-framework moat exists today. `bin/minsky` is a bash entry point you run without writing code. The host repo's only interface is two Markdown files: `TASKS.md` plus an optional `.minsky/repo.yaml`. The integration test (`test/integration/daemon-not-framework.test.ts`) is in flight; the chaos tests in the table above are tracked as `daemon-not-framework-moat-chaos-coverage` in `TASKS.md` `P2`.

**Maintenance**: the `framework-lines-in-host-repo` lint is the pin against regression. If anyone ever adds a `@minsky/cli-helper` package the host repo is expected to import, that violates moat #1 — file it as a `P0` task immediately.

## Pattern conformance

- **Pattern Minsky implements**: Daemon / Service pattern (Newman, *Building Microservices*, O'Reilly 2021, Ch. 1 — the daemon's only contract with the operator is the file system plus the CLI). Combined with the supervision tree (Armstrong, *Programming Erlang*, 2013, Ch. 14 — `launchd`/`systemd` is the outer supervisor).
- **Conformance level**: full.
- **Conformance index row**: vision.md § "Pattern conformance index" row 98 (filed in the same PR as this user story).

## Security & privacy

This section ties the daemon-not-framework moat to rule #13 (security and privacy), the constitution's non-negotiable security rule in vision.md.

- **Trust boundary**: the daemon must not couple the host repo to Minsky's internals. A future refactor that requires the host repo to import `@minsky/*` is both a moat violation and a supply-chain expansion — the host would then depend on Minsky's release cadence. Mitigated by the `framework-lines-in-host-repo` lint above.
- **Secrets**: the host's secrets stay in the host's own environment. The daemon-not-framework shape means a secret is never marshalled through a Minsky API, so a Minsky release can never read or relay it.
- **PII**: no personally identifiable information is written to OpenTelemetry (OTEL) spans. Minsky's per-host state lives in `.minsky/` inside the host, and the host's gitignore must include `.minsky/` (added by `minsky bootstrap`). Without that rule, the host could accidentally commit its experiment store and leak iteration metadata. Mitigated by `bootstrap` plus the global `~/.config/git/ignore` entry.
- **Sandbox**: the daemon binds to loopback only and exposes no remote control surface, so a malicious actor on the network cannot drive it. The runtime invariant `hostIsApprovedByOperator` verifies the host appears in `~/.minsky/config.json` `default_host` or an explicit `--host` argument before any run, so the daemon never walks into a repo the operator did not intend. A daemon must also not outlive the operator's trust: `minsky stop` plus the launchd plist's `KeepAlive=false` after stop are the escape hatches that keep it stopped.
- **Performance carve-out**: the lint and runtime invariants above run once per host attach and once per PR, not on every iteration, so the moat's safety checks add no measurable per-tick overhead.

Rule #13 minimum-bar items reviewed: no PII in spans, no secret exposure, default loopback bind, and supply-chain hardening (zero `@minsky/*` dependencies in the host repo means a malicious Minsky release cannot poison the host's lockfile).

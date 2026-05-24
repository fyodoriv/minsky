# Story 014 — Minsky is the same no matter which agent chat installed it

**Milestone(s)**: M1

> **The launcher is a doorway, not a runtime.** Minsky's install runbook lives at `INSTALL.md` and is followed by whatever AI coding agent the operator already has open — Claude Code, Cursor, Devin, Windsurf, Codex, Aider, or a local model talking to one of them. Once the install finishes, the agent that drove the install is *out of the picture*. The daemon that runs Minsky on the operator's machine is the same daemon, with the same tick-loop, the same `TASKS.md` picker, the same OpenHands-backed agent runtime, and the same observable surfaces, regardless of which chat opened the door. This story names that invariant and pins it down so a future regression can't silently smuggle launcher-dependent behavior into the runtime.

## Story

I'm an operator with three machines. On my MacBook I asked Claude Code to install Minsky for `~/apps/my-side-project`. On my Linux desktop I asked Cursor to do the same against `~/repos/another-project`. On my work Mac I asked Devin (via its CLI) to do it against `~/work/that-thing`. All three runbooks were `INSTALL.md`; all three install paths completed in ≤90s; all three machines now have a daemon running at exactly the same revision of `bin/minsky`.

When I run `minsky watch` on any of the three, I see:

- The same tick-loop iteration log shape.
- The same `TASKS.md` picker decisions (under identical task inputs).
- The same OpenHands shim invocation envelope (`{"agent":"openhands","sdk_version":...,"files_changed":N,"diff_bytes":B,"ok":true}`).
- The same set of pre-pr-lint stages running on PRs the daemon opens.
- The same observable failure modes and the same recovery handles (`minsky doctor`, `minsky stop`, `minsky consent`).

What I do NOT see:

- A "Minsky-Claude-edition" vs. "Minsky-Cursor-edition" runtime.
- Skill discovery that only fires when `.claude/skills/` exists but not when `.cursor/rules/` exists.
- Telemetry-consent records that differ in shape per launcher.
- A `cloud_agent` default that depends on which agent installed Minsky.
- Worktree layout, env-var honoring, or commit identity that varies by launcher.

The runtime invariant is: **whatever the agent-chat door looked like, the room behind it is the same room.**

## Acceptance criteria

1. `bin/minsky` reads no environment variable, file, or socket whose name encodes the identity of the agent that ran the install. The daemon does not branch on `CLAUDE_CODE=1`, `CURSOR=1`, `DEVIN_AGENT=1`, etc.
2. The set of features exposed by `minsky` (subcommands, flags, env-var contract, file-layout under `~/.minsky/` and `.minsky/`) is identical across all installs irrespective of which agent ran `INSTALL.md`.
3. The OpenHands shim invocation (model selection, base-url resolution, reasoning-effort override, extended-thinking flag) is purely a function of `~/.minsky/config.json` + repo-local `.minsky/repo.yaml` — never of the launcher.
4. Skill discovery for the agent runtime (OpenHands' `~/.openhands/agents/` + `~/.openhands/skills/` tree) is populated by Minsky's own install step, not inherited from the launcher's skill directory. (`.claude/skills/`, `.cursor/rules/`, etc. are launcher-private; Minsky neither requires nor reads them at runtime.)
5. The operator can swap launchers between installs (e.g., uninstall + reinstall from a different agent chat on the same machine) and observe zero runtime-behavior delta on the same `TASKS.md` against the same model.
6. `minsky doctor` includes a `launcher-agnostic` invariant: it greps the live process env for any `*_AGENT*` / `*CHAT*` / `*COPILOT*` variable that influences runtime branching, and reports a hard FAIL if a non-empty match is found in branched code paths.
7. The `INSTALL.md` document carries a "Step 0 — what 'install' means" paragraph stating this invariant verbatim, so an agent reading the runbook knows it is *not allowed* to inject launcher-specific behavior on the way through.

## Metric

- **Name**: `launcher-agnostic-runtime-divergence-count`
- **Definition**: Count of distinct runtime-observable deltas (iteration-log shape, picker decision under identical input, OpenHands envelope fields, pre-pr-lint stage list, `~/.minsky/` layout) between two Minsky installs on the same OS+repo+task driven by two different launcher agents.
- **Threshold**: `0` (iron) — any non-zero count is a violation. The only permitted delta is the `agent` string in the telemetry-consent record (which records *who turned the doorknob*, not *who lives in the room*).
- **Source**: `scripts/check-launcher-agnostic-parity.mjs` (P1 task — see TASKS.md `launcher-agnostic-feature-parity-chaos-test`). Diffs two Minsky installs driven by two stubbed launchers against the same fixture repo and exits 1 on any non-allowlisted delta.

## Integration test

`test/chaos/launcher-agnostic-feature-parity.test.ts` (filed as P1 task `launcher-agnostic-feature-parity-chaos-test`):

1. Create a temp fixture repo with `TASKS.md` containing one P3 trivial task.
2. Stub two "launcher agents" — `fake-claude` and `fake-cursor` — that each invoke the canonical `INSTALL.md` runbook against the fixture in mock mode. Both run on the same OS, same Node, same pnpm, same git, same model (`ollama_chat/qwen3-coder:30b`).
3. After each install, snapshot: `bin/minsky --version`, `~/.minsky/config.json`, `.minsky/state.json`, the set of subcommands `minsky --help` reports, and the OpenHands spawn envelope for one stubbed iteration.
4. Diff the two snapshots. The only permitted delta is the `agent` field in `~/.minsky/telemetry-consent.json`.
5. Any other delta → fail the test with a per-field diff in the error.

## Proof

- `bin/minsky` is a single bash entrypoint that dispatches to `node ./dist/cli.js`; the dispatch logic reads no launcher-identifying env var.
- `novel/tick-loop/src/cli-consent.ts` records `{consent, timestamp, host_path_hash, agent}` — the `agent` field is recorded for telemetry observability but is never re-read by runtime code (only by the consent ledger).
- `novel/cross-repo-runner/bin/minsky-run.mjs` resolves model + base-url + reasoning flags from `~/.minsky/config.json`; no launcher branch.
- `novel/adapters/agent-runtime-openhands/bin/minsky-openhands-spawn.py` (the spawn shim) reads only its own CLI flags. The TS builder (`novel/adapters/agent-runtime-openhands/src/spawner.ts`) reads only config and the brief.
- `INSTALL.md` Step 0 explicitly forbids launcher-specific behavior in the install steps.

## Failure modes & chaos verification

| Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|
| Launcher injects `.claude/` or `.cursor/` config that the runtime accidentally reads | Operator installs from Claude Code, daemon then reads `.claude/skills/*` for the OpenHands agent runtime | `circuit-break-and-notify` — `launcher-agnostic` invariant in `minsky doctor` fires; daemon refuses to spawn until the leak is closed | `test/chaos/launcher-agnostic-feature-parity.test.ts` (this story's primary test) |
| Two installs differ in `~/.minsky/config.json` defaults across launchers | INSTALL.md was patched per-launcher and accidentally writes different defaults | `loud-crash-supervisor-restart` — the parity diff in the chaos test fails CI; PR cannot land | same test, snapshot-diff path |
| OpenHands env-var contract leaks launcher identity | An iteration env spawned by the daemon contains `MINSKY_LAUNCHER=claude-code` | `circuit-break-and-notify` — `minsky doctor` detects the env leak; iteration fails fast with a one-line diagnostic | `test/chaos/openhands-env-no-launcher-leak.test.ts` (sub-slice of the chaos test task) |
| Telemetry-consent record reuses a field for runtime branching | A future PR adds `if (consent.agent === "claude-code") { ... }` to runtime code | `circuit-break-and-notify` — the parity chaos test catches the divergence in step (4) and rejects | same test |
| Skill discovery silently fails on one launcher | OpenHands' `~/.openhands/agents/security-reviewer.md` references `example-code-secure` which exists in `.claude/skills/` on Claude-launched installs but not on Cursor-launched installs | `loud-crash-supervisor-restart` — recorded by the existing `agentbrew-sync-missing-example-code-secure-to-openhands` P1 task (filed 2026-05-24); the daemon refuses to start until the skill is canonical under Minsky's own install. | (covered by that task's regression test once it ships) |

**Blast radius**: bounded to the install transaction. If a launcher leaks into the runtime, the chaos test catches it before the PR lands.

**Operator escape hatch**: `minsky doctor --launcher-agnostic-check` exits non-zero if any launcher leak is detected, with a copy-paste-able remediation command per finding.

## Pre-registered umbrella experiment

`experiments/launcher-agnostic-feature-parity-2026-05-24.yaml` (filed alongside this story):

```yaml
id: launcher-agnostic-feature-parity
hypothesis: "Two Minsky installs on the same OS, same fixture repo, same model,
  driven through INSTALL.md by two different launcher agents (fake-claude,
  fake-cursor), produce byte-identical `~/.minsky/config.json`, identical
  subcommand sets in `minsky --help`, identical OpenHands spawn envelopes,
  and identical iteration-log shapes. The only permitted delta is the
  `agent` string in `~/.minsky/telemetry-consent.json` (which records
  who-installed, not what-runs)."
success_threshold:
  - launcher_agnostic_runtime_divergence_count: 0
  - permitted_deltas: ["telemetry_consent.agent"]
pivot:
  if: "any non-permitted delta surfaces in the chaos test after 3 attempts"
  then: "split Minsky into per-launcher distributions and stop claiming
    launcher-agnostic — but ONLY after the operator decides this is
    acceptable (it's a moat erosion)"
measurement:
  - "test/chaos/launcher-agnostic-feature-parity.test.ts (CI gate)"
  - "scripts/check-launcher-agnostic-parity.mjs (lint, P1 follow-up)"
anchor: "INSTALL.md (this repo) — colocated agent-readable runbook is the
  canonical install pattern (RFC 8615 — well-known URIs for machine-readable
  metadata; same pattern as `.well-known/security.txt`)"
```

## Notes

- This story complements but does not duplicate story 013 (daemon-not-framework — the operator's *repo* is decoupled from Minsky) and story 012 (operator-machine-identity — Minsky runs as the operator, not in a cloud sandbox). Story 014 adds the *launcher* axis: the agent chat that drove the install doesn't get to color the runtime either.
- Pairs with the strategic stance recorded in `user-stories/015-local-models-until-stable.md`: because Minsky runs on local models until M1.1 stability hits 90%, the runtime is even less launcher-dependent than it would be on a cloud model (no cloud-key plumbing to vary across launchers).
- Filed alongside the P1 task `launcher-agnostic-feature-parity-chaos-test` (TASKS.md) which carries the chaos-test implementation.

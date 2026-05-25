# Bash-runner observability — how to see what's happening + debug failures

The Path A bash + Python skeleton (`bin/minsky-run.sh`, `scripts/spawn_agent.py`, `scripts/transform_*.py`) needs operator-grade visibility so live runs against real repos surface problems in seconds instead of minutes. This doc lists the surfaces and how to use them.

## Pre-flight: `minsky bash-doctor`

Before any live run, probe whether this machine can actually execute the bash skeleton. The check is read-only, takes < 1s, and exits 1 with operator-actionable messages on every critical failure.

```bash
minsky bash-doctor
```

Critical checks (FAIL → exit 1):

- `jq` — required by `record_iteration` to serialize JSONL safely.
- `python3 ≥ 3.10` — all `scripts/*.py` target 3.10+ (match-case, walrus).
- `bin/minsky-run.sh` + `bin/minsky-default-session.sh` executable bits.
- `scripts/spawn_agent.py` exists and is python-parseable.
- Agent backend reachable — either the canonical `openhands` CLI on PATH, OR the OpenHands SDK importable from python3.
- `gh` CLI on PATH (used by `record_iteration` + PR-state probes).

Non-critical checks (WARN, don't block):

- API key env var (`OPENHANDS_API_KEY` / `LLM_API_KEY` / `ANTHROPIC_API_KEY`).
- `.minsky/repo.yaml` in `$PWD` (required by `--transform`).
- `shellcheck` clean on `bin/minsky-run.sh`.
- `gh auth status` passes.

Use `--quiet` to suppress PASS lines for scripting / dotfiles checks.

## Per-iteration capture: `<host>/.minsky/failures/`

Every iteration with a non-validated verdict (`spawn-failed`, `aborted`, `planned-only`, etc.) snapshots its full context into:

```text
<host>/.minsky/failures/<iso-ts>-<task-id>/
├── brief.md          ← the exact prompt the agent received
├── stdout.log        ← full agent stdout+stderr (not the 100-char tail)
├── env.txt           ← sanitized environment (secrets redacted; values
│                       for *_TOKEN / *_KEY / *_SECRET / *_PASSWORD
│                       vars replaced with `<redacted-length-N>`)
└── metadata.json     ← verdict, exit_code, duration_ms, branch,
                        pr_url, notes, tool versions (jq, python3,
                        openhands SDK, gh)
```

The capture happens BEFORE the iteration's `mktemp` cleanup deletes the brief + stdout, so the operator inspects artifacts that match what the agent actually saw.

Ring-limit: keeps the 20 most recent failure dirs per host. Override via `MINSKY_FAILURE_RING_SIZE=N`. Disable capture entirely with `MINSKY_CAPTURE_FAILURES=0` (e.g. for benchmarks where the JSONL is enough).

### Inspecting a failure

```bash
# Most recent failure on this host
ls -t .minsky/failures/ | head -1

# Read the brief + the tail of stdout
cd .minsky/failures/<latest>/
cat metadata.json | jq .
cat brief.md
tail -100 stdout.log
```

The capture is self-contained — no need to cross-reference the JSONL ledger or grep through `bin/minsky-run.sh` logs.

## Per-host ledger: `<host>/.minsky/experiment-store/cross-repo/<task-id>.jsonl`

Append-only JSONL with one row per iteration. Schema (parity with `IterationRecord` in `novel/cross-repo-runner/src/iteration-record.ts`):

```json
{"ts":"…","experiment_id":"…","host_repo":"…","branch":"…","verdict":"…","pr_url":null,"notes":"…"}
```

For multi-iteration trend queries use `scripts/transform_trend.py` / `bin/minsky trend`. For a single failure's full evidence, use the failure-capture dir above.

## Iteration cross-session ledger: `.minsky/transform-runs.jsonl`

Written by `bin/minsky-default-session.sh` at session end. One row per `--transform` invocation. Drives the MAPE-K Plan phase (`minsky recommend`).

## Process visibility (live runs)

While a run is in flight:

```bash
# What agent processes are alive?
pgrep -fa 'spawn_agent.py|spawn_with_watchdog.py|openhands'

# Latest stdout being written (during the iteration — file is still
# open):
ls -lt /tmp/minsky-stdout.* | head -1 | awk '{print $NF}' | xargs tail -f
```

## When something breaks: triage order

```bash
minsky doctor                                  # is the machine still healthy?
minsky logs --failures <host> --latest         # show me what broke last
```

`logs --failures --latest` is the operator's one-liner — it prints the metadata.json (verdict, exit_code, duration_ms, tool versions), the first 30 lines of brief.md (what was the agent told?), and the last 50 lines of stdout.log (what did the agent actually do?). One command, all the evidence.

Without `--latest`, `logs --failures` lists the most recent N capture dirs (default 5) with one-line summaries — verdict, task ID, duration — so the operator can spot patterns (e.g. "all 5 most recent failures are `spawn-failed` with duration ~30s — the watchdog is firing").

The legacy manual sequence still works for deeper digging:

```bash
ls -t <host>/.minsky/failures/ | head -3       # what failed recently?
cat <host>/.minsky/failures/<id>/metadata.json | jq .
head -50 <host>/.minsky/failures/<id>/brief.md
tail -100 <host>/.minsky/failures/<id>/stdout.log
grep -i 'minsky\|host\|task' <host>/.minsky/failures/<id>/env.txt
```

## Tight iteration loop: `minsky --once`

When you're debugging a change to `bin/minsky-run.sh` or `scripts/*.py`, you don't want to run a full 8-iteration session each time. `minsky --once <host-dir>` runs EXACTLY ONE iteration against a host, tee'ing all I/O into `<host-dir>/.minsky/iter-once.log` so you can `cat` it after.

```bash
minsky --once ~/apps/toronto-rentals          # dry-run (no spawn, no tokens)
minsky --once ~/apps/toronto-rentals --live   # real spawn (burns tokens)
minsky --once ~/apps/toronto-rentals --no-capture  # disable failure-capture
                                                    # for this run
```

Defaults to `--dry-run` — safe for the tight loop. After exit, prints:

```text
=== --once summary ===
  verdict:        spawn-failed
  ledger row:     <host>/.minsky/experiment-store/cross-repo/task-foo.jsonl
  iter log:       <host>/.minsky/iter-once.log
  failure capture: <host>/.minsky/failures/<latest>/
                   (minsky logs --failures <host> --latest)
```

The operator's mental model:

```bash
minsky doctor                                  # is the machine healthy?
minsky --once foo                              # try one dry iteration
minsky --once foo --live                       # if dry was good, try real
minsky logs --failures foo --latest            # if something broke, show me
# (edit code) (edit code)
minsky --once foo                              # try again, loop until green
```

Each cycle ≤30s of operator attention. Without `--once`, every code change forced a full session run (8h budget) + manual JSONL inspection.

### Deprecated spellings

The standalone `iter-once` and `tail-failures` subcommands still work as thin deprecation aliases (banner + delegation), but are deprecated as of 2026-05-25 per rule #16 CLI consolidation corollary — `--once` is a flag on the `minsky` no-args entry, and `--failures` is a refinement of `logs`. Update muscle memory; the aliases will eventually be deleted.

```bash
# Old (still works, prints deprecation banner)
minsky iter-once foo
minsky tail-failures foo --latest

# New (canonical)
minsky --once foo
minsky logs --failures foo --latest
```

## Source

- 2026-05-25 retro — observability gap surfaced between "parity tests pass" and "live smoke ready".
- Rule #4 — everything measurable, everything visible.
- Rule #6 — let-it-crash AT the right boundary (capture-failure runs OUTSIDE the iteration loop so a capture bug never blocks shipping).
- Rule #17 — proactive healing (the gap becomes a probe + a capture artifact).

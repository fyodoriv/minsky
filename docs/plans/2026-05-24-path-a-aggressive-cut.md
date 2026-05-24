# Plan: Path A aggressive cut — Minsky shrinks to ~5-10K LOC

- **Task**: `path-a-aggressive-cut-plan-doc` (TASKS.md P0, this PR)
- **Repo**: minsky
- **Author**: claude-opus-4-7-max session 2026-05-24
- **Status**: shipped — this doc IS the canonical Path A aggressive-cut plan
- **Supersedes-where-conflicting**: `docs/plans/2026-05-22-path-c-openhands-reshape.md` § "Package-by-package fate" — the Path A cut deletes `novel/cross-repo-runner/`, `novel/tick-loop/`, `novel/observer/`, `novel/spec-monitor/`, and `novel/handoff-spec/` (Path C marked KEEP/RE-SCOPE; Path A marks DELETE-and-replace-with-thin-shell). All other package fates in the Path C plan stand.
- **Triggered by**: operator directive 2026-05-24 — when offered Path A (more aggressive, ~5-10K LOC final) vs continuing the existing Path C (~30K LOC final), operator answered "2" (more aggressive). The 4-stream landscape research + brutal-honest moat audit (this session) confirmed that 2 of the 6 claimed moats in `vision.md` are genuinely unique; the other 4 are partial / easily replicable.

## Goal

Shrink Minsky from ~70K LOC (today) past the Path C target (~30K LOC) all the way to **~5-10K LOC** by deleting every layer that Composio / OpenHands / Charlie / Factory / shell + cron together can deliver. The surviving Minsky surface is exactly the two genuinely-unique moats — constitutional discipline + MAPE-K cross-session substrate — plus the minimal autonomic shell required to run them 24/7.

Path A is the **maximum-leverage operator-time cut**. Path C kept the cross-repo-runner (10.8K LOC) and tick-loop (3K LOC) as moat anchors. Path A says: those moats can be defended with ~500 lines of careful shell + the OpenHands SDK, freeing the operator's 15-20 hours/month maintenance ceiling down to ~5 hours/month.

## Why Path A over Path C

Three reasons:

1. **The brutal-honest moat audit (this session, 2026-05-24).** Six moats claimed in `vision.md § "What Minsky uniquely does"`. Two are unique. Four are partial. Specifically:
   - Moat 5 "Cross-repo fleet at operator scale" — Composio Agent Orchestrator (Feb 2026) does 30 parallel agents with auto-CI-fix; Charlie Labs CAOS coordinates multi-repo daemons; Factory Missions multi-agent. The "N hosts round-robin on ONE machine" framing is genuinely Minsky-shaped, but it's ~500 lines of shell to replicate, not 10.8K LOC of TypeScript.
   - Moat 1 "Daemon, not framework" — OpenHands runs locally (V1 SDK), Plandex runs locally with full-auto, ForgeGod / CLU / kai-linux/agent-os all do the daemon-shell shape at hobby scale. Defending this moat doesn't require 3K LOC of tick-loop; it requires a `launchd` plist + a shell loop.

2. **The 1-FTE math.** Same as Path C's WHY: sustainable solo-maintained LOC budget is ~5K-10K. Path C target (~30K) is still 3-6× over budget. Path A target (~5-10K) lands in budget.

3. **The operator's explicit 99%-replacement openness.** The operator stated 2026-05-24: *"I'm ok with replacing 99% of it for something that already exists and then joining that existing thing if so."* Path A doesn't deliver 99% (it preserves the constitutional discipline + MAPE-K), but it delivers ~85-90%, which is the maximum honest cut that preserves the unique moats. Anything more aggressive crosses into Path B territory (contribute upstream and wind down entirely).

## The two surviving moats (post Path A)

Down from six. Brutal-honest assessment:

| # | Moat | Genuinely unique? | Where it lives after the cut |
|---|---|---|---|
| 1 | **Constitution + deterministic enforcement** | **YES.** Zero competitors have a constitutional doc with rule-by-rule deterministic CI lints. Path A keeps this verbatim — same 18 rules, same 53 pre-pr-lint stages, same 65 CI jobs. | `vision.md` + `scripts/check-rule-*.mjs` + `.github/workflows/ci.yml` |
| 2 | **MAPE-K substrate (across-session learning)** | **YES.** OpenHands ships per-session observability; Minsky's MAPE-K is across-session. No shipping product implements MAPE-K formally. Closest research is Live-SWE-agent's runtime-self-evolution (different mechanism). | `novel/mape-k-loop/` + `novel/experiment-record/` |

The four collapsed/partial moats:

| # | Old moat | What Path A does with it |
|---|---|---|
| 3 | Daemon, not framework | **Collapsed into the autonomic shell** (4-file replacement: launchd plist + `bin/minsky` thin wrapper + `repo.yaml` sidecar + a shell loop). ~300 lines of bash + yaml. |
| 4 | Operator-machine identity | **Collapsed into the autonomic shell.** The OpenHands sandbox commits as `openhands@sandbox`; Minsky's shell rewrites the author on push-mirror. Already a ~50-line responsibility. |
| 5 | Cross-repo fleet | **Replaced with ~500 lines of shell that runs `openhands solve` per host in round-robin.** Same end-user-visible behavior (`--hosts-dir <parent>`); 95% smaller implementation. |
| 6 | TASKS.md as operator surface | **Becomes a portable convention.** Already published at github.com/tasksmd/tasks.md; the Python picker is ~200 lines (including rule-9 field validation). |

## Package-by-package fate (Path A — supersedes Path C where conflicting)

The Path C plan kept 14 packages → ~10 packages. Path A keeps 14 → **~5-6 packages**. Aggressive-cut deletions (beyond what Path C plans) are marked **AGGRESSIVE DELETE**.

| Package | LOC (approx) | Path C fate | Path A fate | Replacement |
|---|---:|---|---|---|
| `novel/adapters/notifier/` | ~400 | Keep | **Keep** | — |
| `novel/adapters/observability/` | ~600 | Keep | **Keep** | — |
| `novel/adapters/persona-spawner/` | ~800 | Delete | **Delete** | OpenHands MicroAgents |
| `novel/adapters/prompt-optimizer/` | ~500 | Keep | **AGGRESSIVE DELETE** — fold spec into `novel/mape-k-loop/` as text; the substrate isn't yet built so the directory is empty scaffolding | `novel/mape-k-loop/spec/prompt-optimizer.md` |
| `novel/adapters/token-monitor/` | ~300 | Delete | **Delete** | Claude-Code-Usage-Monitor |
| `novel/adapters/types/` | ~200 | Keep | **Keep** | — |
| `novel/bridges/omc-tasksmd/` | ~600 | Re-scope | **AGGRESSIVE DELETE** — the 2026-05-22 OMC reassessment already noted most of OMC's surface is covered by OpenHands' native persona stack | — (OMC integration removed entirely) |
| `novel/budget-guard/` | ~800 | Keep | **AGGRESSIVE DELETE** — folded into the autonomic shell as a 50-line `check-budget.sh` script | `bin/check-budget.sh` |
| `novel/competitive-benchmark/` | ~3K | Fold into experiment-record | **Fold into static markdown corpus** at `competitors/scorecard.md` — the M1.10 milestone is already met; the corpus stops being executable, becomes static reference data | `competitors/scorecard.md` |
| `novel/cross-repo-runner/` | ~10.8K | Keep (moat anchor) | **AGGRESSIVE DELETE** — replaced by ~500 lines of shell + a small Python TASKS.md picker | `bin/minsky-run` (shell, ~300 lines) + `scripts/pick_task.py` (~200 lines) |
| `novel/dashboard-web/` | ~6K | Delete | **Delete** | `minsky watch` CLI + OpenHands WebSocket |
| `novel/experiment-record/` | ~2K | Keep + absorb | **Keep** | — (MAPE-K anchor) |
| `novel/handoff-spec/` | ~1.5K | Re-scope | **AGGRESSIVE DELETE** — the brief format becomes a Markdown template, no TypeScript needed | `templates/task-brief.md` |
| `novel/human-loop/` | (planned, never built) | Planned | **Delete the directory entirely** — replaced by `ask_human.md` + ask-human-mcp (adopted 2026-05-24 in PR #791) | `ask_human.md` |
| `novel/mape-k-loop/` | ~4K | Keep | **Keep** | — (the moat) |
| `novel/observer/` | ~3K | Keep + merge | **AGGRESSIVE DELETE** — runtime invariants become inline checks in the shell-based `bin/minsky-run`; the observer pattern is over-engineered for 5 invariants | inline in `bin/minsky-run` |
| `novel/sidecar-bootstrap/` | ~1K | Keep | **Keep** (operator-machine-identity glue) | — |
| `novel/spec-monitor/` | ~2K | Merge with observer | **AGGRESSIVE DELETE** | inline in `bin/minsky-run` |
| `novel/tick-loop/` | ~3K | Keep (MAPE-K anchor) | **AGGRESSIVE DELETE** — folded into `bin/minsky-run`'s outer loop | inline in `bin/minsky-run` |
| `novel/tui/` | ~2K | Re-scope | **AGGRESSIVE DELETE** — `tail -f ~/.minsky/daemon.log` + the OpenHands WebSocket stream replaces the custom TUI | `tail -f` + `openhands stream` |

**Net LOC delta**: ~62K → **~8K** (vs Path C's ~40K). Roughly 87% cut.

**Surviving packages** (5 total):
1. `novel/adapters/` (notifier + observability + types) — 1.2K LOC
2. `novel/experiment-record/` — 2K LOC
3. `novel/mape-k-loop/` — 4K LOC
4. `novel/sidecar-bootstrap/` — 1K LOC (minimized)
5. `competitive-benchmark/` — folded to static markdown (~500 lines of MD, ~0 lines of code)

**Surviving non-package surface**:
- `vision.md` — 800 lines (the constitution + rules + theoretical anchors)
- `scripts/check-rule-*.mjs` — ~10K LOC of constitutional linters (UNIQUE, no replacement)
- `.github/workflows/ci.yml` — the 65 CI jobs (UNIQUE)
- `bin/minsky-run` — NEW, ~300 lines of bash replacing all of cross-repo-runner + tick-loop
- `scripts/pick_task.py` — NEW, ~200 lines of Python replacing the TASKS.md picker logic
- `templates/task-brief.md` — NEW, the task-brief markdown template (replaces handoff-spec)
- `ask_human.md` — already shipped 2026-05-24 (PR #791)
- `distribution/launchd/*.plist` + `distribution/systemd/*` — KEEP (already minimal)

Total LOC: **~7-9K**. Inside the 1-FTE sustainable budget. Mission accomplished.

## Phase plan (Path A extension to Path C)

Path C's Phases 0-3 already shipped or in-progress. Path A's aggressive-cut phases extend with:

### Phase 7 — Replace `novel/cross-repo-runner/` with shell

- **Task**: `path-a-phase-7-cross-repo-runner-shell-rewrite` (P0)
- **Trigger**: Path C Phase 3 (Pilot package replacement) ships AND OpenHands wrap is the default `cloud_agent`.
- **Work**:
  1. Write `bin/minsky-run` in bash — ~300 lines. Reads `~/.minsky/config.json`; for each host under `--hosts-dir`, runs `openhands solve --task-file <brief.md> --workspace <host> --model <config.model>` in round-robin (3 iterations per host per pass). Captures the iteration record to `~/.minsky/iterations.jsonl`.
  2. Write `scripts/pick_task.py` in Python — ~200 lines. Reads TASKS.md, validates rule-9 fields, returns the top-priority unclaimed task ID. Standalone CLI: `python pick_task.py /path/to/TASKS.md` outputs `task-id` or empty.
  3. Run both against the existing fixture set in `novel/cross-repo-runner/test/` to confirm parity.
  4. Once parity confirmed, `rm -rf novel/cross-repo-runner/` in a follow-up commit.
- **Success**: `bin/minsky-run --hosts-dir ~/apps` completes 1 round-robin pass across ≥3 hosts in <30 minutes, opening ≥1 draft PR per host that touched a task. `wc -l novel/cross-repo-runner/src/*.ts` returns 0 (directory deleted).
- **Pivot**: if the bash rewrite hits >100 hours of integration debugging (which would suggest the TypeScript complexity was load-bearing), revert to Path C's "keep cross-repo-runner" plan and stop the aggressive cut here.
- **Measurement**: `test -d novel/cross-repo-runner && echo "still here" || echo "deleted"` returns `deleted`; `wc -l bin/minsky-run scripts/pick_task.py` ≤ 600.
- **Anchor**: rule #1; the bash rewrite philosophy (small focused shell + careful Python for the parser); operator directive 2026-05-24 "2".

### Phase 8 — Fold `novel/tick-loop/` + `novel/observer/` + `novel/spec-monitor/` into `bin/minsky-run`

- **Task**: `path-a-phase-8-tick-observer-spec-monitor-inline-fold` (P0)
- **Trigger**: Phase 7 ships.
- **Work**:
  1. The tick-loop's outer iteration logic becomes the outer `for` loop in `bin/minsky-run`.
  2. The observer's 5 runtime invariants become inline checks in `bin/minsky-run` (5 small bash functions).
  3. The spec-monitor's specification-drift detection becomes a single `check-rule-coverage.mjs` lint that runs in pre-pr-lint.
  4. Delete `novel/tick-loop/`, `novel/observer/`, `novel/spec-monitor/` directories.
- **Success**: All three directories deleted. `bin/minsky-run --self-check` exits 0 with a 1-line summary of each invariant.
- **Pivot**: if the inline-fold makes `bin/minsky-run` exceed 600 lines, split into `bin/minsky-run` + `lib/invariants.sh` (still inside the budget).
- **Measurement**: same as Phase 7's measurement.
- **Anchor**: rule #1.

### Phase 9 — Delete `novel/handoff-spec/`, `novel/budget-guard/`, `novel/tui/`, `novel/bridges/omc-tasksmd/`, `novel/adapters/prompt-optimizer/`

- **Task**: `path-a-phase-9-small-package-sweep-delete` (P0)
- **Trigger**: Phase 8 ships.
- **Work**:
  1. `novel/handoff-spec/` → replaced by `templates/task-brief.md`. ~80 lines of markdown.
  2. `novel/budget-guard/` → replaced by `bin/check-budget.sh`. ~50 lines of shell that checks the spend ledger.
  3. `novel/tui/` → deleted; `tail -f ~/.minsky/daemon.log` + `openhands stream` replace it.
  4. `novel/bridges/omc-tasksmd/` → deleted; OMC integration removed entirely (per the 2026-05-22 reassessment).
  5. `novel/adapters/prompt-optimizer/` → spec folded into `novel/mape-k-loop/spec/prompt-optimizer.md` (the substrate is unbuilt anyway).
- **Success**: All 5 directories deleted. Replacements exist and are tested.
- **Pivot**: if any replacement's reduced LOC produces ≥1 lost capability (i.e. a previously-passing test fails), restore that one package and document the why.
- **Measurement**: `ls novel/ | wc -l` returns ≤ 6 (down from 15).
- **Anchor**: rule #1.

### Phase 10 — Fold `novel/competitive-benchmark/` into static markdown

- **Task**: `path-a-phase-10-competitive-benchmark-static` (P0)
- **Trigger**: Phase 9 ships.
- **Work**:
  1. Render `novel/competitive-benchmark/dist/scorecard.html` to a static markdown file at `competitors/scorecard.md`.
  2. Update `vision.md` and `README.md` references to point at the markdown instead of `bin/minsky competitive`.
  3. Delete `novel/competitive-benchmark/` directory + remove `bin/minsky competitive` CLI subcommand.
  4. Move the per-vendor research files (currently in `competitors/<id>.md`) to be the canonical source — the corpus.ts file is no longer needed.
- **Success**: `competitors/scorecard.md` exists; `bin/minsky competitive` no longer in the CLI help; M1.10 milestone marker updated to "shipped 2026-05-22, static archive 2026-05-XX".
- **Pivot**: if the scorecard needs to be live (vendor numbers change weekly), keep the corpus.ts + scorecard.html generator and only delete the package's other code.
- **Measurement**: `ls novel/competitive-benchmark/ 2>/dev/null | wc -l` returns 0 OR ≤ 3 (keeping only the auto-refresh hook).
- **Anchor**: rule #1.

### Phase 11 — Shrink `novel/sidecar-bootstrap/` to a single template

- **Task**: `path-a-phase-11-sidecar-template-only` (P1)
- **Trigger**: Phase 10 ships.
- **Work**: The sidecar bootstrap today materializes `.minsky/repo.yaml` into host repos. Reduce to a single template file + a 20-line `bin/minsky-bootstrap` shell command that copies it.
- **Success**: `novel/sidecar-bootstrap/` becomes ≤ 200 LOC (down from ~1K).
- **Pivot**: if the template-only version loses repo-detection logic that the daemon depended on, restore that one function but stop there.
- **Measurement**: `wc -l novel/sidecar-bootstrap/**/*.ts` ≤ 200.
- **Anchor**: rule #1.

### Phase 12 — Lint stack pruning sweep (Path C Phase 5, kept as-is)

- **Task**: `lint-stack-audit-post-openhands-wrap` (P1, already filed in TASKS.md per Path C plan)
- **Trigger**: Phase 11 ships.
- **Work**: 53 pre-pr-lint stages → ~20. See Path C plan § "Lint stack pruning framework" for procedure.

### Phase 13 — Identity promotion: Minsky is the discipline pack

- **Task**: `path-a-phase-13-identity-promotion` (P0)
- **Trigger**: Phases 7-12 all ship.
- **Work**:
  1. Rewrite README.md TL;DR with the new identity: *"Minsky is a discipline pack for autonomous coding agents. It enforces 18 constitutional rules (pre-registered HDD, deterministic CI lints, MAPE-K self-observation) on top of OpenHands. The autonomic shell (~300 lines of bash) keeps it running 24/7 across N repos."*
  2. Rewrite `vision.md § "What Minsky is"` for the post-aggressive-cut identity.
  3. Add `minsky-discipline-pack` to agentbrew catalog as the canonical source for the constitutional rules + MAPE-K MicroAgent.
  4. Update Pattern conformance index for every deleted package row (remove or mark "deleted in Path A").
- **Success**: New identity is the canonical one across all surfaces (README, vision, AGENTS.md, INSTALL.md).
- **Pivot**: trivial — this is just docs.
- **Measurement**: `grep -c "plug-and-play repo transformer" README.md vision.md` returns 0; `grep -c "discipline pack" README.md vision.md` returns ≥ 2.
- **Anchor**: rule #1.

## Risks & New failure modes

(Beyond Path C's existing 5 failure modes — all of which still apply.)

### 6. Bash rewrite drifts from TypeScript original

The `bin/minsky-run` bash replacement of `novel/cross-repo-runner/` is shorter but harder to test (bash test coverage is weak). Mitigation: keep the 716-line `task-finder.test.ts` fixture set, rewrite as a shell-based `bats` test harness in `tests/minsky-run.bats`. Test parity is the gate for the deletion.

### 7. The 5 packages we delete had subtle integration glue

`novel/observer/`, `novel/spec-monitor/`, `novel/tick-loop/` had cross-package handoffs (observer notifies tick-loop, spec-monitor advises observer). Inline-folding loses some of those handoffs. Mitigation: the aggressive cut is staged across Phase 7-9; each phase's parity test must pass before the next deletion starts.

### 8. The discipline pack distribution path is uncertain

Path A keeps Minsky as a thinner repo (~5-10K LOC) but doesn't move the constitutional rules to a separately-installable pack. If you want users to adopt the discipline WITHOUT installing all of Minsky, that's Phase 14 (not yet planned) — extract `scripts/check-rule-*.mjs` + `vision.md` + `templates/task-brief.md` to a `minsky-discipline-pack` npm package distributable via `agentbrew install minsky-discipline-pack`.

### 9. The constitutional discipline still requires OpenHands

After Path A, the discipline ONLY runs on top of OpenHands (the only supported `cloud_agent`). If OpenHands changes its CLI in a breaking way, Minsky breaks. Mitigation: keep `novel/adapters/notifier/` and `novel/adapters/observability/` as the abstraction layer so future agent backends (a hypothetical OpenAgents-2 in 2027) can be added without re-running the entire migration.

## What we lose (vs Path C's "what we lose")

Path C's failure-modes section already documented 5 losses. Path A adds:

- **Custom TUI** (`novel/tui/`). The replacement is `tail -f ~/.minsky/daemon.log` + `openhands stream`. Acceptable.
- **Custom observer pattern**. Replaced by inline bash functions. The "every dependency through an interface" rule (#2) becomes harder to enforce for the inline invariants, BUT the invariants are now small enough to grok at a glance. Acceptable trade-off.
- **Budget-guard package independence**. The budget check becomes a script, not a service. Acceptable.
- **`bin/minsky competitive` live CLI**. Replaced by static markdown. The M1.10 milestone is met; the corpus stops being executable. Operator decision: weekly competitor refresh continues via the `competitor-research` skill writing to the markdown directly (the skill already supports this).

## Decision log

| When | Decision | Why |
|---|---|---|
| 2026-05-22 | Operator commits to Path C (~30K LOC final) | The 1-FTE math + the openhands-as-substrate vision |
| 2026-05-24 | Operator commits to Path A aggressive cut (~5-10K LOC final) | The brutal-honest moat audit + the 99%-replacement openness |

## Open questions

These are filed as Q-blocks in `ask_human.md` per the adopted convention. They block Phase 13 (identity promotion) but not earlier phases:

1. After Path A completes, should the minsky repo be renamed to `minsky-discipline-pack` or stay as `minsky`?
2. After Path A completes, should the discipline pack also publish as an npm package (so it can install standalone without the full minsky repo)?
3. After Path A completes, should the agentbrew catalog reference `github.com/fyodoriv/minsky` directly, or fork the rule scripts into agentbrew's catalog source list?

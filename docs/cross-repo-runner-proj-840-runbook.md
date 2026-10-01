# `minsky run` runbook — PROJ-840 in `example-capabilities`

Step-by-step operator workflow for one-shotting [PROJ-840 (slash command labels)](https://jira.cloud.example.com/browse/PROJ-840) in `example-org/example-capabilities` using `minsky run`. This is the rule-#9-substrate-enforced version of the manual workflow — every step the runner takes is mechanically validated before any spawn or push.

This runbook is the v0 acceptance for [user-story 006](../user-stories/006-runner-on-any-repo.md) (the cross-repo-runner umbrella).

## Prerequisites

- Minsky checked out at `~/apps/minsky` on `main` (post-PR-#129).
- example-capabilities checked out at `~/apps/example-capabilities-3`.
- PROJ-840 task block present in `~/apps/example-capabilities-3/TASKS.md` with all 5 rule-#9 fields (Hypothesis / Success / Pivot / Measurement / Anchor). The task block was filed in the example-capabilities-3 PR queue 2026-05-04 — see `proj-840-slash-command-labels` in TASKS.md.

## Step 1: bootstrap the host

```bash
cd ~/apps/minsky
node novel/sidecar-bootstrap/bin/minsky-bootstrap.mjs ~/apps/example-capabilities-3
```

This writes:

- `~/apps/example-capabilities-3/.minsky/repo.yaml` — per-host overlay (host_repo, branch_prefix, default_branch, pre_commit_command, etc., inferred from the host's `package.json` + `.git/config`).
- `~/apps/example-capabilities-3/.minsky/experiments/.gitkeep` — rule-#9 substrate root.
- `~/apps/example-capabilities-3/.minsky/vision.md` — symlink to minsky's canonical `vision.md`.
- `~/.config/git/ignore` — appends `.minsky/` so the sidecar never enters example-capabilities-3's git history.

example-capabilities-3 uses `master`, not `main`. Inferred values may need editing — open `.minsky/repo.yaml` and verify:

```yaml
host_repo: "example-org/example-capabilities"
default_branch: "master"
pre_commit_command: "yarn run -T eslint --fix && yarn tsc --build"
ticket_format: "PROJ-\\d+"
```

Run `node novel/sidecar-bootstrap/bin/minsky-bootstrap.mjs --doctor ~/apps/example-capabilities-3` to verify the sidecar is in the GREEN state.

## Step 2: dry-run the runner

```bash
node novel/cross-repo-runner/bin/minsky-run.mjs proj-840-slash-command-labels --host ~/apps/example-capabilities-3
```

This produces:

- `~/apps/example-capabilities-3/.minsky/experiments/proj-840-slash-command-labels.yaml` — pre-registered EXPERIMENT.yaml synthesised from the TASKS.md row.
- `~/apps/example-capabilities-3/.minsky/experiment-store/cross-repo/proj-840-slash-command-labels.jsonl` — iteration record with `verdict: planned`.
- A `RunnerPlan` JSON to stdout — workingDirectory, branchName (`feat/proj-840-slash-command-labels`), env (`MINSKY_HOST_ROOT=~/apps/example-capabilities-3/.minsky`), system-prompt overlay (the constitution), brief.

The dry-run is the *pre-flight*: it catches rule-#9 violations (missing fields), task-not-found, host-not-bootstrapped, and any other input error before any subprocess spawns. If the dry-run exits 0, the operator-driven step (next) is safe.

## Step 3: drive the spawn (v0 — manual)

v0 ships dry-run as the safe default. Live-spawn (auto-spawn Claude Code wrapped in BudgetGuard) is the v1 follow-up. For the v0 path, the operator drives Claude Code manually:

```bash
cd ~/apps/example-capabilities-3
git checkout master
git pull
git checkout -b feat/proj-840-slash-command-labels

# Open Claude Code in this directory, paste the system-prompt overlay
# from the dry-run's stdout, then paste the brief on stdin.
# The constitution + the 5 rule-#9 fields drive the spawn.
```

Claude Code then ships the PROJ-840 fix per the task's acceptance criteria:

- `plugins/example-ai-native/src/store/selectors/commandCenterConfig.ts` — change `title: "hold"` → `title: "Put on hold"` and `title: "lead"` → `title: "Lead support"`.
- Update `plugins/example-ai-native/src/store/selectors/selectResolvedTools.spec.ts` to assert the new strings.
- Run `yarn vitest run plugins/example-ai-native/src/store/selectors/selectResolvedTools.spec.ts` (the EXPERIMENT.yaml's measurement command). Tests pass red→green.
- Run `yarn run -T eslint --fix` + `yarn tsc --build`.
- Commit + push the branch.
- Open a PR on `example-org/example-capabilities` whose body carries the `Hypothesis self-grade` block per the constitution.

## Step 4: record the iteration outcome

After the host PR merges (or doesn't), update the iteration record:

```bash
# Append a 'validated' or 'regressed' line to the iteration store.
cat >> ~/apps/example-capabilities-3/.minsky/experiment-store/cross-repo/proj-840-slash-command-labels.jsonl <<'EOF'
{"ts":"2026-05-XX...","experiment_id":"proj-840-slash-command-labels","host_repo":"example-org/example-capabilities","branch":"feat/proj-840-slash-command-labels","verdict":"validated","pr_url":"https://...","notes":"shipped + merged"}
EOF
```

(In v1, `minsky run` will detect the merged PR via `gh pr view` and write this record automatically.)

## What this proves

The full workflow is mechanically validated by the integration test at `novel/cross-repo-runner/test/integration/proj-840-shape.test.ts`. The test exercises the same code path against an PROJ-840-shaped fixture host and asserts:

1. Bootstrap creates the right sidecar artefacts.
2. The runner finds the task by both ID and ticket-key (PROJ-840).
3. The synthesiser writes the EXPERIMENT.yaml with all 5 rule-#9 fields.
4. The iteration record is appended with `verdict: planned`.
5. The runner plan emitted to stdout contains the right env / branch / prompt.
6. Idempotent re-runs append additional records without crashing.
7. **Rule-#9 violations exit 1 loudly** — a task missing any of the 5 fields cannot ship.
8. Host-not-bootstrapped exits 1 with the bootstrap suggestion.
9. Task-not-found exits 1 with the available IDs list.

Per [user-story 006](../user-stories/006-runner-on-any-repo.md)'s acceptance, this is what "minsky governs any host repo with the constitution intact" looks like at v0.

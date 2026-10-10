<!-- pattern: not-applicable — reference file of skill-plugins/observer/minsky/SKILL.md, covered by that skill's pattern-index row -->

# Minsky observer — §8 Tips & tricks (operational knowledge)

This file exists so the observer skill stays short. It holds the §8 operational knowledge: command timeouts, key files, per-agent quirks, multi-host walks, experiment records, CI results, proactive healing, default-by-default, commit timing, and session handoff. Read it when a monitor loop hits something the main steps do not cover.

## Contents

- §8 Tips & tricks (operational knowledge)
  - Command timeout discipline
  - Key files to read
  - Per-agent quirks
  - Multi-host walk behavior
  - Interpreting experiment records
  - Always test with daemon stopped
  - Reading CI results (integration + runtime tests)
  - Proactive healing — observe-and-fix is ONE action (rule #17 — iron, no exemption)
  - Default by default (rule #16 — always follow)
  - When to commit before starting minsky
  - Session handoff

## 8. Tips & tricks (operational knowledge)

### Command timeout discipline

**NEVER run a minsky command as a blocking call that could hang.**
Every command should complete in <30s or be run non-blocking:

- `minsky status` — always fast (<2s). Safe to block.
- `minsky stop` — fast (<5s). Safe to block.
- `minsky daemon start` — returns immediately (daemon backgrounds). Safe.
- `minsky --host X --once --no-live` — can take minutes. Run non-blocking or with a timeout.
- `minsky --host X --once --live` — can take 5-15 min. NEVER block on this.
- `tail -N ~/.minsky/daemon.log` — always fast. Safe.
- `ps aux | grep claude` — always fast. Safe.

### Key files to read

| File | What it tells you |
|---|---|
| `~/.minsky/config.json` | Which agent + model this machine uses |
| `~/.minsky/daemon.log` | Daemon stdout — host walks, experiment writes |
| `~/.minsky/daemon.pid` | PID of the running daemon (stale = daemon died) |
| `<host>/.minsky/experiment-store/cross-repo/*.jsonl` | Per-task iteration records (verdict, PR URL, duration) |
| `<host>/.minsky/experiments/*.yaml` | Per-task experiment YAML (hypothesis, measurement) |
| `<host>/.minsky/observer.log` | Your own audit trail |
| `<host>/.minsky/repo.yaml` | Host config (repo slug, branch prefix, pre-commit) |

### Per-agent quirks

**Claude Code** (`cloud_agent: "claude"`):

- Brief delivery: stdin (`child.stdin.end(brief)`).
- Typical iteration time: 3-10 min.
- Watchdog: computed from iteration history (rule 14b, dynamic settings). Do not pin it with an env var; see `docs/DEPRECATED.md` for the escape hatch.
- May hang with 0% CPU — the 2026-05-07 hang ran 1h56m. The watchdog exists for this.

**Aider / local** (`--local` mode):

- Brief delivery: `--message-file` (written to temp file).
- Typical iteration time: 10-30 min (local models are slower).
- Watchdog: 1800s (30 min) default.
- Requires ollama running: `ollama serve` must be active.

### Multi-host walk behavior

- Hosts are walked **alphabetically** by directory name.
- Each host gets **at most 3 iterations** per walk pass (per-host cap).
- After all hosts are drained, the walker **loops** (starts over from the first host).
- `spawn-failed` on one host **skips** to the next (doesn't halt the walk).
- `scope-leak` on any host **halts** the entire walk.
- `empty-queue` on a host → advance to next host.

### Interpreting experiment records

```bash
# Quick session summary
# Adjust the path to match your hosts-dir or single --host target
for f in <HOSTS_DIR>/*/.minsky/experiment-store/cross-repo/*.jsonl; do
  [ -f "$f" ] || continue
  total=$(wc -l < "$f")
  validated=$(grep -c '"validated"' "$f")
  failed=$(grep -c '"spawn-failed"' "$f")
  prs=$(grep -c '"pr_url":"http' "$f")
  host=$(basename "$(dirname "$(dirname "$(dirname "$(dirname "$f")")")")")
  task=$(basename "$f" .jsonl)
  echo "$host/$task: $total total, $validated validated, $failed failed, $prs PRs"
done
```

### Always test with daemon stopped

After any change to `bin/minsky`, test BOTH states:

```bash
minsky stop; rm -f ~/.minsky/daemon.pid   # daemon off
minsky watch                               # must not crash
minsky status                              # must not crash
minsky daemon start --host $(pwd)              # start
minsky watch                               # must render with data
```

The empty-state path (no daemon, no PID, no log) is where most
`unbound variable` bugs hide. `set -u` catches them but only at
runtime.

### Reading CI results (integration + runtime tests)

CI runs 4 test layers. Check them before concluding "tests pass":

```bash
# Quick: did the last push's CI pass?
gh run list --limit 1 --json conclusion,name --jq '.[0]'

# Detailed: which jobs passed/failed?
gh run view --json jobs --jq '.jobs[] | {name, conclusion}'

# Integration test results specifically:
gh run view --json jobs --jq '.jobs[] | select(.name == "integration-tests") | {conclusion, steps: [.steps[] | {name, conclusion}]}'

# Download M1 metrics artifact from CI:
gh run download --name m1-metrics --dir /tmp/m1-ci-metrics
cat /tmp/m1-ci-metrics/m1-metrics.json | python3 -m json.tool
```

**CI jobs and what they cover:**

| Job | What it tests | Timeout |
|---|---|---|
| `test` | Unit tests + v8 coverage (3000+ tests) | 5min |
| `integration-tests` | Fixture-driven e2e + M1 TDD suite | 10min |
| `markdownlint` | Markdown formatting | 1min |
| `typecheck` | TypeScript compilation | 2min |

**Local equivalents:**

```bash
pnpm test                    # unit tests (fast)
pnpm test:integration        # integration tests (slow, 120s timeout)
pnpm test:m1-tdd             # M1 red-green acceptance tests
`bin/minsky m1 metrics`              # which M1 measurements pass
`bin/minsky m1 observability`        # which M1 tasks have observability gaps
`bin/minsky m1 coverage`             # 6-layer composite coverage number
```

### Proactive healing — observe-and-fix is ONE action (rule #17 — iron, no exemption)

**You don't observe errors. You fix them.** Every error surfaced by the
daemon, by `pnpm test`, by `pnpm typecheck`, by `gh pr checks`, by
`minsky status`, by ANY tool while watching minsky is treated as work
to be done in the SAME session, not noted for later.

The discipline:

1. **Observation = work item.** When you see `GraphQL 401`, `spawn-failed`,
   `ETIMEDOUT`, `scope-leak`, stack traces, hung processes, stale state —
   you do not "make a mental note", you do not "we'll address this next
   sprint". You do not even ask whether to fix it. You FIX IT NOW or you
   file a structured task block with `**Blocked**:` if completing it
   needs an external action — but never both: never silently move on.

2. **Fix the class, not the instance.** A 401 today means the auth path
   is fragile. Don't restart and pray — find the swallowing-catch, the
   missing timeout, the unbounded retry, the un-deduped error spam. Each
   fix lands as: (a) a failing test that reproduces the class, (b) the
   smallest minimal patch, (c) the lint rule or invariant that prevents
   the entire category from recurring. Rule #10 enforcement is the goal:
   "the same bug cannot reach CI twice." Anchor: Forsgren, Humble, Kim,
   *Accelerate*, 2018 (DORA — change-fail rate is reduced by preventing
   classes, not patching instances).

3. **Heal before reporting.** Every status message to the operator must
   already contain the verb "fixed", "patched", "rolled out", or
   "filed-blocked-because". A status that's only "I observed X" is a
   constitutional violation of rule #17 — it shifts work onto the
   operator the agent could have done.

4. **The same loop applies to minsky itself.** When the daemon spits a
   recurring failure mode (`spawn-failed` × 5, `scope-leak` × 3), the
   observer's next action is to: (a) read the root cause from
   `~/.minsky/daemon.log`, (b) land a fix in `novel/cross-repo-runner/`
   or `novel/tick-loop/` with a failing-test-first per rule #3, (c)
   `minsky update` to roll it forward, (d) re-verify stability rises.
   File a TASKS.md block ONLY if the fix requires external action
   (a credential, a sysctl, an upstream PR) — in which case the block
   carries `**Blocked**: <code>` and the unblock path is the first line.

5. **Anti-pattern: the watcher who narrates.** A monitoring session that
   produces a 10-bullet summary of failures and zero merged fixes is the
   exact thing rule #17 forbids. It looks like attentive work; it's
   actually load shed to the operator. The deterministic gate is:
   *if observed-errors > 0 and PRs-opened + tasks-filed = 0, the
   session is a violation.* Lint: `scripts/check-rule-17-proactive-heal.mjs`
   (P0, TASKS.md `rule-17-proactive-heal-lint`).

This is the same shape as rule #6 ("stay alive"; let-it-crash +
supervisor restart) but elevated to the observer's own conduct: if the
observer is silently degrading by watching-without-fixing, the
supervisor (the operator) loses information about the real failure
rate.

**Trigger phrases that activate rule #17 IMMEDIATELY (don't ask, just
fix):**

- "fix bugs before they happen" / "be proactive"
- "make sure minsky gracefully picks them up"
- "heal minsky on the way"
- "make it persist" / "make it iron rule"

Sources: Forsgren/Humble/Kim, *Accelerate*, 2018 (change-fail rate);
Beyer et al., *SRE*, 2016, Ch. 3 (error budgets — observation that
doesn't move the budget is dead weight); Armstrong, *Programming Erlang*,
2007 (let-it-crash applies to the observer itself); operator directive
2026-05-19 ("why aren't they being fixed by you right away? I expect
that"); rule #6 (stay alive); rule #10 (deterministic enforcement);
rule #16 (default by default — proactive healing is the default
observer behaviour, not an opt-in mode).

### Default by default (rule #16 — always follow)

Every new behavior ships as the default. Never hide behind an opt-in flag.

- If it's reasonable for all users → make it the default NOW
- Ship with: experiment + measurement + opt-out (for debugging only)
- The question is "why ISN'T this the default?" — not "should we enable it?"
- Opt-out flags go to DEPRECATED.md the moment they're never used

Examples already shipped:

- Scope-leak soft mode → default (daemon never halts on scope-leak)
- Launchd persistence → auto-installed on first `minsky` run
- Dynamic timeouts → computed from iteration history, not hardcoded
- Smart auto-attach → type `minsky` → it just works
- Stale PID cleanup → automatic on daemon startup

**When implementing a task**: if you catch yourself writing `MINSKY_ENABLE_X=1`,
stop — make X the default and write `MINSKY_DISABLE_X=1` as the escape hatch
instead. Then immediately file that escape hatch in DEPRECATED.md.

### When to commit before starting minsky

If you've made changes to the minsky repo (or any host repo) that are
uncommitted, **commit them first**. The scope-leak detector will flag
uncommitted changes as violations and halt the walk. This is the #1
cause of `scope-leak` in dogfood mode.

### Session handoff

If you're ending your agent session but minsky should keep running:

1. Verify `minsky status` shows running.
2. The daemon is SIGHUP-immune — it survives terminal close.
3. Log the current state: `minsky status 2>&1 > /tmp/minsky-handoff.txt`
4. Tell the next session: "minsky daemon PID XXXX is running on
   <hosts-dir>. Config: <agent> + <model>. Check `minsky status` and
   `tail ~/.minsky/daemon.log`."

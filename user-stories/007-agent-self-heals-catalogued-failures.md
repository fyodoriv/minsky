# Story 007 — Agent self-heals catalogued failures within 5 minutes

> **Why this story exists.** MILESTONES.md M1.13 ("agents can self-heal minsky") requires "≥10 catalogued failure modes with automated fixes + MTTR < 5 min". Today the Observer skill's heal catalogue (`skill-plugins/observer/minsky/SKILL.md` §4) lists 10 recipes — most are operator-instructions like "run `rm -f ~/.minsky/daemon.pid` then retry", NOT something an agent does autonomously. This story ships **phase 1 of 2** of the closure: 4 automated heals + an MTTR ledger + reporter + chaos test. Phase 2 (`promote-remaining-heal-recipes`) carries the ≥10-automated target. Plan: `docs/plans/agents-can-self-heal-minsky-m1-13.md` (reviewer-approved round 2).

## Story

As a solo developer running minsky overnight, when the daemon fails with a catalogued symptom — stale pid file, missing worktree node_modules after a node version flip, stale .tsbuildinfo from yesterday's node 18, or a shell that polled three times with no output — the agent detects the symptom from its own logs, applies the fix idempotently, verifies the fix worked, and continues. I never have to wake up to type `rm -f`.

## Acceptance criteria

- Each of 4 catalogued failure modes (stale-pid, missing-node-modules, stale-tsbuildinfo, stuck-command) has a `detect()`/`apply()`/`verify()` heal helper in `novel/observer/heals/`
- Each helper is idempotent under replay (calling `apply()` twice doesn't break things)
- Each helper's `verify()` returns `{ healed: false, residualSignal: ... }` (not a throw) when `apply()` didn't fix the underlying symptom
- An MTTR ledger at `.minsky/heal-events.jsonl` (per-host, append-only JSONL) records every heal attempt
- The reporter `scripts/heal-mttr-report.mjs` computes multi-window stats (24h / 7d / 30d) and outputs JSON
- The `mttr-self-heal` metric appears in `METRICS.md` with a real value (not the OTEL-blocked stub) once any helper fires
- A chaos test injects each catalogued failure and asserts heal + MTTR ≤ 5 min

## Metric

- **Name**: `mttr-self-heal`
- **Definition**: p95 of `duration_ms` across heal-events with `outcome="healed"` over the trailing 30 days, per host
- **Threshold**: p95 < 300_000 ms (5 minutes) per M1.13's acceptance criterion
- **Source**: `.minsky/heal-events.jsonl` per host, aggregated by `scripts/heal-mttr-report.mjs` and collected by `scripts/collect-metrics.mjs`'s new `collectMttrSelfHeal()` collector

## Integration test

- **File**: `novel/observer/heals/test/chaos/heal-catalogue-mttr.test.ts` (chaos test, ≥4 cases)
- **Setup**: hermetic fixture host via `mkdtempSync`; one failure signal injected per `test.each` iteration (injection table: see `docs/plans/agents-can-self-heal-minsky-m1-13.md` Step 6)
- **Action**: invoke `helper.detect()` → assert `{ present: true }`; invoke `helper.apply()`; invoke `helper.verify()` → assert `{ healed: true }`
- **Assert**:
  - All 4 helpers return `healed: true` within the test timeout
  - The ledger gained one row per helper with `duration_ms < 300_000`
  - The fixture host directory is cleaned on teardown (`afterEach` removes `mkdtemp` path)

## Proof

- **Live**: `node scripts/heal-mttr-report.mjs --window=30d --json` returns one element with `successful >= 1` once any heal helper fires on a real host
- **METRICS.md**: `## mttr-self-heal` section shows a real p95 number, not `(stub)`
- **vision.md**: pattern-conformance row 90 maps `novel/observer/heals/` to "SRE on-call automation" with citation to Beyer et al. 2016 Ch. 6 + Ch. 11
- **Test green**: `pnpm vitest run novel/observer/heals novel/observer/test/chaos scripts/heal-mttr-report.test.mjs` exits 0 with ≥15 tests

## Given/When/Then scenarios

Per AGENTS.md rule #3 ("Acceptance-scenario gate"): every test file references one scenario by name in a comment. **Maintenance**: when adding a new heal helper, add a scenario block here BEFORE writing the helper's test file.

### Scenario: heal-stale-pid detects and removes a pid file pointing at a dead process

- **Given** the host's pid file path exists with content `99999\n`
- **And** `kill(0, 99999)` returns ESRCH
- **When** `heal-stale-pid.detect({ fs, hostDir })` runs
- **Then** it returns `{ present: true, signal: "stale-pid", evidence: { pid: 99999 } }`
- **When** `heal-stale-pid.apply({ fs, hostDir })` runs
- **Then** the pid file no longer exists
- **And** `heal-stale-pid.verify({ fs, hostDir })` returns `{ healed: true }`
- **And** an entry was appended to `.minsky/heal-events.jsonl` with `failure_class="stale-pid"` and `outcome="healed"`

### Scenario: heal-stale-pid is a no-op when the pid is alive

- **Given** the host's pid file exists with content matching the current process pid
- **And** `kill(0, currentPid)` returns 0 (success)
- **When** `heal-stale-pid.detect({ fs, hostDir })` runs
- **Then** it returns `{ present: false }`
- **And** the test does not call `apply()`

### Scenario: heal-stale-pid is a no-op when the pid file does not exist

- **Given** the host's pid file does not exist
- **When** `heal-stale-pid.detect({ fs, hostDir })` runs
- **Then** it returns `{ present: false }`

### Scenario: heal-stale-pid is idempotent under replay

- **Given** the host's pid file exists with content `99999\n` (dead pid)
- **When** `heal-stale-pid.apply({ fs, hostDir })` is called twice in sequence
- **Then** the first call removes the pid file
- **And** the second call's `detect()` returns `{ present: false }` so `apply()` is a no-op
- **And** no error is thrown

### Scenario: heal-worktree-missing-node-modules detects and installs

- **Given** cwd is a worktree at `<host>/.worktrees/feature-x/`
- **And** `package.json` exists
- **And** `node_modules/` does not exist
- **When** `heal-worktree-missing-node-modules.detect({ fs, cwd })` runs
- **Then** it returns `{ present: true, signal: "missing-node-modules" }`
- **When** `heal-worktree-missing-node-modules.apply({ fs, cwd, execFn })` runs with a stub `execFn` that simulates `pnpm install` success
- **Then** the stub `pnpm install --prefer-offline` was called with `cwd === <host>/.worktrees/feature-x/`
- **And** `verify()` returns `{ healed: true }` when `node_modules/.bin/biome` exists

### Scenario: heal-worktree-missing-node-modules verify-fails gracefully

- **Given** the same starting state as the previous scenario
- **And** the stub `execFn` returns success but does NOT create `node_modules/.bin/biome`
- **When** `apply()` is called
- **Then** `verify()` returns `{ healed: false, residualSignal: "biome-missing-after-install" }`
- **And** the ledger entry has `outcome="verified-failed"`
- **And** no exception is thrown

### Scenario: heal-worktree-missing-node-modules is no-op outside a worktree

- **Given** cwd is `<host>` (not under `.worktrees/`)
- **When** `detect({ fs, cwd })` runs
- **Then** it returns `{ present: false }` regardless of `node_modules/` state

### Scenario: heal-stale-tsbuildinfo detects and unlinks build cache from old node version

- **Given** `<host>/.tsbuildinfo` exists with content `{ "version": "old-node-18-hash" }`
- **And** the current process is running node 20
- **When** `heal-stale-tsbuildinfo.detect({ fs, hostDir, currentNodeVersion })` runs with `currentNodeVersion="20.x"`
- **Then** it returns `{ present: true, signal: "stale-tsbuildinfo", evidence: { path: "<host>/.tsbuildinfo", staleFor: "old-node-18-hash" } }`
- **When** `apply()` runs
- **Then** the `.tsbuildinfo` file is removed
- **And** `verify()` returns `{ healed: true }`

### Scenario: heal-stale-tsbuildinfo recurses into subpaths

- **Given** `<host>/.tsbuildinfo` AND `<host>/novel/cross-repo-runner/.tsbuildinfo` both reference old node
- **When** `apply()` runs
- **Then** both files are removed
- **And** the ledger entry's `fix_applied` includes both paths

### Scenario: heal-stale-tsbuildinfo is idempotent

- **Given** stale `.tsbuildinfo` exists
- **When** `apply()` is called twice
- **Then** the first call unlinks the file
- **And** the second call's `detect()` returns `{ present: false }` and `apply()` is a no-op

### Scenario: heal-stuck-command detects a shell with no output beyond the threshold

- **Given** a shell id `abc123` running `sleep 1000`
- **And** the agent runtime's polling loop recorded `polls_without_output >= 3` for that shell
- **When** `heal-stuck-command.detect({ shellId: "abc123", pollsWithoutOutput: 3, processPid: <pid of sleep> })` runs
- **Then** it returns `{ present: true, signal: "stuck-command", evidence: { shellId: "abc123", pollsWithoutOutput: 3 } }`
- **When** `apply({ shellId, processPid, killFn })` runs
- **Then** `killFn` was called with the process pid
- **And** `verify({ processPid })` returns `{ healed: true }` when `kill(0, pid)` returns ESRCH

### Scenario: heal-stuck-command is no-op below the threshold

- **Given** a shell with `polls_without_output === 2`
- **When** `detect()` runs
- **Then** it returns `{ present: false }`

### Scenario: heal-stuck-command verify confirms the process actually died

- **Given** a shell whose process pid is now dead
- **When** `verify({ processPid })` runs
- **Then** it returns `{ healed: true }`
- **When** the same `verify()` runs against a still-living pid (negative-control test)
- **Then** it returns `{ healed: false, residualSignal: "process-still-alive" }`

### Scenario: heal-corrupt-state-json detects an unparseable state file

- **Given** `.minsky/state.json` contains truncated content (e.g. `'{"last_iter": 42, "incomplete'`) from a crashed mid-write
- **When** `heal-corrupt-state-json.detect({ stateFilePath })` runs
- **Then** it returns `{ present: true, signal: "corrupt-state-json", evidence: { stateFilePath, contentLength, contentPreview } }`

### Scenario: heal-corrupt-state-json backs up the bad file and reseeds empty {}

- **Given** an unparseable `.minsky/state.json` AND a current timestamp `1_700_000_000_000`
- **When** `heal-corrupt-state-json.apply({ stateFilePath, nowFn })` runs
- **Then** the file at `<stateFilePath>.corrupt.1700000000000` contains the original corrupt content
- **And** the file at `<stateFilePath>` contains exactly `"{}\n"` (parseable empty object)
- **And** `apply` returns `{ applied: true, changedFiles: [stateFilePath, backupPath], notes: "backed up to … and reseeded with empty object" }`

### Scenario: heal-corrupt-state-json is a no-op when state.json parses cleanly

- **Given** `.minsky/state.json` contains valid JSON like `'{"last_iter": 42, "last_task": "foo"}'`
- **When** `heal-corrupt-state-json.apply({ stateFilePath })` runs
- **Then** the file is unchanged
- **And** `apply` returns `{ applied: false, changedFiles: [], notes: "no-op: state.json parses cleanly" }`

### Scenario: heal-corrupt-state-json is idempotent under replay

- **Given** an unparseable `.minsky/state.json` and a corresponding `nowFn`
- **When** `apply()` runs once → second `apply()` runs on the resulting state
- **Then** the second call is a no-op (the file is already `"{}\n"` and parses cleanly)
- **And** `verify()` returns `{ healed: true }`

### Scenario: heal-partial-config-write detects an unparseable config file

- **Given** `~/.minsky/config.json` contains truncated content (e.g. `'{"cost_tier": "opus-sonnet", "host_pat'`) from a crashed mid-write
- **When** `heal-partial-config-write.detect({ configFilePath })` runs
- **Then** it returns `{ present: true, signal: "partial-config-write", evidence: { configFilePath, contentLength, contentPreview } }`

### Scenario: heal-partial-config-write backs up the bad file and reseeds empty {}

- **Given** an unparseable `~/.minsky/config.json` AND a current timestamp `1_700_000_000_000`
- **When** `heal-partial-config-write.apply({ configFilePath, nowFn })` runs
- **Then** the file at `<configFilePath>.corrupt.1700000000000` contains the original corrupt content (operator-provided fields preserved in backup)
- **And** the file at `<configFilePath>` contains exactly `"{}\n"` (parseable empty object — daemon's first-iteration path repopulates defaults)
- **And** `apply` returns `{ applied: true, changedFiles: [configFilePath, backupPath] }`

### Scenario: heal-partial-config-write is a no-op when config.json parses cleanly

- **Given** `~/.minsky/config.json` contains valid JSON like `'{"cost_tier": "opus-sonnet"}'`
- **When** `heal-partial-config-write.apply({ configFilePath })` runs
- **Then** the file is unchanged
- **And** `apply` returns `{ applied: false, changedFiles: [], notes: "no-op: config.json parses cleanly" }`

### Scenario: heal-partial-config-write is idempotent under replay

- **Given** an unparseable `~/.minsky/config.json` and a corresponding `nowFn`
- **When** `apply()` runs once → second `apply()` runs on the resulting state
- **Then** the second call is a no-op
- **And** `verify()` returns `{ healed: true }`

### Scenario: heal-agent-rate-limited detects rate-limit signals in stderr

- **Given** a worker's stderr buffer containing `"Error: 429 Too Many Requests"` or `"rate_limit_error"` or `"rate limit exceeded"`
- **When** `heal-agent-rate-limited.detect({ stderr, attemptIndex, sleepMsFn })` runs
- **Then** it returns `{ present: true, signal: "agent-rate-limited", evidence: { attemptIndex, stderrPreview } }`

### Scenario: heal-agent-rate-limited sleeps the backoff and signals retry

- **Given** a detected rate-limit signal AND the default backoff schedule `[30_000, 60_000, 120_000]`
- **When** `apply()` runs at `attemptIndex: 0`
- **Then** `sleepMsFn` is called with `30_000` (first slot)
- **And** `apply` returns `{ applied: true, notes: "slept 30000ms (attempt 1 of 3); caller should retry the spawn" }`
- **When** `apply()` runs at `attemptIndex: 2`
- **Then** `sleepMsFn` is called with `120_000` (third slot)

### Scenario: heal-agent-rate-limited exhausts after the schedule

- **Given** `attemptIndex: 3` (past the default 3-slot schedule)
- **When** `apply()` runs
- **Then** `sleepMsFn` is NOT called
- **And** `apply` returns `{ applied: false, notes: "exhausted 3 retry attempts — caller should escalate to fleet-provider-mode-flip-to-local" }`

### Scenario: heal-agent-rate-limited is a no-op on non-rate-limit stderr

- **Given** stderr like `"ERR_NETWORK_TIMEOUT"` or `"MODULE_NOT_FOUND"`
- **When** `detect()` runs
- **Then** it returns `{ present: false }`
- **When** `apply()` runs
- **Then** `sleepMsFn` is NOT called
- **And** `apply` returns `{ applied: false, notes: "no-op: stderr has no rate-limit signal" }`

### Scenario: heal-ollama-down detects the ECONNREFUSED signal

- **Given** a worker's stderr buffer containing `"Error: connect ECONNREFUSED 127.0.0.1:11434"` or `"openhands: Connection error: cannot reach ollama"` or `"ollama daemon not running"`
- **When** `heal-ollama-down.detect({ stderr, kickFn, probeFn })` runs
- **Then** it returns `{ present: true, signal: "ollama-down", evidence: { stderrPreview } }`

### Scenario: heal-ollama-down kicks the daemon and verifies via probe

- **Given** a detected ollama-down signal AND injected `kickFn` (records the kick) + `probeFn` (returns true after kick)
- **When** `apply()` runs
- **Then** `kickFn` is called exactly once
- **And** `apply` returns `{ applied: true, notes: "kicked ollama daemon — caller should retry the spawn" }`
- **When** `verify()` runs
- **Then** it returns `{ healed: true }` (probe came up)

### Scenario: heal-ollama-down is idempotent — re-kicking healthy ollama is a no-op (launchctl-style)

- **Given** ollama is already running (`probeFn` returns true) but stderr still mentions ECONNREFUSED (stale buffer)
- **When** `apply()` runs twice
- **Then** `kickFn` is called twice (the daemon recognizes the redundant kick — `launchctl kickstart` is a no-op against a healthy daemon)
- **And** `verify()` returns `{ healed: true }`

### Scenario: heal-ollama-down kickFn throw propagates (rule #6)

- **Given** `kickFn` throws `Error("launchctl: kickstart failed")` (e.g., permission denied on a sudo-only host)
- **When** `apply()` runs
- **Then** the throw propagates to the caller — let-it-crash at the I/O boundary

### Scenario: heal-network-partition-mid-spawn detects DNS/TLS/TCP signals

- **Given** stderr containing `"getaddrinfo ENOTFOUND api.anthropic.com"` or `"ETIMEDOUT during TLS handshake"` or `"ECONNRESET mid-stream"` or `"network unreachable"`
- **When** `heal-network-partition-mid-spawn.detect({ stderr, alreadyRetried })` runs
- **Then** it returns `{ present: true, signal: "network-partition-mid-spawn", evidence: { alreadyRetried, stderrPreview } }`

### Scenario: heal-network-partition-mid-spawn sleeps 30s then signals caller-retry

- **Given** a detected partition signal AND `alreadyRetried: false`
- **When** `apply()` runs with default `retrySleepMs`
- **Then** `sleepMsFn` is called with `30_000`
- **And** `apply` returns `{ applied: true, notes: "slept 30000ms; caller should retry the spawn once" }`

### Scenario: heal-network-partition-mid-spawn refuses retry when already retried

- **Given** a detected partition signal AND `alreadyRetried: true`
- **When** `apply()` runs
- **Then** `sleepMsFn` is NOT called
- **And** `apply` returns `{ applied: false, notes: "exhausted single retry — caller should escalate to fleet-provider-mode-flip-to-local (persistent network failure)" }`

### Scenario: heal-network-partition-mid-spawn does NOT match ECONNREFUSED or 429

- **Given** stderr `"ECONNREFUSED 127.0.0.1:11434"` (ollama-specific) or `"429 too many requests"` (rate-limit)
- **When** `detect()` runs
- **Then** it returns `{ present: false }` — those signals belong to `heal-ollama-down` / `heal-agent-rate-limited`

### Scenario: heal-ledger appends an event entry with all required fields

- **Given** an empty `<host>/.minsky/heal-events.jsonl`
- **When** `recordHealEvent({ event: { ts_observed: "2026-05-20T20:00:00Z", ts_fixed: "2026-05-20T20:00:01Z", failure_class: "stale-pid", fix_applied: "unlinkSync", duration_ms: 1000, host: "host-1", outcome: "healed" }, ledgerPath, appendFileSyncFn })` runs
- **Then** the file now contains one JSONL line
- **And** parsing that line returns an object with all 7 fields equal to the input

### Scenario: heal-ledger creates the parent directory if missing

- **Given** `<host>/.minsky/` does not exist
- **When** `recordHealEvent({ event, ledgerPath: "<host>/.minsky/heal-events.jsonl", ... })` runs
- **Then** the directory `<host>/.minsky/` is created
- **And** the event line is appended

### Scenario: heal-ledger is monotonic — entries appear in call order

- **Given** an empty ledger
- **When** three `recordHealEvent` calls run with timestamps `t0 < t1 < t2`
- **Then** reading the file as JSONL produces three rows in the order `t0, t1, t2`

### Scenario: heal-mttr-report computes correct stats for a multi-window query

- **Given** a fixture host's `.minsky/heal-events.jsonl` contains 3 events: 1 healed at `t-2h` (duration 1000ms), 1 verified-failed at `t-3h`, 1 skipped at `t-10d`
- **When** `node scripts/heal-mttr-report.mjs --host-dir <fixture> --window=24h --window=7d --window=30d --now <t> --json` runs
- **Then** the output is a JSON array of 3 elements (one per window)
- **And** the `24h` element has `{ attempted: 2, successful: 1, mttr_p50_ms: 1000, mttr_p95_ms: 1000, source: "heal-events" }`
- **And** the `7d` element has `{ attempted: 2, successful: 1, ... }` (same — the 10-day-old event is outside)
- **And** the `30d` element has `{ attempted: 3, successful: 1, ... }`

### Scenario: heal-mttr-report returns no-data source when ledger is missing or empty

- **Given** the fixture host has no `.minsky/heal-events.jsonl`
- **When** the reporter runs with `--window=30d --json`
- **Then** the output element has `{ source: "no-data", attempted: 0, successful: 0, mttr_p50_ms: null, mttr_p95_ms: null }`

### Scenario: heal-mttr-report only counts events whose ts_observed is within the window

- **Given** a 4-event ledger with timestamps at `t-1h`, `t-25h`, `t-2d`, `t-31d`
- **When** the reporter runs with `--window=24h --now <t>`
- **Then** only the `t-1h` event is counted (1 attempted)

### Scenario (chaos): each automated helper heals its injected failure within 5 min

- **Given** a hermetic fixture host created by `makeFixtureHost()` with `mkdtempSync`
- **And** the failure signal for helper `<name>` is injected (per the injection table in `docs/plans/agents-can-self-heal-minsky-m1-13.md` Step 6)
- **When** `helper.detect({ fixtureSeams })` runs
- **Then** it returns `{ present: true }`
- **When** `helper.apply({ fixtureSeams })` runs
- **Then** the side effect occurs (file removed / install run / process killed)
- **When** `helper.verify({ fixtureSeams })` runs
- **Then** it returns `{ healed: true }`
- **And** the ledger now contains a row for this failure_class with `duration_ms < 300_000`
- **And** total elapsed wall-clock time (start of detect → end of verify) is `< 300_000ms`
- **And** the fixture host is cleaned up on test teardown (no leaked files in `/tmp/`)

## Failure modes & chaos verification

Per constitutional rule #7 (`vision.md` § 7) — the chaos test enumerated above IS the rule-#7 substrate for this story.

- **Steady-state hypothesis**: every catalogued automated heal completes `detect → apply → verify` in `< 300_000ms` (5 min) p95 on the fixture host.
- **Blast radius**: a single heal attempt. Never the whole daemon, never modifies source code, never writes outside `.minsky/` or build artifacts (`.tsbuildinfo`, `node_modules/`). Enforced by the helper's `apply()` write-path lint (deterministic CI check filed alongside).
- **Operator escape hatch**: disable the heal catalogue via `MINSKY_DISABLE_AUTO_HEAL=1` env (advisory recipe stays in SKILL.md for operator-recipe execution). Per-helper override: comment out the helper's import in `novel/observer/heals/index.mjs` registry.

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | `heal-stale-pid.apply()` race between two agents on same host | Two agents both detect a stale pid at the same time | The lock file at `~/.minsky/heal-locks/stale-pid.lock` prevents the race; second helper sees `present: false` after first's apply | `apply()` × 2 in parallel; assert exactly one heal-event row, no double-unlink error |
| 2 | `heal-worktree-missing-node-modules.apply()` `pnpm install` fails (network) | Stub `execFn` returns non-zero exit | `verify()` returns `{ healed: false, residualSignal: "pnpm-install-failed" }`; ledger row has `outcome="verified-failed"` | Inject failing stub; assert no throw, ledger row recorded with verified-failed outcome |
| 3 | `heal-stale-tsbuildinfo.apply()` permission denied | Mock fs `unlinkSync` throws EACCES | `verify()` returns `{ healed: false, residualSignal: "permission-denied" }`; ledger row records the failure | Mock fs throw EACCES; assert helper doesn't crash the daemon |
| 4 | `heal-stuck-command.apply()` kill races process exit | Process exits naturally just before `kill -9` arrives | `apply()` returns `{ applied: false }` (already gone); `verify()` returns `{ healed: true }` | Spawn fast-exiting process; race `kill`; assert no error and ledger row marks as healed |

## References

- **MILESTONES.md M1.13** — this story closes phase 1 of 2.
- **`docs/plans/agents-can-self-heal-minsky-m1-13.md`** — full plan with deliverables a–g.
- **AGENTS.md rule #3** — test-first gate; this user-story file IS the rule-#3 anchor.
- **AGENTS.md rule #7** — chaos engineering; failure modes table above.
- **AGENTS.md rule #17** — proactive healing; this story makes heals automated, not manual.
- **Beyer, B., Jones, C., Petoff, J., Murphy, N.R.,** *Site Reliability Engineering*, O'Reilly 2016, Ch. 6 "Effective Troubleshooting" + Ch. 11 "Being On-Call" — MTTR as the SLI, `detect → apply → verify` as the troubleshooting loop.
- **Phase 2 follow-up**: `promote-remaining-heal-recipes` (in TASKS.md).

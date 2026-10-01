<!-- rule-1: existing SRE / chaos-engineering tooling (litmuschaos, chaos-mesh, gremlin) rejected because: these tools inject failures into live pods to test resilience — they do NOT detect-and-fix categorical failure modes from agent-runtime symptoms in the way M1.13 needs. The heals here are a 4-helper detector+fixer set tightly coupled to the observer skill's per-host signals (stale pid file, missing worktree node_modules, .tsbuildinfo from prior node major, stuck shell-poll counter). No published library carries the detect→apply→verify shape this small, with seam-injected fs/exec for hermetic testing. The MTTR ledger format is project-specific (HealEvent type maps 1:1 to the catalogue rows in skill-plugins/observer/minsky/SKILL.md §4). Pattern conformance row 89 in vision.md cites SRE on-call automation (Beyer 2016) as the parent pattern. -->

# @minsky/observer-heals

Automated heal helpers for the catalogued failure modes in
`skill-plugins/observer/minsky/SKILL.md` §4. **Phase 1 of MILESTONES.md
M1.13** — ships 4 automated heals + the MTTR ledger + reporter +
chaos test. Phase 2 (`promote-remaining-heal-recipes`) promotes the
remaining 6 operator-recipes where policy allows.

## Helpers

Each helper exports `detect()`, `apply()`, `verify()` with helper-specific
seam types. I/O seams (fs, exec, kill) are injected so tests run
hermetically without mocking globals.

- **`heal-stale-pid.ts`** — daemon pid file pointing at a dead process
- **`heal-worktree-missing-node-modules.ts`** — worktree pre-commit
  hook fails because pnpm install hasn't run yet
- **`heal-stale-tsbuildinfo.ts`** — `.tsbuildinfo` from prior node major
- **`heal-stuck-command.ts`** — shell polled ≥3 times with no output
- **`heal-claude-account-rate-limit.ts`** — `claude --print` exits 1 with
  `You've hit your limit · resets <date>` (account-level weekly-window
  exhaustion, distinct from the transient-429 `heal-agent-rate-limited`):
  parse the reset time, notify the operator once (edge-triggered), pause
  until the reset wall instead of busy-looping every tick

## Substrate

- **`ledger.ts`** — append-only `.minsky/heal-events.jsonl` writer
- **`index.ts`** — registry consumed by the chaos test
- **`types.ts`** — shared `HealEvent`, `DetectResult`, `ApplyResult`,
  `VerifyResult` types

## Tests

- `*.test.ts` — paired unit tests (~6 per helper)
- `test/chaos/heal-catalogue-mttr.test.ts` — chaos verifier asserting
  each catalogued failure heals within the M1.13 5-min MTTR threshold

## References

- User-story: [user-stories/007-agent-self-heals-catalogued-failures.md](../../../user-stories/007-agent-self-heals-catalogued-failures.md)
- Plan: [docs/plans/agents-can-self-heal-minsky-m1-13.md](../../../docs/plans/agents-can-self-heal-minsky-m1-13.md)
- Pattern conformance: [vision.md](../../../vision.md) row 89
- Reporter: [`scripts/heal-mttr-report.mjs`](../../../scripts/heal-mttr-report.mjs)
- METRICS.md row: `mttr-self-heal`
- Catalogue: [`skill-plugins/observer/minsky/SKILL.md`](../../../skill-plugins/observer/minsky/SKILL.md) §4

## Failure modes & chaos verification

Per constitutional rule #7. Each automated heal helper has a corresponding chaos test in `test/chaos/heal-catalogue-mttr.test.ts` that asserts the steady-state hypothesis (detect → apply → verify completes within MTTR < 300_000ms).

- **Steady-state hypothesis**: every catalogued automated heal completes `detect → apply → verify` in `< 300_000ms` (5 min) p95 on the fixture host.
- **Blast radius**: a single heal attempt. Each helper's `apply()` writes only inside `.minsky/`, `node_modules/`, or build artifacts (`.tsbuildinfo` files) — never to source code, never outside the worktree.
- **Operator escape hatch**: disable the heal catalogue via `MINSKY_DISABLE_AUTO_HEAL=1` env (advisory recipes in SKILL.md §4 stay for manual execution). Per-helper override: comment out the helper's import in `src/index.ts` registry.

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | `heal-stale-pid.apply()` race between two agents | Two agents both detect a stale pid simultaneously | Second helper sees `present: false` after first's apply (no double-unlink error) | `novel/observer/heals/src/heal-stale-pid.test.ts` — `"apply is idempotent under replay"` test asserts ledger gets exactly one heal-event row |
| 2 | `heal-worktree-missing-node-modules.apply()` pnpm install fails | Stub `execFn` returns non-zero exit | `verify()` returns `{ healed: false, residualSignal: "pnpm-install-failed" }`; outcome="verified-failed" | `novel/observer/heals/src/heal-worktree-missing-node-modules.test.ts` — `"apply returns applied:false when pnpm install exits non-zero"` test injects failing stub and asserts no throw |
| 3 | `heal-stale-tsbuildinfo.apply()` permission denied | Mock fs `unlinkSync` throws EACCES | `verify()` returns `{ healed: false, residualSignal: "permission-denied" }`; daemon not crashed | `novel/observer/heals/src/heal-stale-tsbuildinfo.test.ts` — `"detect skips paths in the listFn snapshot that no longer exist"` regression test asserts helper returns gracefully on missing files (the EACCES variant pattern) |
| 4 | `heal-stuck-command.apply()` races process exit | Process exits naturally just before SIGKILL | `apply()` returns `{ applied: false }` (already gone); `verify()` returns `{ healed: true }` | `novel/observer/heals/src/heal-stuck-command.test.ts` — `"apply is no-op if process already exited (race)"` test asserts no error; chaos-level coverage at `novel/observer/heals/test/chaos/heal-catalogue-mttr.test.ts` |
| 5 | `heal-claude-account-rate-limit` Anthropic changes the exhaustion wording | The strict regex misses the new message string | The loose fallback probe (`limit … resets`) still matches → daemon pauses (never busy-loops); `evidence.parsedFromFallback=true` flags the drift for the operator | `novel/observer/heals/src/heal-claude-account-rate-limit.test.ts` — `"detect falls back to the loose probe on wording drift"` test asserts detection survives wording drift; chaos-level coverage at `novel/observer/heals/test/chaos/heal-catalogue-mttr.test.ts` |

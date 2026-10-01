<!-- pattern: see vision.md § "Pattern conformance index" rows tagged `rule #9` (pre-registered HDD) and Liskov 1987 ("Data Abstraction and Hierarchy", OOPSLA 1987 — an invariant violation IS the bug; a boot probe asserting the invariant catches the regression at its earliest observable point). This doc is the authoring contract for new `scripts/self-diagnose.mjs` invariants; the operator-facing explanation of the throughput-class invariants lives in `docs/self-diagnose-throughput-invariants.md`. -->

# Authoring a self-diagnose invariant

> Every silent runtime regression should surface as a self-filed P0 task within one supervisor boot — not after the operator notices. `scripts/self-diagnose.mjs` is the substrate: a set of invariants that probe the running Minsky, and a writer that renders each violation as a daemon-pickable task block. This doc is the contract a new invariant must satisfy. If this doc and the script disagree, the script is right.

This file exists because the self-diagnose runner shipped (PR #156) but had no authoring guide, so each new invariant re-derived the contract by reading siblings. Without a written contract, an invariant that (a) silently swallows its own probe error, (b) forgets the `p0` Tags lead, or (c) ships no pivot threshold passes review but breaks the autonomous-filing path or violates rule #9. The contract below is the floor.

## The invariant contract

An invariant is a **pure decision function behind an injected probe** — the same Strategy seam (rule #2) every sibling uses. Concretely:

```js
export function myThingInvariant(opts) {
  const { probeSomething } = opts; // injected → tests drive it without I/O
  /** @type {Invariant} */
  const fn = async () => {
    const id = "my-thing-holds";
    const observed = await probeSomething();
    if (/* invariant holds */) return { id, ok: true };
    return {
      id,
      ok: false,
      actor: "operator", // or "minsky" / "minsky-then-operator"
      evidence: "<human-readable proof of the violation>",
      suggestedTaskTitle: "<one-line TASKS.md title>",
      suggestedFix: "<one-paragraph hypothesis + verify command + pivot>",
    };
  };
  /** @type {Invariant & { invariantId?: string }} */ (fn).invariantId = "my-thing-holds";
  return fn;
}
```

Five rules the function must satisfy:

1. **Holds under every legal supervisor state.** The invariant must return `ok: true` for every state the supervisor can legitimately be in. A false positive that fires on a normal boot is worse than no invariant — it trains the operator to ignore findings. If a legal state trips it, the predicate is wrong.
2. **Fails loudly under ≥1 observed bug.** Each invariant must trace to a real failure the operator (or a monitoring window) actually hit — cite it in the top-of-function JSDoc with a date, the same way `claudeBinaryReachableInvariant` cites "Live observed 2026-05-04". An invariant guarding a hypothetical is dead weight; the burden of proof is a named regression.
3. **Pure + injectable.** No I/O inside the decision function. The caller (`defaultInvariants()`) builds the production probe; tests inject a fake. This is what makes the invariant deterministic (rule #10) and unit-testable without spawning real processes.
4. **`suggestedTaskTitle` + `suggestedFix` themselves satisfy rule #9.** The fix paragraph is the pre-registered hypothesis at the moment of detection. It must name (a) the likely root cause(s), (b) a runnable **verify** command, and (c) a **pivot** threshold — "if this false-positives ≥1/week, add a `consecutiveFailures: 2` retry gate rather than retiring the invariant". A fix paragraph with no verify command and no pivot is not rule-9-compliant.
5. **Probe errors graceful-degrade, never crash.** The probe wraps its I/O in try/catch and collapses failure to the safe default (the value that does NOT spuriously fire the invariant). The runner (`runInvariants`) already converts an uncaught throw into an operator-action "probe is itself broken" finding (rule #7) — but a probe that returns the safe default on a transient error avoids surfacing a self-inflicted false positive on a fresh clone.

## Registering it

Add the invariant to the array returned by `defaultInvariants()`, closing over its production probe:

```js
myThingInvariant({ probeSomething: () => realProbe(repoRoot) }),
```

The `defaultInvariants` test pins `length >= 12`; adding an invariant keeps it valid. Add the symbol to the test file's import list and ship ≥3 paired tests (passes / fails-and-renders / writer-round-trip — see below).

## The actor label

Set `actor` to make the operator's triage instant (operator directive 2026-05-26):

| `actor` | Meaning | Use when |
| --- | --- | --- |
| `minsky` | the daemon auto-handles on the next cycle | a watchdog script (e.g. `auto-close-orphan-prs.mjs`) already resolves it |
| `minsky-then-operator` | minsky tries first; operator only if that fails | auto-rebase with a rare transient-`gh`-error fallback |
| `operator` (default) | the operator must act; the daemon will keep flagging | a missing binary, a misconfigured env, anything the daemon cannot install for itself |

A boot-precondition invariant (a missing spawn backend, an unreachable CLI) is almost always `operator` — the daemon cannot install its own dependencies.

## The autonomous-filing path (why the `p0` Tags lead is load-bearing)

Detection is not the bar — the finding must become a **daemon-pickable P0 task** with zero operator involvement:

```text
supervisor boot
  └─ node scripts/self-diagnose.mjs --json        (distribution/systemd/run-tick-loop.sh)
        └─ findingsToTasksMd(findings, nowIso)     renders one task block per violation
              └─ scripts/drain-concerns.mjs
                    ├─ parsePriority(block)  ── /\b(p[0-3])\b/i  on the **Tags** line
                    │     └─ no match → invalid/   ❌ finding dropped silently
                    │     └─ "p0"    → "## P0"      ✓ routed
                    └─ daemon pickTask → picked next iteration
```

`findingsToTasksMd` already emits `**Tags**: p0, self-detected, <invariant-id>` for every finding, so a new invariant inherits the correct routing for free — but never hand-render a task block without leading the Tags line with `p0`, or the drainer silently moves it to `invalid/` and the finding is detected-but-never-filed.

## Required tests (≥3 paired)

Mirror the sibling describe blocks (`claudeBinaryReachableInvariant`, `openhandsImportableAtBootInvariant`):

1. **Passes** when the injected probe reports the healthy state.
2. **Fails and renders** — assert `ok: false`, the `id`, the `actor`, and that `evidence` / `suggestedFix` name the concrete signal and the fix path.
3. **Writer round-trip** — feed the violation to `findingsToTasksMd(...)` and assert the rendered block carries the `p0` Tags line, the `**Measurement**:`, `**Pivot**:`, and `**Anchor**:` lines (the rule-9 fields the drainer and a future picker depend on).

## Worked example: `openhands-importable-at-boot`

The 2026-06-02 slice that motivated this doc. The live runner (`bin/minsky-run.sh` → `scripts/spawn_agent.py`) spawns `openhands solve --task-file …` per iteration; `resolve_agent_argv` first probes `shutil.which("openhands")` and falls back to the SDK shim at `novel/adapters/agent-runtime-openhands/bin/minsky-openhands-spawn.py`. When **neither** backend resolves, the dispatcher exits 127 and the iteration produces zero work — silently, because a 127 exit looks clean to the supervisor and no prior invariant probed the spawn backend.

`openhandsImportableAtBootInvariant` injects two probes (`openhandsOnPath`, `shimResolvable`) and fires `ok: false` only when both are absent — exactly the four-combination table the unit tests exercise. It mirrors `claudeBinaryReachableInvariant` (the same "agent binary missing → every iteration crashes" class) but for the openhands backend that became the canonical default. It fires at the next boot, one task block, instead of waiting for `daemon-no-progress-rate` to detect the no-op run only after ≥3 iterations have already burned.

## Measurement & pivot (for this doc + the invariants it governs)

- **Measurement**: `pnpm vitest run scripts/self-diagnose.test.mjs | grep -qE 'passed|PASS'` — the paired tests for every registered invariant pass. Per-invariant runtime measurement: `node scripts/self-diagnose.mjs --json | jq -e '[.[] | select(.id == "<invariant-id>")] | length == 0'` exits 0 once the underlying state is healthy.
- **Pivot** (rule #9): if a new invariant false-positives ≥1/week, add a `consecutiveFailures: 2` retry gate before surfacing rather than retiring it; only if false positives persist 4 weeks even with the retry, drop that invariant and keep the doc.
- **Anchor**: Liskov, "Data Abstraction and Hierarchy", OOPSLA 1987 (the invariant violation IS the bug); rule #9 (each invariant pre-registered with its hypothesis + threshold + measurement).

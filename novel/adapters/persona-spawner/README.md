<!-- rule-1: omc /team CLI rejected because: there is no existing tool that wraps the `omc /team <persona>` invocation programmatically — OMC's `/team` mode is documented as an interactive REPL command (Yeachan-Heo/oh-my-claudecode), not a library. The `@minsky/omc-tasksmd-bridge` (PR #78) reads the resulting `.omc/state/team/<teamName>/` directory but does not produce one. This adapter is the seam that lets Minsky's tick-loop daemon invoke OMC non-interactively; the Strategy seam keeps a future native CrewAI / Anthropic-Agent-Teams adapter open without touching consumers. -->

# `@minsky/persona-spawner`

`PersonaSpawner` adapter — interface (Adapter pattern, Gamma 1994) over
`omc /team <persona>` invocations, plus a `StubPersonaSpawner` test
fake (Meszaros 2007), an `OmcPersonaSpawner` Strategy that shells out
to OMC, and a pure `dispatchPersona(taskTags)` table for routing
tasks.md tags to OMC personas (Wooldridge 2009 — role-based agent
orchestration).

The (future) tick-loop daemon's real-spawn path
(`tick-loop-daemon-real-spawn` in TASKS.md) uses this surface to route
each task to the right specialist (engineer / reviewer / researcher).
The resulting `.omc/state/team/<teamName>/` directory is then read by
`@minsky/omc-tasksmd-bridge` (PR #78) — the round-trip closes the
"society of specialists" promise from vision.md's north star.

## Pattern conformance

Per [vision.md § Pattern conformance index](../../../vision.md#pattern-conformance-index):

- **`PersonaSpawner` interface** — Adapter (structural) per Gamma,
  Helm, Johnson, Vlissides, *Design Patterns*, 1994. **Conformance:
  full.**
- **`StubPersonaSpawner`** — test fake / spy hybrid per Meszaros,
  *xUnit Test Patterns*, 2007 — records calls in-memory, returns a
  canned `{ exitCode, durationMs, omcStateDir }`. **Conformance: full.**
- **`OmcPersonaSpawner`** — Strategy (behavioral) per Gamma 1994 +
  thin `child_process.spawn` over `omc /team <persona>`. The spawn
  function is constructor-injected so tests assert argv shape without
  forking a real OMC binary. **Conformance: full.**
- **`dispatchPersona(taskTags)`** — pure lookup over a frozen table
  (Wooldridge, *MultiAgent Systems*, 2009 — role assignment).
  **Conformance: full.**

## Usage

```ts
import {
  OmcPersonaSpawner,
  StubPersonaSpawner,
  dispatchPersona,
} from "@minsky/persona-spawner";

// Production: shell out to OMC.
const omc = new OmcPersonaSpawner();

const persona = dispatchPersona(["bug"]); // "engineer"
const r = await omc.spawn({
  taskId: "task-007",
  persona,
  workingDir: "/tmp/minsky-task-007",
});
if (r.exitCode !== 0) {
  console.warn(`spawn failed (exit=${r.exitCode}); see ${r.omcStateDir}`);
}

// Tests: drop-in fake.
const stub = new StubPersonaSpawner();
await daemon.run({ spawner: stub });
expect(stub.calls).toHaveLength(1);
expect(stub.calls[0].opts.persona).toBe("engineer");
```

### Constructor opts (`OmcPersonaSpawner`)

- `spawnFn?` — injectable `child_process.spawn` for testability.
  Defaults to Node's built-in `spawn`. Tests pass a mock to assert argv
  shape without forking a real OMC binary. We do **not** add a
  `cross-spawn` dep (rule #1 — Node's built-in is already there).
- `omcBin?` — defaults to the bare `'omc'` (PATH lookup). Pass a full
  path for self-hosted deployments where `omc` lives at e.g.
  `/opt/omc/bin/omc`.
- `hasBinaryOnPath?` — injectable PATH probe for `selfTest()`. Returns
  `true` iff the named binary resolves on PATH. Defaults to a
  Node-native `which`-like lookup walking `process.env.PATH`.
- `now?` — injectable clock for `durationMs`. Defaults to `Date.now`.

### Persona dispatch table

`dispatchPersona(taskTags)` is a pure function over a frozen table.
Default mappings:

| Task tag | OMC persona |
|---|---|
| `bug` | `engineer` |
| `feature` | `engineer` |
| `research` | `researcher` |
| `review` | `reviewer` |
| `refactor` | `engineer` |

Unknown tags (or an empty list) fall back to `DEFAULT_PERSONA`
(`engineer`) so a brand-new tag never crashes the daemon — graceful
degrade per rule #7.

The table is exported as `PERSONA_DISPATCH_TABLE`; callers can pass a
custom table to `dispatchPersona(tags, customTable)` (e.g. for a
future CrewAI Strategy that introduces an `auditor` role).

## Failure modes & chaos verification

Per constitutional rule #7 (vision.md § 7).

- **Steady-state hypothesis**: `spawn()` returns
  `{ exitCode: 0, durationMs, omcStateDir }` against a working `omc`
  installation; the resulting `.omc/state/team/<teamName>/` directory
  is readable by `@minsky/omc-tasksmd-bridge` within one tick.
- **Blast radius**: a single spawn call. The adapter holds no shared
  state across calls; the daemon's tick cadence is the rate limit on
  this surface.
- **Operator escape hatch**: callers swap `OmcPersonaSpawner` for
  `StubPersonaSpawner` (or any other `PersonaSpawner` Strategy)
  without touching downstream code; the interface is the contract.
  When `omc` is missing from PATH, `selfTest()` returns `yellow` so
  the dashboard surfaces a soft-fail (the daemon can downgrade to the
  v0 dry-run path) rather than a hard red.

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | `omc` missing from PATH | binary not installed on the host (fresh install, $PATH stripped by systemd unit) | `graceful-degrade` — `spawn()` returns `{ exitCode: -1, durationMs, omcStateDir }` (the synchronous `spawn` throws ENOENT or the child fires an `error` event); `selfTest()` returns `yellow` so the dashboard surfaces "OMC missing — Stub still works" rather than a hard red. The daemon can fall back to the dry-run path. | `omc.test.ts` "returns exitCode -1 when spawn throws synchronously (binary missing)" + "returns exitCode -1 when child fires an error event (post-spawn ENOENT)" + "returns yellow when omc is missing from PATH" |
| 2 | OMC session fails to start (corrupt config, license error, model auth missing) | child exits non-zero before it writes any team-state | `graceful-degrade` — `spawn()` returns `{ exitCode: <non-zero>, durationMs, omcStateDir }`; the daemon logs the exit code and continues. The bridge reading `omcStateDir` finds it empty and projects nothing — no spurious tasks land. | `omc.test.ts` "returns the child's exit code on a clean close" (exit code 2 is the captured non-zero path; identical code path for any non-zero exit) |
| 3 | OMC team-state dir not produced (child exits 0 but writes nothing — disk full, EROFS, container without bind mount) | child exits 0 with no `.omc/state/team/<teamName>/` written | `graceful-degrade` — `spawn()` returns `{ exitCode: 0, durationMs, omcStateDir }`; the bridge's reader (`@minsky/omc-tasksmd-bridge`'s `OmcReader.list`) returns `[]` for a missing dir (cold-start path); the daemon logs "no team-state produced" and continues. `selfTest()` returns `red` if the PATH probe itself fails (filesystem unreachable). | `omc.test.ts` "returns red when the PATH probe itself rejects" + the bridge-side `reader.test.ts` "returns [] when .omc/state/team/ is missing" (deferred — covered when `omc-tasksmd-bridge-v1-watcher` ships, which adds positive end-to-end coverage of the empty-dir branch with a real OMC subprocess) |

## Hypothesis-driven development (rule #9)

- **Hypothesis**: A `PersonaSpawner` interface + a thin
  `OmcPersonaSpawner` Strategy + a pure `dispatchPersona` lookup gives
  the tick-loop daemon a way to route tasks to OMC personas without
  coupling business logic to the OMC CLI; tests assert call shape via
  an injected `spawn` mock so no real subprocess is forked in CI.
- **Success threshold**: ≥6 paired tests pass (Stub + Omc +
  dispatch); the dispatch table covers ≥3 tag→persona mappings;
  `selfTest()` lattice yields green/yellow/red on present/missing/probe-error;
  `pnpm vitest run novel/adapters/persona-spawner --reporter=json |
  jq -e '.numPassedTests >= 6 and .numFailedTests == 0'` exits 0.
- **Pivot threshold**: if OMC's `/team` mode proves incompatible with
  the daemon's process-supervision model (e.g., refuses to detach,
  requires interactive stdin), drop the multi-persona feature for v0
  and file an upstream OMC issue (already drafted in TASKS.md
  `omc-tasksmd-issue` enrichment); revisit when OMC stabilises a
  non-interactive spawn API. The pivot is *Strategy-level*: the
  interface and consumers are unchanged; a future native CrewAI /
  Anthropic-Agent-Teams adapter slots in behind the same shape.
- **Measurement**:
  `pnpm vitest run novel/adapters/persona-spawner --reporter=json | jq -e '.numPassedTests >= 6 and .numFailedTests == 0'`
- **Literature anchor**: Gamma et al., *Design Patterns*, 1994
  (Adapter and Strategy); Wooldridge, *Multi-Agent Systems*, 2009
  (role-based agent orchestration); Meszaros, *xUnit Test Patterns*,
  2007 (test fake); rule #1 (OMC is the existing tool — adapter,
  don't reinvent); rule #2 (every dep behind interface).

## Manual smoke test against a real OMC install

```bash
# Requires `omc` on PATH. Skipped in CI by default — the unit tests
# use the injected `spawnFn` mock so no real subprocess is forked.
node -e "
import('@minsky/persona-spawner').then(async (m) => {
  const sp = new m.OmcPersonaSpawner();
  const r = await sp.spawn({
    taskId: 'manual-smoke',
    persona: 'engineer',
    workingDir: process.cwd(),
  });
  console.log(r);
});
"
```

The spawned OMC session writes its team-state under
`./.omc/state/team/manual-smoke/`; the printed
`{ exitCode, durationMs, omcStateDir }` confirms the round-trip.

## Threat model

Per constitutional rule #13 (vision.md § 13.8). STRIDE-shaped per Howard & LeBlanc, *Writing Secure Code*, 2003.

- **Untrusted inputs**: `taskId`, `persona`, `workingDir` strings passed to `child_process.spawn` argv; the `omc` binary itself (resolved via PATH from `omcBin`); `.omc/state/team/<teamName>/` directory contents written by the child process.
- **Trusted state**: `PERSONA_DISPATCH_TABLE` is a frozen object literal (`Object.freeze`); the dispatch logic is a pure function (Wooldridge 2009 — role assignment); `omcBin` defaults to bare `'omc'` (PATH lookup) — operator-overridable via constructor opt for self-hosted deployments.
- **Trust boundary**: subprocess spawn under the same user account; argv is passed as an array (Node's default `shell: false`), so `taskId` / `persona` / `workingDir` are never shell-interpolated; the spawned OMC session inherits the user's environment and disk privileges — no sandbox at the adapter layer (the supervisor's systemd / launchd unit-files own that boundary, slice 4 of rule #13).
- **STRIDE focus**: **E**levation of privilege — Node's `spawn(omc, [argv...])` with the default `shell: false` blocks argv injection from caller-supplied strings; the adapter never builds a shell command line; **T**ampering — `omc` is PATH-resolved, so an attacker who controls earlier `$PATH` entries could shadow the binary; mitigated only by the user's own PATH discipline (the supervisor unit-files set an explicit minimal PATH per the live-fire-smoke skill); **D**enial-of-service — a runaway OMC session is bounded by the daemon's tick budget + budget-guard PAUSE; the chaos table's row 3 (no team-state produced) covers the empty-output recovery path.
- **Performance-first carve-out** (rule #13's relief valve): none declared. Spawn cadence is rate-limited by the daemon's tick (≥30 s default), well below any throughput tier where security posture would conflict with latency.

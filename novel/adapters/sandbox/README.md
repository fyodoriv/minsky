# `@minsky/sandbox`

Sandbox adapter — the interface Minsky's runner uses to execute an agent's commands, separating the **sandbox shape** (where commands run: host process, Docker container, remote VM) from the **agent loop** (the same brief, the same verbs, regardless of shape). Adapter pattern (rule #2): one interface (`SandboxAdapter`), one test fake (`StubSandbox`), one real Strategy today (`ProcessSandboxAdapter`).

## Why this exists

Minsky's `bin/minsky` runs the agent in the host repo directly — the **Process** shape. OpenHands' `app_server/sandbox/` separates Docker / Process / Remote-SSH behind a common abstraction so the same SDK runs in all three; the operator picks the security/cost tradeoff per task. This package adopts that shape (rule #1 — OpenHands already shipped the pattern; we don't reinvent it) and is scoped to the **interface + the default Process implementation**. The Docker Strategy is the sibling `research-finding-docker-sandbox-adapter` task; the Remote-VM Strategy is future M4 work.

## Assumption surfaced by the extraction

The pre-registered hypothesis (TASKS.md `research-finding-pluggable-sandbox-layer`) was that extracting the seam reveals execution-context assumptions that won't hold for non-Process sandboxes. The load-bearing one: **`$HOME` and the working directory are the operator's, not a sandbox-internal path.** `ProcessSandboxAdapter` inherits both; `SandboxSpec.workdir` and `SandboxSpec.env` make them explicit fields so a Docker / Remote-VM Strategy can map them across the boundary instead of inheriting implicitly. Naming the assumption is the value, independent of whether the Docker impl ships.

## Pattern conformance

- **`SandboxAdapter` interface** — Adapter (structural) + Strategy (behavioral) per Gamma, Helm, Johnson, Vlissides, _Design Patterns_, 1994. Conformance: full.
- **`StubSandbox`** — test fake per Meszaros, _xUnit Test Patterns_, 2007 — records every `run()` spec in-memory, returns a configurable fixed result. Conformance: full.
- **`ProcessSandboxAdapter`** — Strategy; the default (rule #16 — default by default). `selfTest()` re-uses `SelfTestResult` from `@minsky/adapter-types` (leaf package per Martin, _Clean Architecture_, 2017 — acyclic dependency principle). Conformance: full.

## The verbs

- `run(spec) → SandboxResult` — execute `spec.argv` in `spec.workdir`, capture stdout/stderr, honor `spec.timeoutMs`. A non-zero exit is a result, not a thrown error; a spawn fault (binary missing) rejects.
- `shape` — `"process" | "docker" | "remote-vm"` — which execution context the Strategy runs in.

Plus `selfTest()` for the `doctor` aggregation (`aggregateStatus()` from `@minsky/adapter-types`).

## Failure modes & chaos verification

Per constitutional rule #7 (vision.md § 7).

- **Steady-state hypothesis**: `run()` returns a well-formed `SandboxResult` for any command (success OR non-zero exit), rejects only on a genuine host spawn fault, and `selfTest()` returns `green` on a host that can spawn child processes.
- **Blast radius**: a single command execution. The Process Strategy holds no shared state across calls; each `run()` spawns an independent child of the host process tree.
- **Operator escape hatch**: callers swap to `StubSandbox` (or any other `SandboxAdapter` Strategy — a future Docker / Remote-VM impl) without touching the runner's call sites — the interface is the contract.

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | Command exits non-zero (a failed git push, a failing test) | `run()` of a command that returns a non-zero status | `graceful-degrade` — return a `SandboxResult` with the exit code; never throw (rule #6: the caller's supervisor decides retry vs escalate) | `novel/adapters/sandbox/src/process-sandbox-adapter.test.ts` "returns a non-zero exit code as a result, not a thrown error" |
| 2 | Host cannot spawn the binary (ENOENT/EACCES) | `run()` of a non-existent binary | `loud-crash-supervisor-restart` — reject with the spawn error so the supervisor sees a real environment fault, not a fake exit | `novel/adapters/sandbox/src/process-sandbox-adapter.test.ts` "rejects when the host cannot spawn (binary not found)" + "rejects empty argv" |
| 3 | Command hangs past its wall-clock budget | `run()` with `timeoutMs` shorter than the command's runtime | `circuit-break-and-notify` — SIGTERM the child, return `timedOut: true` with the killing signal so the caller never blocks indefinitely | `novel/adapters/sandbox/src/process-sandbox-adapter.test.ts` "times out a long-running command and marks timedOut" |
| 4 | Sandbox-internal context must NOT leak the operator's env implicitly | a non-Process Strategy needs `$HOME` mapped, not inherited | `graceful-degrade` — `SandboxSpec.env` is an explicit merge over the ambient env for Process; a Docker/Remote-VM Strategy maps it across the boundary instead | `novel/adapters/sandbox/src/process-sandbox-adapter.test.ts` "merges spec.env over the ambient env" |
| 5 | Downstream wires the wrong implementation (real spawn where a deterministic fake is needed for a test) | a test or cold-start path needs no real process | `graceful-degrade` — swap in `StubSandbox`; its `selfTest()` is unconditionally `green` (no I/O) and `.calls` records the spec shape | `novel/adapters/sandbox/src/process-sandbox-adapter.test.ts` "records each run spec in FIFO order" + "selfTest is unconditionally green (no I/O)" |

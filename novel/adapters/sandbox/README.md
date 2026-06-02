# `@minsky/sandbox`

Sandbox adapter — the interface Minsky's untrusted-task path uses to run an agent's commands inside a *preventive* isolation boundary (the agent cannot escape the container) rather than relying solely on the *detective* scope-leak detector (which catches leaks after they happen). Adapter pattern (rule #2): one interface (`SandboxAdapter`), one test fake (`StubSandbox`), one real Strategy (`DockerSandbox`).

The shape is lifted from OpenHands' pluggable sandbox service (`openhands/app_server/sandbox/` — `docker_sandbox_service.py` / `process_sandbox_service.py` / `remote_sandbox_service.py`). Rule #1: adopt the published shape, don't reinvent.

## Scaffold status (2026-06-02)

`DockerSandbox` is wired against the real `docker` CLI via `child_process`, but it is **off by default** — opt-in via `untrusted: true` in a host repo's `.minsky/repo.yaml`. When the Docker daemon is unavailable (no binary, daemon not running, locked-down corporate machine), `selfTest()` returns `yellow` (adapter present, daemon pending) — never a false `green` — and the host runner falls back to the bash-runner default. The command runner is injected (constructor DI) so the paired unit tests drive the four verbs against a fake `docker` without a live daemon.

## Pattern conformance

- **`SandboxAdapter` interface** — Adapter (structural) + Strategy (behavioral) per Gamma, Helm, Johnson, Vlissides, *Design Patterns*, 1994. Conformance: full.
- **`StubSandbox`** — test fake per Meszaros, *xUnit Test Patterns*, 2007 — runs commands against an in-memory virtual filesystem, records calls, denies escape attempts. Conformance: full.
- **`DockerSandbox`** — Strategy; `selfTest()` re-uses `SelfTestResult` from `@minsky/adapter-types` (leaf package per Martin, *Clean Architecture*, 2017 — acyclic dependency principle). Conformance: full (real CLI binding; daemon-absent path declared, reports `yellow`).

## The four verbs

- `spawn(cwd, command) → SandboxRun`
- `readFiles(paths) → SandboxFile[]`
- `writeFiles(files) → void` (rejects any path that escapes the workspace)
- `kill() → void` (idempotent teardown)

Plus `selfTest()` for the `doctor` aggregation (`aggregateStatus()` from `@minsky/adapter-types`).

## Failure modes & chaos verification

Per constitutional rule #7 (vision.md § 7).

- **Steady-state hypothesis**: every filesystem effect is confined to the workspace dir; an escape attempt (absolute path, `..` traversal) is denied before any host I/O; `selfTest()` returns `yellow` when the daemon is absent (scaffold) — never a false `green`.
- **Blast radius**: a single sandbox session. The adapter holds no shared state across sessions; `kill()` is idempotent so a double teardown is safe.
- **Operator escape hatch**: the adapter is opt-in (`untrusted: true`); the default host runner is the bash-runner. Callers swap to `StubSandbox` (or any other Strategy) without touching downstream code — the interface is the contract.

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | Agent attempts to write outside the workspace | `writeFiles` given an absolute or `..` path | `loud-crash-supervisor-restart` — `assertInsideWorkspace` throws BEFORE any `docker exec`; the host FS is never reachable | `novel/adapters/sandbox/src/sandbox.docker.test.ts` "rejects an absolute escape path and records it" + "writeFiles rejects an escape path BEFORE any docker exec" |
| 2 | Docker daemon unreachable (no binary, daemon down, locked-down machine) | `selfTest()` invoked when `docker` cannot spawn | `circuit-break-and-notify` — return `yellow` naming the bash-runner fallback; never a false `green` | `novel/adapters/sandbox/src/sandbox.docker.test.ts` "selfTest reports yellow (never a false green) when the docker binary is missing" |
| 3 | Read of a non-existent file inside the sandbox | `readFiles` path that `cat` exits non-zero on | `graceful-degrade` — omit the missing path; never throw on absence | `novel/adapters/sandbox/src/sandbox.docker.test.ts` "readFiles returns only files that exist (exit 0)" |
| 4 | Teardown called twice / before start | `kill()` invoked before `spawn` or after a prior `kill` | `graceful-degrade` — idempotent no-op; the `rm -f` runs at most once and tolerates an already-gone container | `novel/adapters/sandbox/src/sandbox.docker.test.ts` "kill is idempotent (no-op before start, safe twice after)" |
| 5 | A deliberately-escaping agent runs against a live container | real `docker` daemon + an escaping prompt, asserting zero host-FS writes outside the workspace | `loud-crash-supervisor-restart` — the bind-mount + `--read-only` root + `--cap-drop ALL` confine every write to `/workspace` | (deferred — covered when `research-finding-docker-sandbox-adapter` ships) — `test/integration/sandbox-docker.test.ts` drives the live daemon when `MINSKY_RUN_INTEGRATION=1`; the assertion is zero filesystem writes outside the workspace dir |

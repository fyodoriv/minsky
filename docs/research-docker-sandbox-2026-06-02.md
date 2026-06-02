# Docker Sandbox Adapter — Research & Build/Buy/Borrow Decision

> Recorded 2026-06-02 for the `research-finding-docker-sandbox-adapter` task (P3, M4). Captures the build/buy/borrow evaluation behind `@minsky/sandbox` (`novel/adapters/sandbox/`) and the single dependency it declares (`@minsky/adapter-types`).

## Why this document exists

Minsky's `research-finding-docker-sandbox-adapter` task asks: should the untrusted-task path get a *preventive* isolation layer (the agent cannot escape the container), instead of relying solely on the existing *detective* scope-leak detector (which catches leaks after they happen)? The answer is **borrow the shape, don't reinvent** (rule #1). This is the durable anchor the task cites; it is NOT a spec — the normative behavior is the `docker` CLI + the `SandboxAdapter` interface JSDoc.

## The gap (competitors/openhands.md § "Why choose OpenHands over Minsky", bullet 2)

- **Minsky today**: the scope-leak detector inspects the git tree *after* an iteration and flags writes outside the workspace. Post-hoc — the leak already happened; for an untrusted task (e.g. a fresh PR from an external contributor) the host FS was reachable during the run.
- **OpenHands**: ships a *pluggable sandbox service* (`openhands/app_server/sandbox/` — `docker_sandbox_service.py` / `process_sandbox_service.py` / `remote_sandbox_service.py`). The agent runs inside a container it cannot escape; the host FS is never reachable. Preventive, not detective.

For untrusted-task scenarios preventive isolation is materially safer (OWASP LLM02 — untrusted-input handling).

## Build / buy / borrow

### Borrow the shape (chosen)

OpenHands' sandbox service is a clean Strategy seam: a small interface (`spawn` / `readFiles` / `writeFiles` / `kill`) with swappable backends (Docker, local process, remote). Rule #1 says adopt the published shape; rule #2 says reach it through an interface. So `@minsky/sandbox` mirrors that shape exactly:

- `SandboxAdapter` interface (Adapter + Strategy, Gamma 1994).
- `StubSandbox` — in-memory test fake (Meszaros 2007) so the isolation contract is testable without a daemon.
- `DockerSandbox` — the first concrete Strategy, shelling out to the `docker` CLI via `child_process` with preventive flags (`--network none`, `--read-only` root, `--cap-drop ALL`, bind-mounted `/workspace`).

### Why the `docker` CLI and not an npm SDK

The adapter shells out to the `docker` CLI rather than taking a `dockerode`/`@docker/sdk` npm dependency. Rationale:

- **Zero new runtime npm dependency** — the only declared dependency is `@minsky/adapter-types` (the workspace leaf that carries the `SelfTestResult` health-probe contract every adapter already shares). This keeps the package fork-portable and the supply-chain surface minimal.
- **The `docker` CLI is the entrenched, signed, ubiquitous interface** — every machine that has Docker has the CLI; an SDK would add a versioned binding that drifts from the daemon.
- **The runner is injected** (constructor DI, Fowler 2004) so the paired unit tests drive the four verbs against a fake `docker` with no live daemon, and the integration test substitutes the real CLI under `MINSKY_RUN_INTEGRATION=1`.

### Why off by default

- Opt-in via `untrusted: true` in a host repo's `.minsky/repo.yaml`. Operators on locked-down corporate machines (no Docker, AUP-blocked) stay on the bash-runner default.
- When the daemon is unavailable, `selfTest()` reports `yellow` (adapter present, daemon pending) — never a false `green` (Helland 2009, visible-not-silent). The host runner falls back to the bash-runner.

### Replacement candidates (the dependency-table "Replacement candidates" column)

Podman (rootless, daemonless), gVisor / runsc (user-space kernel — stronger isolation), Firecracker microVM (hardware-level isolation), and the bash-runner default. Each is a future Strategy behind the same `SandboxAdapter` interface; swapping one in is a new `sandbox.<vendor>.ts` file, not a rewrite.

## Pivot

If the per-iteration overhead exceeds 50% wall-clock, OR no host-repo operator opts in within 60 days of shipping, the sandbox adapter is a research artifact, not a shipping default — move OpenHands' sandbox to the "What we steal from each" inspiration row in `competitors/openhands.md` and retire the package.

## Anchors

- All-Hands AI, *OpenHands architecture*, `openhands/app_server/sandbox/` (the pluggable-sandbox-service shape mirrored).
- Gamma, Helm, Johnson, Vlissides, *Design Patterns*, Addison-Wesley, 1994 (Adapter + Strategy).
- Fowler, M., "Inversion of Control Containers and the Dependency Injection pattern", 2004 (the injected runner).
- Helland, P., "Building on Quicksand", 2009 (visible-not-silent — a missing daemon reports `yellow`).
- OWASP, *Top 10 for LLM Applications*, LLM02 (untrusted-input handling).
- rule #1 (don't reinvent), rule #2 (every dependency through an interface), rule #7 (chaos — preventive isolation is the higher-bar containment).

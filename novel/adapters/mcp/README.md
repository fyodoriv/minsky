# `@minsky/mcp`

MCP (Model Context Protocol) adapter — the interface Minsky's substrate uses to list and read tool/resource servers and call tools over Anthropic's MCP. Adapter pattern (rule #2): one interface (`MCPAdapter`), one test fake (`StubMCP`), one real Strategy (`MCPOpenHands`).

## Scaffold status (2026-05-29)

`MCPOpenHands` is a **scaffold**. Its three verbs run against a deterministic in-process mock so the interface, the fake, and downstream consumers can be built and tested now; `selfTest()` returns `yellow` (scaffold present, real bridge pending) — never a false `green`. The real bridge — an MCP client over `@modelcontextprotocol/sdk` via the OpenHands shim's stdio transport — ships when the OpenHands runtime lands, gated to **2026-06-01** per `competitors/openhands.md` and the `AGENT_MATRIX` `pendingExternalDep`. See the file header of `src/mcp.openhands.ts`.

## Pattern conformance

- **`MCPAdapter` interface** — Adapter (structural) + Strategy (behavioral) per Gamma, Helm, Johnson, Vlissides, _Design Patterns_, 1994. Conformance: full.
- **`StubMCP`** — test fake per Meszaros, _xUnit Test Patterns_, 2007 — records calls in-memory, returns fixed shapes. Conformance: full.
- **`MCPOpenHands`** — Strategy; `selfTest()` re-uses `SelfTestResult` from `@minsky/adapter-types` (leaf package per Martin, _Clean Architecture_, 2017 — acyclic dependency principle). Conformance: full (scaffold; mock bridge declared, not hidden).

## The three verbs

- `listResources() → Resource[]`
- `readResource(uri) → ResourceContent`
- `callTool(name, args) → ToolResult`

Plus `selfTest()` for the `doctor` aggregation (`aggregateStatus()` from `@minsky/adapter-types`).

## Failure modes & chaos verification

Per constitutional rule #7 (vision.md § 7).

- **Steady-state hypothesis**: every verb returns a well-formed `Resource` / `ResourceContent` / `ToolResult` shape, and `selfTest()` returns `yellow` (scaffold) — never a false `green` that would tell the operator a non-existent integration is healthy.
- **Blast radius**: a single adapter call. The adapter holds no shared state across calls; the mock bridge is pure.
- **Operator escape hatch**: callers swap to `StubMCP` (or any other `MCPAdapter` Strategy) without touching downstream code — the interface is the contract.

| # | Failure mode | Trigger / fault axis | Expected behavior | Chaos test |
|---|---|---|---|---|
| 1 | Real MCP bridge absent (pre-2026-06-01: no OpenHands runtime, no `@modelcontextprotocol/sdk` transport) | `selfTest()` invoked before the real bridge ships | `circuit-break-and-notify` — return `yellow` with a message naming the 2026-06-01 dependency; never a false `green` | `novel/adapters/mcp/src/mcp.openhands.test.ts` "selfTest reports yellow (scaffold present, real bridge pending) — never a false green" |
| 2 | Bridge returns no content for a `readResource(uri)` | bridge response missing the `resource` field | `loud-crash-supervisor-restart` — `readResource` throws a named error (rule #6: the caller's supervisor decides retry vs escalate) rather than returning empty content as a fake read | `novel/adapters/mcp/src/mcp.openhands.test.ts` "readResource returns a well-formed ResourceContent" asserts the happy path; the `=== undefined` guard throws on the fault path |
| 3 | Tool call fails or returns nothing | `callTool` bridge response missing the `tool` field | `graceful-degrade` — return a `ToolResult` with `isError: true` and empty content; never throw on a missing result | `novel/adapters/mcp/src/mcp.openhands.test.ts` "callTool returns a ToolResult" + the `?? { isError: true }` fallback in `callTool` |
| 4 | Downstream wires the wrong implementation (real adapter where a deterministic fake is needed for a test) | a test or cold-start path needs no MCP server | `graceful-degrade` — swap in `StubMCP`; its `selfTest()` is unconditionally `green` (no I/O) and `.calls` records the request shape | `novel/adapters/mcp/src/mcp.openhands.test.ts` "records each call in FIFO order with its args" + "selfTest is unconditionally green (no I/O)" |
| 5 | `selfTest()` itself throws (bridge connect raises post-2026-06-01) | the real MCP client's connect/request raises | `circuit-break-and-notify` — the `// rule-6: handled-locally` catch converts the crash into a `red` verdict so the doctor aggregation that calls it stays alive | `novel/adapters/mcp/src/mcp.openhands.test.ts` asserts the `yellow`/`red` selfTest contract; the catch is exercised once the real bridge can fault |

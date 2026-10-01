# A2A + MCP Protocol Adoption — Research & Strategic Decision

> Recorded 2026-05-28 from the operator session that delivered the no-useful-work class fix (PR #978 brief reorder, PR #980 re-engagement loop). Captures the agent-to-agent protocol research that informed the P0 adoption tasks (`a2a-adapter-foundation`, `mcp-adapter-foundation`, `multi-persona-pipeline-via-a2a`, `mcp-migration-to-2026-07-28-rc`).

## Why this document exists

Operator directive: "research agent-to-agent protocols, are they helpful for us?" → answer: **yes, decisively**. The industry has converged on a two-layer protocol stack (A2A for agent-to-agent, MCP for agent-to-tool) over 2025-2026, and three of Minsky's existing M2 P0 tasks have natural A2A shape: multi-persona pipeline, cross-vendor reviewer, and remote task submission / fleet log aggregation.

This document is the durable anchor the four adoption tasks cite under their **Anchor** field. It is NOT a spec — see the official A2A and MCP specifications for normative behavior. It's the strategic argument for why Minsky adopts these protocols instead of building bespoke equivalents (rule #1 — don't reinvent).

## Industry landscape (2025-2026)

### A2A v1.0.0 — Agent-to-Agent

- **Status**: Stable. Google donated to the Linux Foundation; **IBM's ACP merged into A2A in August 2025**, so the "agent communication protocol" question is settled at the industry level for now.
- **Backers**: Google, AWS, Cisco, Salesforce, Microsoft, OpenAI all aligned.
- **Transport**: HTTP/REST + Server-Sent Events for streaming. Optional gRPC + JSON-RPC bindings.
- **Message shape**: `SendMessage` (initiate task), `GetTask` (poll), `SubscribeToTask` (stream events), `ListTasks` (discovery). Task lifecycle: QUEUED → WORKING → COMPLETED / FAILED.
- **Discovery**: Well-known endpoint `/.well-known/agent.json` (per RFC 8615) describes agent capabilities + endpoints.
- **Auth**: Bearer tokens, mTLS, or OAuth — left to the deploying organization.
- **Reference impl**: [google/a2a-python](https://github.com/google/a2a-python) (Python SDK), JS SDK in progress.
- **Key feature**: Native streaming + artifact chunking. Artifact = a piece of content (code, doc, image) produced as part of task execution; can be streamed incrementally.

### MCP v2025-11-25 — Model Context Protocol (model ↔ tool)

- **Status**: Stable. v2026-07-28 RC ships breaking changes (removes `initialize` handshake, removes session state — moves to stateless). Migration required by July 28, 2026.
- **Backers**: Anthropic created it; adopted by OpenAI (March 2025), Google DeepMind, ~100+ public server implementations.
- **Purpose clarification**: MCP is **model ↔ tool**, NOT agent ↔ agent. Don't confuse the two; they compose (an A2A agent exposes its tools via MCP).
- **Transport**: JSON-RPC 2.0 over stdio, SSE, or HTTP.
- **Message shape**: `tools/list`, `tools/call`, `resources/list`, `resources/read`, `prompts/list`, `prompts/get`.
- **Reference impl**: [modelcontextprotocol/python-sdk](https://github.com/modelcontextprotocol/python-sdk).
- **Key feature**: Resources (read-only context payloads), Tools (callable functions), Prompts (reusable templates). The 3-primitive model is what makes MCP compose so well.

### AGNTCY v1.0 — Fleet meta-layer

- **Status**: Early-stage (donated to Linux Foundation July 2025). Reference implementation in progress.
- **Backers**: Apple, Cisco-led ecosystem.
- **Purpose**: Discovery, identity, observability for fleets of agents. Sits ABOVE A2A and MCP.
- **Minsky fit**: Valuable at fleet scale (10+ machines); optional for M1.

### Claude Code Agent Teams v2.1.32 — Native multi-agent

- **Status**: Experimental (feature flag required). Stability not guaranteed; known limitations around session resumption, task coordination, shutdown.
- **Backers**: Anthropic.
- **Purpose**: Lead agent + N teammates, each with independent context window, sharing a filesystem-based mailbox + task list at `~/.claude/tasks/<team-name>/`.
- **Minsky fit**: Promising for multi-persona work but not stable enough for M1. Defer to M2+.

### Don't adopt

- **FIPA-ACL** (1995-2010) — semantically rich but no streaming, no artifacts, no modern transport. Legacy.
- **OpenAI Agents SDK** (v0.17, stable) — vendor-locked to OpenAI. Use A2A for interop; OpenAI agents can expose A2A endpoints.
- **AutoGen / AG2** (v0.13, stable) — frameworks, not protocols. AG2 v0.13+ has A2A support — fine to use AG2 as a tool within Minsky's A2A stack, not as the orchestrator.
- **SwarmZero** — useful patterns but not standardized. A2A subsumes its message-passing.

## How A2A + MCP compose

```text
┌─────────────────────────────────────────────────────────────┐
│  Operator                                                    │
│       │ (TASKS.md)                                           │
│       ▼                                                      │
│  Minsky daemon (bash tick-loop)                              │
│       │ A2A SendMessage                                      │
│       ▼                                                      │
│  Persona-1: Researcher  ─────A2A handoff────▶  Persona-2:    │
│       │                                       Planner       │
│       │ MCP tools/call                            │         │
│       ▼                                           ▼         │
│  (terminal, file_editor, ...)             ...handoff to     │
│                                            Persona-3, 4, 5  │
└─────────────────────────────────────────────────────────────┘
```

A2A = the seam between PERSONAS (researcher hands off to planner).
MCP = the seam between PERSONA and TOOL (researcher uses file_editor).

Both use JSON-RPC 2.0; both are HTTP-transport-compatible; both have streaming. They're designed to compose.

## Mapping to Minsky's existing work

| Existing Minsky task | A2A maps it to |
|---|---|
| `multi-persona-pipeline-handoff-spec` (M2) | Each persona = an A2A-compliant agent. Handoff = `SendMessage` → `Task` → `SubscribeToTask`. The custom `novel/handoff-spec/` JSON schema this task originally tracked is obsoleted — A2A IS the handoff spec. |
| `daemon-cross-vendor-reviewer-bias-prevention` | Worker (OpenHands/local) sends task to reviewer (Claude/Devin) as a separate A2A endpoint. No vendor lock-in. |
| `minsky-remote-task-submission` (P0) | Machine A's daemon sends `SendMessage` to the central repo's A2A agent with findings. Central agent files TASKS.md entry; optional AGNTCY directory for discovery. |
| `fleet-log-aggregation` (P0) | Central agent queries `ListTasks` across all registered daemons. Aggregation is just iteration over the A2A response set. |
| Companion mode (already shipped via agentbrew) | MCP server (not A2A) — companion exposes research findings as resources; worker queries `resources/list` + `resources/read`. |
| `native-agent-teams-with-tiered-adapter` | Claude Code Agent Teams (defer to M2+). |

The three M2 P0s collapse into one A2A adoption track + two MCP-flavor tasks.

## Strategic recommendation — Minsky's delegate → contribute → absorb

### Delegate

- **A2A** is Google's responsibility. Minsky writes `novel/adapters/a2a.ts` (interface) + `a2a.openhands.ts` (implementation) per rule #2. No protocol implementation in Minsky.
- **MCP** is Anthropic's responsibility. Same pattern: `novel/adapters/mcp.ts` + `mcp.openhands.ts`.

### Contribute

- Feed back to A2A on:
  - Task-metadata schema for hypothesis-driven development (Minsky's rule #9 fields — Hypothesis/Success/Pivot/Measurement/Anchor — map well to extension fields)
  - Streaming semantics for long-running autonomous-coding tasks (the 12-min iteration is a realistic profile, not an edge case)
- Feed back to MCP on:
  - v2026-07-28 migration testing (Minsky is a representative consumer with diverse tool needs)

### Absorb (build in `novel/`)

- The Minsky-specific COMPOSITION: how personas chain, what gets carried across handoffs (the operator's task metadata + the worker's progress), the iteration-record schema that flows BACK to TASKS.md after the pipeline finishes.
- This is Minsky's moat: the constitution + MAPE-K loop wired through the standard protocols.

## Risks & migration

| Risk | Severity | Mitigation |
|---|---|---|
| MCP v2026-07-28 breaking changes | Medium | File P1 `mcp-migration-to-2026-07-28-rc` now; migrate before July 28, 2026. |
| A2A SDK maturity in non-Python languages | Low | Python is the canonical implementation; Minsky's shim is already Python. |
| Claude Code Agent Teams stability | High | Defer to M2+; gate behind feature flag. |
| AGNTCY reference-implementation lag | Medium | Defer to M2+; A2A discovery alone covers M1 needs. |
| OpenHands SDK A2A native support | Unknown | If unavailable, the shim wraps OpenHands' conversation with an A2A adapter at `novel/adapters/agent-runtime-openhands/`. |

## References

- A2A v1.0.0 specification — <https://a2a-protocol.org> (Linux Foundation)
- A2A Python SDK — <https://github.com/google/a2a-python>
- MCP v2025-11-25 specification — <https://modelcontextprotocol.io>
- MCP v2026-07-28 RC migration notes — see MCP repo PR/SEP-2575
- AGNTCY — <https://agntcy.org> (Apple, Cisco)
- Claude Code Agent Teams — <https://docs.claude.com/en/docs/claude-code/sub-agents>
- FIPA-ACL — <http://www.fipa.org/specs/fipa00061/> (legacy)
- IBM ACP / A2A merger announcement — Aug 2025, Linux Foundation press release

## Decision

Adopt **A2A + MCP** as Minsky's protocol stack via adapters at `novel/adapters/{a2a,mcp}.ts`. File the four P0/P1 tasks below to track delivery.

| Task | Priority | Milestone | What it ships |
|---|---|---|---|
| `a2a-adapter-foundation` | P0 | M1 | The `novel/adapters/a2a.ts` interface + reference implementation; SendMessage + GetTask + streaming work against a fixture A2A endpoint. |
| `mcp-adapter-foundation` | P0 | M1 | The `novel/adapters/mcp.ts` interface + reference implementation; resources/list + resources/read + tools/call work against a fixture MCP server. |
| `multi-persona-pipeline-via-a2a` | P0 | M2 | 5-persona pipeline (researcher → planner → developer → QA → reviewer) running on a real task using A2A handoff. Supersedes the existing `multi-persona-pipeline-handoff-spec` design. |
| `mcp-migration-to-2026-07-28-rc` | P1 | M1 | Migrate the MCP adapter to v2026-07-28 RC before the July 28, 2026 breaking-change deadline. |

Sibling existing tasks (`daemon-cross-vendor-reviewer-bias-prevention`, `minsky-remote-task-submission`, `fleet-log-aggregation`) retire naturally as their implementations adopt the A2A adapter. They stay open as tracking surfaces for the operator-visible behavior; their **Touches** fields update to cite `novel/adapters/a2a.ts` when their implementation slices ship.

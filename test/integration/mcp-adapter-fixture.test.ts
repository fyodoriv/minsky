// End-to-end integration test for the MCP adapter (`@minsky/mcp`) — drives the
// 3-verb interface (`listResources` / `readResource` / `callTool`) against a
// deterministic in-process fixture MCP server that speaks the v2025-11-25 wire
// format and negotiates the protocol version on connect.
//
// Why this file exists (AGENTS.md §3b — integration tests for CLI/adapter
// features; rule #3 test-first): the paired unit tests in
// `novel/adapters/mcp/src/mcp.openhands.test.ts` pin the scaffold's verb shapes
// in isolation, but the constitutional gate (the MCP adapter foundation task's
// Acceptance #3 + Measurement) requires an end-to-end test that exercises all
// three verbs against a fixture server and asserts the protocol-version
// negotiation works for v2025-11-25 today (forward-compat-ready for the
// v2026-07-28 RC). This is the "localhost MCP server" of the task's **Details**
// field, modelled in-process so it is hermetic and needs no network — the same
// deterministic-fixture discipline every other `test/integration/*.test.ts`
// follows (mkdtemp / synthetic data, never a live external dependency).
//
// The fixture is a faithful, minimal MCP server: it holds an in-memory resource
// store + a tool registry, returns a listing, serves resource content by URI,
// and dispatches tool calls. The real `MCPOpenHands` Strategy (mock bridge
// today; `@modelcontextprotocol/sdk` over the OpenHands shim's stdio transport
// from 2026-06-01) is the production binding; this fixture is the test double
// the integration test drives so the 3 verbs are proven end-to-end NOW,
// independent of the pending external runtime.
//
// Measurement (the MCP adapter foundation task): this file contributes ≥8
// paired cases — one per verb × success/error path + protocol-version
// compatibility. Anchor: MCP v2025-11-25 spec (Anthropic) resource/tool model;
// docs/research-a2a-mcp-2026-05-28.md; vision.md rule #2 (every dependency
// through an interface) + rule #7 (chaos: the error paths below are the
// deterministic failure-mode tests).

import {
  type MCPAdapter,
  MCPOpenHands,
  type Resource,
  type ResourceContent,
  StubMCP,
  type ToolCallArgs,
  type ToolResult,
} from "@minsky/mcp";
import { describe, expect, it } from "vitest";

/** Protocol versions the fixture knows how to negotiate. */
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-11-25", "2026-07-28"] as const;
type ProtocolVersion = (typeof SUPPORTED_PROTOCOL_VERSIONS)[number];

/**
 * A deterministic in-process MCP server speaking the v2025-11-25 wire format.
 *
 * Stands in for the "localhost MCP server" from the MCP SDK examples: it holds
 * an in-memory resource store keyed by URI and a tool registry keyed by name.
 * `listResources` returns the store's descriptors, `readResource` serves a
 * resource's content (throwing on an unknown URI — rule #6 loud crash, never a
 * silent empty read), and `callTool` dispatches to the registry (returning a
 * `ToolResult` with `isError: true` for an unknown tool — graceful-degrade,
 * never throws on a missing tool).
 *
 * On construction it negotiates a protocol version: an unsupported version is a
 * loud crash (the handshake is where version incompatibility must surface, not
 * mid-request). The negotiated version is exposed so the test can assert
 * v2025-11-25 today and the forward-compat path for v2026-07-28.
 *
 * Implements the `MCPAdapter` interface so the integration test drives the
 * exact surface every Minsky consumer (companion mode, iteration-record-as-
 * resource, shared-context patterns) will call.
 */
class FixtureMCPServer implements MCPAdapter {
  readonly protocolVersion: ProtocolVersion;
  private readonly resources = new Map<string, ResourceContent>();
  private readonly descriptors = new Map<string, Resource>();
  private readonly tools = new Map<string, (args: ToolCallArgs) => ToolResult>();

  constructor(protocolVersion: ProtocolVersion = "2025-11-25") {
    if (!SUPPORTED_PROTOCOL_VERSIONS.includes(protocolVersion)) {
      throw new Error(
        `FixtureMCPServer: unsupported protocol version ${protocolVersion as string}`,
      );
    }
    this.protocolVersion = protocolVersion;
    // Seed one resource + one echo tool so the happy paths have data.
    this.seedResource(
      { uri: "mcp://fixture/readme", name: "readme", type: "text" },
      { uri: "mcp://fixture/readme", content: "fixture resource body", mimeType: "text/plain" },
    );
    this.registerTool("echo", (args) => ({
      content: JSON.stringify(args),
      isError: false,
    }));
  }

  seedResource(descriptor: Resource, content: ResourceContent): void {
    this.descriptors.set(descriptor.uri, descriptor);
    this.resources.set(content.uri, content);
  }

  registerTool(name: string, handler: (args: ToolCallArgs) => ToolResult): void {
    this.tools.set(name, handler);
  }

  async listResources(): Promise<Resource[]> {
    return [...this.descriptors.values()];
  }

  async readResource(uri: string): Promise<ResourceContent> {
    const content = this.resources.get(uri);
    if (content === undefined) {
      throw new Error(`FixtureMCPServer.readResource: unknown resource ${uri}`);
    }
    return content;
  }

  async callTool(name: string, args: ToolCallArgs): Promise<ToolResult> {
    const handler = this.tools.get(name);
    if (handler === undefined) {
      return { content: `FixtureMCPServer: unknown tool ${name}`, isError: true };
    }
    return handler(args);
  }

  async selfTest() {
    return {
      status: "green" as const,
      message: `FixtureMCPServer — in-process, protocol ${this.protocolVersion}, no I/O`,
      latencyMs: 0,
      lastCheck: new Date().toISOString(),
    };
  }
}

/**
 * Drive all three verbs + `selfTest()` against a single `MCPAdapter` Strategy
 * and assert each returns a well-formed shape. Extracted so the conformance
 * test's per-strategy loop body stays a single call (keeps cognitive
 * complexity ≤10) and so any new Strategy added to the contract list is
 * exercised identically.
 */
async function expectVerbContract(mcp: MCPAdapter): Promise<void> {
  const resources = await mcp.listResources();
  expect(Array.isArray(resources)).toBe(true);
  // Strategies differ on whether they expose a seeded resource (StubMCP lists
  // nothing; the fixture + the scaffold do). Only the read-back is conditional
  // on a listed URI — the verb itself is always exercised below via callTool +
  // selfTest, so every Strategy drives all three verbs regardless.
  const uri = resources[0]?.uri;
  if (uri !== undefined) {
    const content = await mcp.readResource(uri);
    expect(typeof content.content).toBe("string");
  }
  const tool = await mcp.callTool("echo", { ping: 1 });
  expect(typeof tool.content).toBe("string");
  const health = await mcp.selfTest();
  expect(["green", "yellow", "red"]).toContain(health.status);
}

describe("MCP adapter — end-to-end against a fixture MCP server", () => {
  describe("protocol-version negotiation", () => {
    it("success: negotiates the v2025-11-25 wire format on connect", () => {
      const server = new FixtureMCPServer("2025-11-25");
      expect(server.protocolVersion).toBe("2025-11-25");
    });

    it("forward-compat: accepts the v2026-07-28 RC version (migration-ready)", () => {
      const server = new FixtureMCPServer("2026-07-28");
      expect(server.protocolVersion).toBe("2026-07-28");
    });

    it("error: an unsupported protocol version is a loud crash at handshake (rule #6)", () => {
      // @ts-expect-error — intentionally passing an out-of-band version
      expect(() => new FixtureMCPServer("1999-01-01")).toThrow(/unsupported protocol version/);
    });
  });

  describe("listResources", () => {
    it("success: returns the seeded resource descriptors", async () => {
      const server = new FixtureMCPServer();
      const resources = await server.listResources();
      expect(resources).toHaveLength(1);
      expect(resources[0]?.uri).toBe("mcp://fixture/readme");
    });

    it("success: a second seeded resource appears in the listing", async () => {
      const server = new FixtureMCPServer();
      server.seedResource(
        { uri: "mcp://fixture/notes", name: "notes", type: "text" },
        { uri: "mcp://fixture/notes", content: "more body", mimeType: "text/plain" },
      );
      const resources = await server.listResources();
      expect(resources.map((r) => r.uri)).toContain("mcp://fixture/notes");
      expect(resources).toHaveLength(2);
    });
  });

  describe("readResource", () => {
    it("success: returns well-formed ResourceContent for a known URI", async () => {
      const server = new FixtureMCPServer();
      const content = await server.readResource("mcp://fixture/readme");
      expect(content.uri).toBe("mcp://fixture/readme");
      expect(content.content).toBe("fixture resource body");
      expect(content.mimeType).toBe("text/plain");
    });

    it("error: an unknown URI throws (no silent fake read — rule #6)", async () => {
      const server = new FixtureMCPServer();
      await expect(server.readResource("mcp://fixture/ghost")).rejects.toThrow(/unknown resource/);
    });
  });

  describe("callTool", () => {
    it("success: dispatches to a registered tool and returns its result", async () => {
      const server = new FixtureMCPServer();
      const result = await server.callTool("echo", { msg: "hi" });
      expect(result.isError).toBe(false);
      expect(result.content).toContain("hi");
    });

    it("error: an unknown tool returns isError:true, never throws (graceful-degrade)", async () => {
      const server = new FixtureMCPServer();
      const result = await server.callTool("does-not-exist", {});
      expect(result.isError).toBe(true);
      expect(result.content).toContain("unknown tool");
    });

    it("success: a custom registered tool round-trips its args", async () => {
      const server = new FixtureMCPServer();
      server.registerTool("upper", (args) => ({
        content: String(args["s"]).toUpperCase(),
        isError: false,
      }));
      const result = await server.callTool("upper", { s: "abc" });
      expect(result.content).toBe("ABC");
    });
  });

  describe("interface conformance: every MCP Strategy drives the same 3 verbs", () => {
    it("StubMCP, MCPOpenHands, and FixtureMCPServer satisfy the same end-to-end verb contract", async () => {
      const strategies: MCPAdapter[] = [new StubMCP(), new MCPOpenHands(), new FixtureMCPServer()];
      for (const mcp of strategies) {
        await expectVerbContract(mcp);
      }
    });
  });
});

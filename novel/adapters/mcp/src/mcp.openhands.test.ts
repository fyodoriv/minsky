// Paired tests for the MCP adapter (rule #3 test-first; rule #7 chaos row in
// the package README). Covers the StubMCP fake's record/return contract and
// the MCPOpenHands scaffold's three verbs + the yellow self-test verdict
// (scaffold present, real @modelcontextprotocol/sdk bridge pending 2026-06-01).
// Pattern: parametric paired fixtures per Meszaros, *xUnit Test Patterns*, 2007.

import { describe, expect, it } from "vitest";
import { MCPOpenHands, StubMCP } from "./index.js";

describe("StubMCP (test fake)", () => {
  it("records each call in FIFO order with its args", async () => {
    const stub = new StubMCP();
    await stub.readResource("mcp://x/1");
    await stub.callTool("echo", { msg: "hi" });
    expect(stub.calls).toHaveLength(2);
    expect(stub.calls[0]?.method).toBe("readResource");
    expect(stub.calls[0]?.args[0]).toBe("mcp://x/1");
    expect(stub.calls[1]?.method).toBe("callTool");
    expect(stub.calls[1]?.args[0]).toBe("echo");
  });

  it("readResource returns a well-formed ResourceContent", async () => {
    const content = await new StubMCP().readResource("mcp://x/42");
    expect(content.uri).toBe("mcp://x/42");
    expect(typeof content.content).toBe("string");
  });

  it("callTool returns a non-error ToolResult", async () => {
    const result = await new StubMCP().callTool("fmt", {});
    expect(result.isError).toBe(false);
    expect(result.content).toContain("fmt");
  });

  it("selfTest is unconditionally green (no I/O)", async () => {
    const result = await new StubMCP().selfTest();
    expect(result.status).toBe("green");
    expect(result.latencyMs).toBe(0);
  });

  it("reset() drops recorded calls", async () => {
    const stub = new StubMCP();
    await stub.listResources();
    expect(stub.calls).toHaveLength(1);
    stub.reset();
    expect(stub.calls).toHaveLength(0);
  });
});

describe("MCPOpenHands (scaffold — mock bridge pending 2026-06-01)", () => {
  const adapter = new MCPOpenHands();

  it("listResources returns an array of resources", async () => {
    const resources = await adapter.listResources();
    expect(Array.isArray(resources)).toBe(true);
    expect(resources.length).toBeGreaterThanOrEqual(1);
    expect(resources[0]?.uri).toMatch(/^mcp:\/\//);
  });

  it("readResource returns a well-formed ResourceContent", async () => {
    const content = await adapter.readResource("mcp://scaffold/resource-0");
    expect(content.content).toContain("2026-06-01");
    expect(content.mimeType).toBe("text/plain");
  });

  it("callTool returns a ToolResult", async () => {
    const result = await adapter.callTool("noop", { a: 1 });
    expect(result.isError).toBe(false);
    expect(typeof result.content).toBe("string");
  });

  it("selfTest reports yellow (scaffold present, real bridge pending) — never a false green", async () => {
    const result = await adapter.selfTest();
    expect(result.status).toBe("yellow");
    expect(result.message).toContain("2026-06-01");
  });
});

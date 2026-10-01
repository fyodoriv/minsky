/**
 * MCP adapter implementation for OpenHands (Strategy per Gamma et al. 1994).
 *
 * SCAFFOLD STATUS (2026-05-29): the three verbs run against a deterministic
 * in-process mock — they return well-formed `Resource` / `ResourceContent` /
 * `ToolResult` shapes so the interface, the `StubMCP` fake, and downstream
 * consumers can be built + tested NOW. The real bridge (Anthropic's
 * `@modelcontextprotocol/sdk` over the OpenHands shim) ships when the OpenHands
 * runtime lands — gated to 2026-06-01 per `competitors/openhands.md` and the
 * `AGENT_MATRIX` `pendingExternalDep`. Until then `runViaMcpBridge` returns
 * mock data and `selfTest()` reports `yellow` (scaffold present, real bridge
 * pending) so the operator is never told a non-existent integration is healthy.
 *
 * Anchors:
 *   - Gamma, Helm, Johnson, Vlissides, *Design Patterns*, 1994 (Strategy).
 *   - Helland, P., "Building on Quicksand", 2009 (visible-not-silent — a
 *     scaffold reports `yellow`, not a false `green`).
 */

import type { SelfTestResult } from "@minsky/adapter-types";
import type { MCPAdapter, Resource, ResourceContent, ToolCallArgs, ToolResult } from "./index.js";

/** Shape returned by the (currently mocked) MCP bridge. */
interface BridgeResult {
  readonly resources?: readonly Resource[];
  readonly resource?: ResourceContent;
  readonly tool?: ToolResult;
}

/**
 * MCP adapter implementation for OpenHands. See file header for SCAFFOLD
 * STATUS — the real `@modelcontextprotocol/sdk` bridge is pending the
 * 2026-06-01 OpenHands runtime.
 */
export class MCPOpenHands implements MCPAdapter {
  /**
   * @otel mcp.list-resources
   */
  async listResources(): Promise<Resource[]> {
    const result = await this.runViaMcpBridge("list_resources", {});
    return [...(result.resources ?? [])];
  }

  /**
   * @otel mcp.read-resource
   */
  async readResource(uri: string): Promise<ResourceContent> {
    const result = await this.runViaMcpBridge("read_resource", { uri });
    if (result.resource === undefined) {
      throw new Error(`MCPOpenHands.readResource: bridge returned no content for ${uri}`);
    }
    return result.resource;
  }

  /**
   * @otel mcp.call-tool
   */
  async callTool(name: string, args: ToolCallArgs): Promise<ToolResult> {
    const result = await this.runViaMcpBridge("call_tool", { name, args });
    return result.tool ?? { content: "", isError: true };
  }

  /**
   * Mock stand-in for the `@modelcontextprotocol/sdk` bridge. Real
   * implementation (pending 2026-06-01) connects an MCP client over the
   * OpenHands shim's stdio transport, issues the JSON-RPC request, and parses
   * the response.
   *
   * @otel-exempt internal bridge — the public verb's span (@otel mcp.*) covers the call; a nested span would double-count
   */
  private async runViaMcpBridge(
    command: string,
    _args: Record<string, unknown>,
  ): Promise<BridgeResult> {
    switch (command) {
      case "list_resources":
        return {
          resources: [
            { uri: "mcp://scaffold/resource-0", name: "scaffold-resource", type: "text" },
          ],
        };
      case "read_resource":
        return {
          resource: {
            uri: "mcp://scaffold/resource-0",
            content: "mock content — real bridge pending 2026-06-01",
            mimeType: "text/plain",
          },
        };
      case "call_tool":
        return {
          tool: { content: "mock tool result — real bridge pending 2026-06-01", isError: false },
        };
      default:
        return {};
    }
  }

  /**
   * @otel mcp.self-test
   */
  async selfTest(): Promise<SelfTestResult> {
    const startTime = Date.now();
    try {
      await this.runViaMcpBridge("ping", {});
      return {
        status: "yellow",
        message:
          "MCPOpenHands — scaffold healthy; real @modelcontextprotocol/sdk bridge pending 2026-06-01 OpenHands runtime",
        latencyMs: Date.now() - startTime,
        lastCheck: new Date().toISOString(),
      };
      // rule-6: handled-locally — selfTest is the supervisor's health probe; it converts a crash into a `red` verdict (the probe's contract) rather than re-throw and take down the doctor aggregation that calls it.
    } catch (error) {
      return {
        status: "red",
        message: `MCPOpenHands adapter failed self-test: ${error instanceof Error ? error.message : String(error)}`,
        latencyMs: Date.now() - startTime,
        lastCheck: new Date().toISOString(),
      };
    }
  }
}

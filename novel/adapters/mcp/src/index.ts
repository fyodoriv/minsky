/**
 * MCP adapter — interface (Adapter pattern, Gamma 1994) + a
 * `StubMCP` test fake (Meszaros 2007) + an `MCPOpenHands` implementation
 * (sibling file `./mcp.openhands.ts`).
 *
 * Pattern conformance (rule #8 / vision.md § Pattern conformance index):
 *   - This module:           Adapter (structural) + Strategy (behavioral)
 *                            per Gamma, Helm, Johnson, Vlissides,
 *                            *Design Patterns*, 1994. Conformance: full.
 *   - `StubMCP`:             Test fake / spy hybrid per Meszaros, *xUnit
 *                            Test Patterns*, 2007 — records calls in-memory
 *                            and returns fixed values so tests can assert
 *                            request shape without a real MCP server.
 *                            Conformance: full.
 *   - `MCPOpenHands.selfTest`:   Health-probe shape — re-uses
 *                            {@link SelfTestResult} from `@minsky/adapter-types`
 *                            (leaf package per Martin, *Clean Architecture*,
 *                            2017 — acyclic dependency principle).
 *
 * Why an MCP adapter (rule #2): Minsky composes the Model Context Protocol
 * (Anthropic, ~100+ public servers) as a dependency rather than building its
 * own agent-to-tool transport (rule #1 — don't reinvent). The adapter exposes
 * 3 verbs to Minsky's substrate: `listResources() → Resource[]`,
 * `readResource(uri) → ResourceContent`, `callTool(name, args) → ToolResult`.
 *
 * Anchors:
 *   - Gamma, Helm, Johnson, Vlissides, *Design Patterns*, Addison-Wesley,
 *     1994 (Adapter + Strategy).
 *   - Meszaros, G., *xUnit Test Patterns*, Addison-Wesley, 2007 (test fake).
 *   - Martin, R. C., *Clean Architecture*, Pearson, 2017 (acyclic
 *     dependency principle — `@minsky/adapter-types` is the leaf).
 */

// Re-export the shared health-probe contract from the leaf types package so
// callers can keep doing `import { type SelfTestResult } from "@minsky/mcp"`
// without an extra dep declaration.
export type { SelfTestResult, SelfTestStatus } from "@minsky/adapter-types";

import type { SelfTestResult } from "@minsky/adapter-types";

/** An MCP resource descriptor (the listing shape). */
export interface Resource {
  readonly uri: string;
  readonly name?: string;
  readonly description?: string;
  readonly type?: string;
  readonly modifiedAt?: string;
}

/** The content of a single MCP resource. */
export interface ResourceContent {
  readonly uri: string;
  readonly content: string;
  readonly mimeType?: string;
}

/** Arguments passed to an MCP tool call (arbitrary protocol payload). */
export interface ToolCallArgs {
  readonly [key: string]: unknown;
}

/** The result of an MCP tool call. */
export interface ToolResult {
  readonly content: string;
  readonly isError?: boolean;
}

/**
 * MCP adapter interface — Adapter pattern (Gamma et al., *Design
 * Patterns*, 1994). Strategy implementations live in sibling files
 * (e.g. {@link "./mcp.openhands".MCPOpenHands}).
 *
 * `selfTest()` follows the {@link SelfTestResult} contract; the `minsky
 * doctor` aggregation runs each adapter's `selfTest()` via
 * `aggregateStatus()` from `@minsky/adapter-types`.
 */
export interface MCPAdapter {
  /**
   * List available resources.
   * @returns Array of resource descriptors.
   */
  listResources(): Promise<Resource[]>;

  /**
   * Read the content of a resource.
   * @param uri - URI of the resource to read.
   * @returns The resource content.
   */
  readResource(uri: string): Promise<ResourceContent>;

  /**
   * Call a tool with the given arguments.
   * @param name - Name of the tool to call.
   * @param args - Arguments to pass to the tool.
   * @returns The tool result.
   */
  callTool(name: string, args: ToolCallArgs): Promise<ToolResult>;

  /**
   * Perform a self-test of the MCP adapter.
   * @returns Self test result.
   */
  selfTest(): Promise<SelfTestResult>;
}

/**
 * In-memory `MCPAdapter` for tests. Records every call's payload in order
 * (FIFO — first call is `calls[0]`) and returns fixed values.
 * Pattern: test fake per Meszaros, *xUnit Test Patterns*, 2007.
 *
 * `selfTest()` always returns `green` with `latencyMs: 0` — the stub has
 * no I/O so any other status would be a lie.
 *
 * @example
 *   const stub = new StubMCP();
 *   await daemon.run({ mcp: stub });
 *   expect(stub.calls).toHaveLength(1);
 */
export class StubMCP implements MCPAdapter {
  private readonly recorded: { method: string; args: unknown[] }[] = [];

  /**
   * @otel-exempt test fake — production callers never invoke this; recording is the test's seam, not a span source
   */
  get calls(): readonly { method: string; args: unknown[] }[] {
    return this.recorded;
  }

  /**
   * @otel-exempt test fake — records in-memory and returns fixed shape; the caller's span covers it
   */
  async listResources(): Promise<Resource[]> {
    this.recorded.push({ method: "listResources", args: [] });
    return [];
  }

  /**
   * @otel-exempt test fake — records in-memory and returns fixed shape; the caller's span covers it
   */
  async readResource(uri: string): Promise<ResourceContent> {
    this.recorded.push({ method: "readResource", args: [uri] });
    return { uri, content: "stub resource content", mimeType: "text/plain" };
  }

  /**
   * @otel-exempt test fake — records in-memory and returns fixed shape; the caller's span covers it
   */
  async callTool(name: string, args: ToolCallArgs): Promise<ToolResult> {
    this.recorded.push({ method: "callTool", args: [name, args] });
    return { content: `stub result for ${name}`, isError: false };
  }

  /**
   * @otel-exempt test fake — no I/O; the green status is unconditional by design, no value in a span
   */
  async selfTest(): Promise<SelfTestResult> {
    return {
      status: "green",
      message: "StubMCP — no I/O; recorded calls available via .calls",
      latencyMs: 0,
      lastCheck: new Date().toISOString(),
    };
  }

  /**
   * Drop all recorded calls. Useful between test cases when the same
   * fixture is reused.
   *
   * @otel-exempt test fake — purely test-side mutation; spans here would be noise
   */
  reset(): void {
    this.recorded.length = 0;
  }
}

// Re-export the OpenHands Strategy from the sibling module so consumers can
// `import { MCPOpenHands } from "@minsky/mcp"` without reaching for the
// `/mcp.openhands` subpath (mirrors `@minsky/a2a`'s re-export pattern).
export { MCPOpenHands } from "./mcp.openhands.js";

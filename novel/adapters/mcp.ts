/**
 * MCP Adapter Interface
 * 
 * Interface for the Model Context Protocol (MCP) adapter.
 * This adapter exposes the 3 verbs for MCP v2025-11-25 protocol:
 * - listResources() → Resource[]
 * - readResource(uri) → ResourceContent
 * - callTool(name, args) → ToolResult
 */

export interface Resource {
  uri: string;
  name?: string;
  description?: string;
  type?: string;
  modifiedAt?: string;
}

export interface ResourceContent {
  uri: string;
  content: string;
  mimeType?: string;
}

export interface ToolCallArgs {
  [key: string]: any;
}

export interface ToolResult {
  content: string;
  isError?: boolean;
}

export interface MCPAdapter {
  /**
   * List available resources
   * @returns Promise resolving to array of Resource objects
   */
  listResources(): Promise<Resource[]>;

  /**
   * Read content of a resource
   * @param uri - URI of the resource to read
   * @returns Promise resolving to ResourceContent object
   */
  readResource(uri: string): Promise<ResourceContent>;

  /**
   * Call a tool with given arguments
   * @param name - Name of the tool to call
   * @param args - Arguments to pass to the tool
   * @returns Promise resolving to ToolResult object
   */
  callTool(name: string, args: ToolCallArgs): Promise<ToolResult>;
}
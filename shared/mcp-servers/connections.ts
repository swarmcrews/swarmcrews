export const CONNECTION_TOOL_GROUP = "connections";
export const CONNECTION_TOOL_NAMES = ["list_connections", "inspect_connection", "call_tool", "read_resource", "get_prompt"] as const;
export const CONNECTION_MCP_TOOLS = CONNECTION_TOOL_NAMES.map(name => `mcp__${CONNECTION_TOOL_GROUP}__${name}`);
export const SECRET_MASK = "••••••••";
export type ConnectionState = "untested" | "connecting" | "ready" | "auth_required" | "error" | "disabled";
export interface ConnectionStatus {
  state: ConnectionState;
  checkedAt?: number;
  message?: string;
  toolCount?: number;
}
export interface ConnectionTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}
export interface ConnectionInventory {
  tools: ConnectionTool[];
  resources: Array<{ uri: string; name: string; description?: string }>;
  prompts: Array<{ name: string; description?: string; arguments?: Array<{ name: string; required?: boolean; description?: string }> }>;
}

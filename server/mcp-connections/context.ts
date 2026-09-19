import type { McpServerEntry } from "../../shared/mcp-servers/types.ts";
import { listMcpServers } from "../mcp-server-store.ts";

export function selectedConnectionIds(entries: McpServerEntry[], ids?: readonly string[]): string[] {
  return entries.filter(entry => entry.enabled !== false && (ids ? ids.includes(entry.id) : entry.isDefault === true)).map(entry => entry.id);
}

export function availableConnections(project: string, ids?: readonly string[]): McpServerEntry[] {
  const entries = listMcpServers(project).entries;
  const selected = selectedConnectionIds(entries, ids);
  return entries.filter(entry => entry.enabled !== false && (entry.selfServe !== false || selected.includes(entry.id)));
}

/** Never include endpoints, process arguments or credentials in agent context. */
export function buildConnectionContext(project: string, ids?: readonly string[]): string {
  let entries: McpServerEntry[];
  try { entries = availableConnections(project, ids); }
  catch { return "MCP connection context could not be loaded. Use list_connections to retry discovery or ask the user to review Connections settings."; }
  const selected = selectedConnectionIds(entries, ids);
  const describe = (entry: McpServerEntry) => JSON.stringify({ id: entry.id, name: entry.name, description: entry.description });
  const active = entries.filter(entry => selected.includes(entry.id));
  const advertised = entries.filter(entry => !selected.includes(entry.id));
  return [
    active.length ? `## Selected MCP Connections\nThese connections were explicitly added to this run's context. Use them when relevant to the user's task. Inspect a connection to retrieve its tools and schemas before use. Selection does not authorize unrelated external actions.\n${active.map(describe).join("\n")}` : "",
    advertised.length ? `## Available MCP Connections\nThese self-serve connections are advertised for discovery and have not been selected as task context. Inspect one when relevant.\n${advertised.map(describe).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");
}
